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
      return result;
    };

    Auth._setupAdmin = function (event) {
      event?.preventDefault?.();
      try { localStorage.removeItem(ADMIN_CONFIG_KEY); } catch (_) {}
      showError('adm-setup-err', 'L’accès administrateur local est désactivé. Utilisez le compte administrateur Firebase.');
    };
    Auth._doAdmin = login;
    installCloudAdminTrigger();
    return true;
  }

  function retryPatch() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (patchAuth() || attempts > 40) clearInterval(timer);
    }, 250);
  }

  window.MedConnectAdminCloud = { login, openCloudAdminModal, installCloudAdminTrigger, patchAuth };
  retryPatch();
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => { patchAuth(); installCloudAdminTrigger(); }, 0));
})();
