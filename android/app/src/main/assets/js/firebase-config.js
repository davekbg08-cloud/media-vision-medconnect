/* =====================================================
   MedConnect 2.0 — Configuration Firebase

   ⚠️  REMPLACER LES VALEURS CI-DESSOUS
       par celles de ton projet Firebase
       (voir FIREBASE_SETUP.md pour les étapes)
   ===================================================== */

const firebaseConfig = {
  apiKey:            "COLLE-TON-API-KEY-ICI",
  authDomain:        "TON-PROJET.firebaseapp.com",
  projectId:         "TON-PROJET-ID",
  storageBucket:     "TON-PROJET.appspot.com",
  messagingSenderId: "TON-SENDER-ID",
  appId:             "TON-APP-ID"
};

/* ── INITIALISATION ─────────────────────────────── */
let firebaseDB   = null;
let firebaseReady = false;

function initFirebase() {
  try {
    // Vérifier si la config a été remplie
    if (firebaseConfig.apiKey === "COLLE-TON-API-KEY-ICI") {
      return;
    }

    firebase.initializeApp(firebaseConfig);
    firebaseDB    = firebase.firestore();
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
