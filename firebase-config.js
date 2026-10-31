// Firebase web config for project "finapp-a0b09".
// These values are NOT secrets - they identify your project. Security comes
// from Firebase Auth + the Firestore rules in firestore.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyAwyPPLA4eYUN8D37Kj10ZGwgNvYcQvz4c",
  authDomain: "finapp-a0b09.firebaseapp.com",
  projectId: "finapp-a0b09",
  storageBucket: "finapp-a0b09.firebasestorage.app",
  messagingSenderId: "728745091085",
  appId: "1:728745091085:web:fe6b6cf1c721a9f835b544",
};

// Only these Google accounts may use the app. This list is for a friendly
// UI message; the REAL enforcement is the same list inside firestore.rules.
export const allowedEmails = [
  "asafdan@gmail.com",
];
