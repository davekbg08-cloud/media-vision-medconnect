/* =====================================================
   MedConnect 2.0 — Configuration Firebase

   Projet Firebase connecté : medconnect-e81ba
   ===================================================== */

const firebaseConfig = {
  apiKey:            "AIzaSyBXYiylAjJnR72IE_vUIrEZcjl1e_HBikI",
  authDomain:        "medconnect-e81ba.firebaseapp.com",
  projectId:         "medconnect-e81ba",
  storageBucket:     "medconnect-e81ba.firebasestorage.app",
  messagingSenderId: "341398935670",
  appId:             "1:341398935670:web:59b3f9d9f56f95723ba757",
  measurementId:     "G-5WJ8G0PKWW"
};

/* ── INITIALISATION ─────────────────────────────── */
let firebaseDB   = null;
let firebaseAuth = null;
let firebaseReady = false;

function initFirebase() {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firebaseDB    = firebase.firestore();
    firebaseAuth  = firebase.auth ? firebase.auth() : null;
    firebaseReady = true;

    // Activer la persistance hors-ligne
    firebaseDB.enablePersistence({ synchronizeTabs: true })
      .catch(() => {});

  } catch (err) {
    firebaseReady = false;
  }
}

// Lancer l'init
initFirebase();
