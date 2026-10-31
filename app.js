import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, allowedEmails } from "./firebase-config.js";
import { CURRENCIES, getFxHistory, convert } from "./fx.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
await setPersistence(auth, browserLocalPersistence); // stay signed in across visits

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const v of ["loading", "login-view", "app-view"]) $(v).classList.toggle("hidden", v !== id);
};

let unsubscribe = null;
let snapshot = null;
let fx = null; // { rates, dates, status }

/* ---------- auth ---------- */

$("login-btn").addEventListener("click", async () => {
  $("login-error").textContent = "";
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      $("login-error").textContent = "Sign-in failed: " + e.message;
    }
  }
});

$("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  snapshot = null;

  if (!user) { show("login-view"); return; }

  const allowed = allowedEmails.map((e) => e.toLowerCase());
  if (!user.emailVerified || !allowed.includes((user.email || "").toLowerCase())) {
    await signOut(auth);
    $("login-error").textContent = `${user.email} is not authorized to use this app.`;
    show("login-view");
    return;
  }

  $("user-name").textContent = user.displayName || user.email;
  $("avatar").src = user.photoURL || "";
  show("app-view");
  start(user);
});

/* ---------- data ---------- */

function start(user) {
  const ref = doc(db, "users", user.uid, "portfolio", "latest");

  getFxHistory().then((result) => { fx = result; render(); }).catch(() => {
    fx = { rates: {}, dates: [], status: "unavailable" };
    render();
  });

  unsubscribe = onSnapshot(
    ref,
    (snap) => {
      $("app-error").textContent = "";
      snapshot = snap.exists() ? snap.data() : null;
      render();
    },
    (err) => { $("app-error").textContent = "Could not load data: " + err.message; },
  );

  $("import-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const msg = $("import-msg");
    msg.className = "note";
    try {
      if (file.size > 500_000) throw new Error("File is too large.");
      const data = validateSnapshot(JSON.parse(await file.text()));
      await setDoc(ref, data);
      msg.textContent = "Snapshot imported.";
    } catch (err) {
      msg.className = "error";
      msg.textContent = "Import failed: " + err.message;
    }
  };
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

function validateSnapshot(s) {
  if (!s || typeof s !== "object") throw new Error("Not a snapshot file.");
  if (!Array.isArray(s.balances) || !Array.isArray(s.positions)) throw new Error("Missing balances or positions.");
  if (s.balances.length > 20 || s.positions.length > 500) throw new Error("Too many rows.");
  const balances = s.balances.map((b) => {
    if (!CURRENCIES.includes(b.currency)) throw new Error(`Unsupported currency: ${b.currency}`);
    for (const k of ["cash", "netLiquidation", "stockMarketValue", "unrealizedPnl", "rateToUsd"]) {
      if (!num(b[k])) throw new Error(`Bad value for ${b.currency}.${k}`);
    }
    return { currency: b.currency, cash: b.cash, netLiquidation: b.netLiquidation,
      stockMarketValue: b.stockMarketValue, unrealizedPnl: b.unrealizedPnl, rateToUsd: b.rateToUsd };
  });
  const positions = s.positions.map((p) => {
    if (typeof p.symbol !== "string" || p.symbol.length > 60) throw new Error("Bad symbol.");
    if (!CURRENCIES.includes(p.currency)) throw new Error(`Unsupported currency: ${p.currency}`);
    for (const k of ["quantity", "price", "marketValue", "avgCost", "unrealizedPnl", "dailyPnl"]) {
      if (!num(p[k])) throw new Error(`Bad value for ${p.symbol}.${k}`);
    }
    return { symbol: p.symbol, quantity: p.quantity, price: p.price, marketValue: p.marketValue,
      currency: p.currency, avgCost: p.avgCost, unrealizedPnl: p.unrealizedPnl, dailyPnl: p.dailyPnl };
  });
  const summary = s.summary || {};
  return {
    version: 1,
    source: String(s.source || "").slice(0, 100),
    asOf: String(s.asOf || "").slice(0, 40),
    baseCurrency: "USD",
    summary: {
      netLiquidation: num(summary.netLiquidation) ? summary.netLiquidation : null,
      totalCash: num(summary.totalCash) ? summary.totalCash : null,
      unrealizedPnl: num(summary.unrealizedPnl) ? summary.unrealizedPnl : null,
    },
    balances, positions,
  };
}

/* ---------- formatting ---------- */

const money = (v, c) => new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(v);
const money2 = (v, c) => new Intl.NumberFormat("en-US", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(v);
const plain = (v, d = 2) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(v);
const signClass = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/* ---------- rendering ---------- */

// One row of "units per 1 USD". Uses the latest ECB-based rate; if the exchange
// service has never been reachable, falls back to the rates inside the snapshot.
function currentRates() {
  if (fx && fx.dates.length) {
    return { row: fx.rates[fx.dates[fx.dates.length - 1]], date: fx.dates[fx.dates.length - 1], fallback: false };
  }
  const row = { USD: 1 };
  for (const b of snapshot.balances) row[b.currency] = 1 / b.rateToUsd;
  return { row: CURRENCIES.every((c) => row[c]) ? row : null, date: null, fallback: true };
}

function render() {
  const empty = !snapshot;
  $("empty").classList.toggle("hidden", !empty);
  $("dash").classList.toggle("hidden", empty);
  if (empty) return;

  const { row, date } = currentRates();
  if (!row) { $("app-error").textContent = "Exchange rates unavailable."; return; }

  $("asof").textContent = `Snapshot: ${snapshot.asOf || "unknown"} · ${snapshot.source || ""}`;

  // Per-currency table
  const table = $("ccy-table");
  table.replaceChildren();
  const head = el("tr");
  for (const h of ["Currency", "Value (original)", "In USD", "In ILS", "Unrealized P&L (original)"]) head.append(el("th", h));
  table.append(head);

  let totUsd = 0, totIls = 0, pnlUsd = 0, cashUsd = 0;
  for (const b of snapshot.balances) {
    const usd = convert(b.netLiquidation, b.currency, "USD", row);
    const ils = convert(b.netLiquidation, b.currency, "ILS", row);
    totUsd += usd; totIls += ils;
    pnlUsd += convert(b.unrealizedPnl, b.currency, "USD", row);
    cashUsd += convert(b.cash, b.currency, "USD", row);
    const tr = el("tr");
    tr.append(el("td", b.currency), el("td", money(b.netLiquidation, b.currency)),
      el("td", money(usd, "USD")), el("td", money(ils, "ILS")),
      el("td", money(b.unrealizedPnl, b.currency), signClass(b.unrealizedPnl)));
    table.append(tr);
  }
  const total = el("tr");
  for (const c of [el("td", "Total"), el("td", "—"), el("td", money(totUsd, "USD")), el("td", money(totIls, "ILS")),
    el("td", money(pnlUsd, "USD") + " (USD)", signClass(pnlUsd))]) { c.style.fontWeight = "650"; total.append(c); }
  table.append(total);

  // KPI cards
  const totals = $("totals");
  totals.replaceChildren();
  const kpi = (label, value, sub, cls) => {
    const d = el("div", undefined, "card kpi");
    d.append(el("div", label, "label"), el("div", value, "value " + (cls || "")), el("div", sub || "", "sub"));
    totals.append(d);
  };
  const ibkr = snapshot.summary && snapshot.summary.netLiquidation;
  kpi("Total value (USD)", money(totUsd, "USD"), ibkr ? `IBKR reports ${money2(ibkr, "USD")}` : "");
  kpi("Total value (ILS)", money(totIls, "ILS"), `1 USD = ${plain(row.ILS, 4)} ILS`);
  kpi("Unrealized P&L (USD)", money(pnlUsd, "USD"), "", signClass(pnlUsd));
  kpi("Cash (USD)", money(cashUsd, "USD"), "");

  $("fx-latest").textContent = date ? `Latest rate: ${date}` : "Using rates from the snapshot";

  // Positions
  const pt = $("pos-table");
  pt.replaceChildren();
  const ph = el("tr");
  for (const h of ["Symbol", "Qty", "Price", "Value (original)", "Value (USD)", "Weight", "Unrealized P&L", "Day P&L"]) ph.append(el("th", h));
  pt.append(ph);
  const rows = snapshot.positions
    .map((p) => ({ ...p, usd: convert(p.marketValue, p.currency, "USD", row) }))
    .sort((a, b) => b.usd - a.usd);
  const sumUsd = rows.reduce((s, p) => s + p.usd, 0) || 1;
  for (const p of rows) {
    const tr = el("tr");
    tr.append(el("td", p.symbol), el("td", plain(p.quantity, 4)), el("td", money2(p.price, p.currency)),
      el("td", money(p.marketValue, p.currency)), el("td", money(p.usd, "USD")),
      el("td", plain((p.usd / sumUsd) * 100, 1) + "%"),
      el("td", money(p.unrealizedPnl, p.currency), signClass(p.unrealizedPnl)),
      el("td", money(p.dailyPnl, p.currency), signClass(p.dailyPnl)));
    pt.append(tr);
  }

  renderStatus();
  drawChart();
}

function renderStatus() {
  const s = fx ? fx.status : "loading";
  const days = fx ? fx.dates.length : 0;
  const text = {
    live: `Rates: European Central Bank reference rates via Frankfurter. ${days} days stored in this browser.`,
    "offline-cache": `Exchange service unreachable; showing ${days} days stored in this browser.`,
    unavailable: "Exchange service unreachable and nothing stored yet; using the rates in the snapshot.",
    loading: "Loading exchange rates…",
  }[s];
  $("fx-status").textContent = text;
}

/* ---------- FX chart ---------- */

for (const id of ["fx-base", "fx-quote"]) {
  const sel = $(id);
  CURRENCIES.forEach((c) => sel.append(new Option(c, c)));
}
$("fx-base").value = "USD";
$("fx-quote").value = "ILS";
for (const id of ["fx-base", "fx-quote", "fx-range"]) $(id).addEventListener("change", drawChart);

function drawChart() {
  const svg = $("chart");
  svg.replaceChildren();
  if (!fx || fx.dates.length < 2) return;
  const base = $("fx-base").value, quote = $("fx-quote").value;
  const n = Math.min(fx.dates.length, Number($("fx-range").value) * 0.7 | 0 || fx.dates.length);
  const dates = fx.dates.slice(-Math.max(n, 2));
  const pts = dates.map((d) => fx.rates[d][quote] / fx.rates[d][base]);
  const W = 800, H = 260, L = 56, R = 12, T = 12, B = 28;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let min = Math.min(...pts), max = Math.max(...pts);
  if (min === max) { min -= 0.01; max += 0.01; }
  const pad = (max - min) * 0.08; min -= pad; max += pad;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
  };
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    mk("line", { class: "grid-line", x1: L, x2: W - R, y1: y(v), y2: y(v) });
    mk("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, plain(v, 4));
  }
  mk("text", { x: L, y: H - 8 }, dates[0]);
  mk("text", { x: W - R, y: H - 8, "text-anchor": "end" }, dates[dates.length - 1]);
  mk("polyline", { class: "line", points: pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") });
}
