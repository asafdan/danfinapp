import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc, query, orderBy,
  onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, allowedEmails } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
await setPersistence(auth, browserLocalPersistence); // stay signed in across visits

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const v of ["loading", "login-view", "app-view"]) $(v).classList.toggle("hidden", v !== id);
};

let unsubscribeNotes = null;

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
  if (unsubscribeNotes) { unsubscribeNotes(); unsubscribeNotes = null; }

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
  startNotes(user);
});

function startNotes(user) {
  const notesCol = collection(db, "users", user.uid, "notes");
  const list = $("notes");

  unsubscribeNotes = onSnapshot(
    query(notesCol, orderBy("createdAt", "desc")),
    (snap) => {
      $("app-error").textContent = "";
      list.replaceChildren();
      snap.forEach((d) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.textContent = d.data().text; // textContent => no XSS
        const del = document.createElement("button");
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteDoc(doc(db, "users", user.uid, "notes", d.id)));
        li.append(span, del);
        list.append(li);
      });
    },
    (err) => { $("app-error").textContent = "Could not load data: " + err.message; },
  );

  $("note-form").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("note-input").value.trim();
    if (!text) return;
    try {
      await addDoc(notesCol, { text, createdAt: serverTimestamp() });
      $("note-input").value = "";
    } catch (err) {
      $("app-error").textContent = "Could not save: " + err.message;
    }
  };
}
