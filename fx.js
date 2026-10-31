// Exchange-rate history: ECB reference rates served by the Frankfurter API
// (https://frankfurter.dev, free, no API key). Rates are stored as
// "units of currency per 1 USD" for USD, EUR, GBP and ILS.
//
// History is cached in the browser (IndexedDB). On each visit only the days
// missing since the last cached date are downloaded, so the history keeps
// growing beyond one year and still works offline.

export const CURRENCIES = ["USD", "EUR", "GBP", "ILS"];
const API = "https://api.frankfurter.dev/v1/";
const DB_NAME = "finapp-fx";
const STORE = "rates";
const DAY = 86400000;

const iso = (d) => d.toISOString().slice(0, 10);

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadCached() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = {};
    const cursor = db.transaction(STORE).objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

async function saveCached(rates) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [date, row] of Object.entries(rates)) store.put(row, date);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function validRow(row) {
  return row && ["EUR", "GBP", "ILS"].every((c) => Number.isFinite(row[c]) && row[c] > 0);
}

async function fetchRange(startIso) {
  const url = `${API}${startIso}..?base=USD&symbols=EUR,GBP,ILS`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Exchange-rate service returned ${res.status}`);
  const data = await res.json();
  const out = {};
  for (const [date, row] of Object.entries(data.rates || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && validRow(row)) {
      out[date] = { USD: 1, EUR: row.EUR, GBP: row.GBP, ILS: row.ILS };
    }
  }
  return out;
}

/** Returns { rates: {date: {USD,EUR,GBP,ILS}}, dates: [sorted], status } */
export async function getFxHistory() {
  let cached = {};
  let cacheOk = true;
  try { cached = await loadCached(); } catch { cacheOk = false; }

  const cachedDates = Object.keys(cached).sort();
  const last = cachedDates[cachedDates.length - 1];
  const yearAgo = iso(new Date(Date.now() - 365 * DAY));
  // Re-fetch from the last cached day (rates are final per day, so this is cheap
  // and also repairs a partially saved last day).
  const start = last && last > yearAgo ? last : yearAgo;

  let status = "live";
  let fresh = {};
  try {
    fresh = await fetchRange(start);
    if (cacheOk && Object.keys(fresh).length) {
      try { await saveCached(fresh); } catch { /* cache is best-effort */ }
    }
  } catch (e) {
    status = cachedDates.length ? "offline-cache" : "unavailable";
  }

  const rates = { ...cached, ...fresh };
  const dates = Object.keys(rates).sort();
  if (!dates.length) status = "unavailable";
  return { rates, dates, status };
}

/** Convert an amount between currencies using one day's row. */
export function convert(amount, from, to, row) {
  if (from === to) return amount;
  return (amount / row[from]) * row[to];
}
