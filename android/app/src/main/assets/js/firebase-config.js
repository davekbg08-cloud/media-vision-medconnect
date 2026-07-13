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

/* ── App Check (voir docs/FIREBASE_APP_CHECK_SETUP.md) ──
   Vide par défaut : l'activation ci-dessous est un no-op tant qu'aucune
   clé n'est renseignée ici — aucun risque pour les utilisateurs actuels
   tant que la clé reCAPTCHA Enterprise n'a pas été créée manuellement
   dans Google Cloud Console (action hors de cet environnement). Ne
   JAMAIS mettre autre chose ici qu'une clé reCAPTCHA publique (site
   key) — jamais de clé secrète/serveur. */
const APP_CHECK_SITE_KEY = "";

/* ── INITIALISATION ─────────────────────────────── */
let firebaseDB   = null;
let firebaseAuth = null;
let firebaseReady = false;

// Séparée de initFirebase() pour rester testable isolément et pour que
// l'absence du SDK App Check (firebase.appCheck) — normale tant que le
// script firebase-app-check-compat.js n'est pas chargé, ex. anciens
// caches PWA pas encore rafraîchis — ne fasse jamais échouer
// l'initialisation Firebase principale.
function activateAppCheck() {
  if (!APP_CHECK_SITE_KEY) return;
  try {
    if (!firebase.appCheck) return;
    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
      true // isTokenAutoRefreshEnabled
    );
  } catch (err) {
    console.warn('[MedConnect] App Check indisponible :', err);
  }
}

function initFirebase() {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    activateAppCheck();
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

/* ── Correctif sécurité admin : accès cloud uniquement ── */
(function adminCloudOnlyPatch() {
  const ADMIN_CONFIG_KEY = 'mc_admin_config';

  function hasFirebase() {
    return typeof firebaseAuth !== 'undefined' && !!firebaseAuth &&
           typeof firebaseDB !== 'undefined' && !!firebaseDB;
  }

  function showError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(message || '').replace(/\n/g, '<br>');
    el.style.display = message ? 'block' : 'none';
  }

  function openCloudAdminModal() {
    if (!window.App?.openModal) return;
    App.openModal('⚙️ Connexion Administrateur', `
      <form onsubmit="MedConnectAdminCloud.login(event)">
        <div class="auth-register-info">
          🔐 Accès administrateur cloud uniquement.<br>
          Utilisez l’email administrateur enregistré dans Firebase.
        </div>
        <div class="form-group">
          <label class="inp-lbl">Email administrateur *</label>
          <input type="email" id="adm-cloud-email" class="inp" autocomplete="email" required>
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="adm-cloud-pass" class="inp" autocomplete="current-password" required>
        </div>
        <div id="adm-cloud-err" class="auth-error" style="display:none"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">Connexion</button>
        </div>
      </form>`);
  }

  function replaceLocalAdminModal() {
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    if (!title || !body) return;
    const titleText = String(title.textContent || '');
    const bodyText = String(body.textContent || '');
    const isOldLocalModal = titleText.includes('Configuration Administrateur') ||
      bodyText.includes('Aucun compte administrateur') ||
      bodyText.includes('Créer le premier accès local');
    if (isOldLocalModal && !document.getElementById('adm-cloud-email')) {
      openCloudAdminModal();
    }
  }

  async function login(event) {
    event?.preventDefault?.();
    const email = (document.getElementById('adm-cloud-email')?.value || '').trim();
    const pass = (document.getElementById('adm-cloud-pass')?.value || '').trim();
    if (!email || !pass) {
      showError('adm-cloud-err', 'Veuillez remplir l’email et le mot de passe administrateur.');
      return;
    }
    if (!hasFirebase()) {
      showError('adm-cloud-err', '❌ Firebase indisponible. Vérifiez la connexion internet puis réessayez.');
      return;
    }

    try {
      const credential = await firebaseAuth.signInWithEmailAndPassword(email, pass);
      const uid = credential?.user?.uid;
      if (!uid) throw new Error('admin_uid_missing');

      const doc = await firebaseDB.collection('users').doc(uid).get();
      if (!doc.exists) {
        showError('adm-cloud-err', '❌ Profil administrateur introuvable dans Firestore.');
        return;
      }

      const profile = doc.data() || {};
      const status = String(profile.status || '').toLowerCase();
      if (profile.role !== 'admin') {
        showError('adm-cloud-err', '❌ Ce compte n’a pas le rôle administrateur.');
        return;
      }
      if (!['active', 'approved'].includes(status)) {
        showError('adm-cloud-err', '🚫 Compte administrateur non actif.');
        return;
      }

      const session = {
        ...profile,
        uid,
        authUid: uid,
        email,
        role: 'admin',
        name: profile.name || profile.displayName || 'Administrateur',
        restoredFromCloud: true,
        loggedAt: new Date().toISOString(),
      };
      sessionStorage.setItem('mc_user', JSON.stringify(session));
      try { localStorage.removeItem(ADMIN_CONFIG_KEY); } catch (_) {}

      App.closeModal();
      const authScreen = document.getElementById('auth-screen');
      if (authScreen) authScreen.style.display = 'none';
      App.afterLogin(session);
      App.toast('✅ Administrateur connecté.');
    } catch (error) {
      console.warn('[MedConnect] Connexion administrateur cloud impossible :', error);
      showError('adm-cloud-err', '❌ Connexion administrateur impossible. Vérifiez email, mot de passe et droits Firestore.');
    }
  }

  function installCloudAdminTrigger() {
    const logo = document.getElementById('auth-logo-clicks');
    if (!logo || logo.dataset.adminCloudPatched === '1') return;
    const clone = logo.cloneNode(true);
    clone.dataset.adminCloudPatched = '1';
    logo.replaceWith(clone);

    let clicks = 0;
    let timer;
    clone.addEventListener('click', () => {
      clicks += 1;
      clearTimeout(timer);
      if (clicks >= 5) {
        clicks = 0;
        openCloudAdminModal();
        return;
      }
      timer = setTimeout(() => { clicks = 0; }, 2000);
    });
  }

  function patchAuth() {
    if (typeof Auth === 'undefined' || !Auth || Auth.__adminCloudPatchApplied) return false;
    Auth.__adminCloudPatchApplied = true;
    try { localStorage.removeItem(ADMIN_CONFIG_KEY); } catch (_) {}

    const originalShowLogin = Auth.showLogin?.bind(Auth);
    Auth.showLogin = function () {
      const result = originalShowLogin?.();
      installCloudAdminTrigger();
      replaceLocalAdminModal();
      return result;
    };

    Auth._setupAdmin = function (event) {
      event?.preventDefault?.();
      try { localStorage.removeItem(ADMIN_CONFIG_KEY); } catch (_) {}
      openCloudAdminModal();
    };
    Auth._doAdmin = login;
    installCloudAdminTrigger();
    replaceLocalAdminModal();
    return true;
  }

  function retryPatch() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      patchAuth();
      replaceLocalAdminModal();
      if (attempts > 60) clearInterval(timer);
    }, 250);
  }

  function observeModal() {
    const target = document.getElementById('global-modal') || document.body;
    if (!target || target.dataset.adminCloudObserver === '1') return;
    target.dataset.adminCloudObserver = '1';
    const observer = new MutationObserver(() => replaceLocalAdminModal());
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  window.MedConnectAdminCloud = { login, openCloudAdminModal, installCloudAdminTrigger, patchAuth, replaceLocalAdminModal };
  retryPatch();
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    patchAuth();
    installCloudAdminTrigger();
    observeModal();
    replaceLocalAdminModal();
  }, 0));
})();
