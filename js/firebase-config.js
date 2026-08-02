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
   La même PWA est chargée depuis 2 origines distinctes : GitHub Pages
   (davekbg08-cloud.github.io — APK Android via MainActivity.java) et
   le miroir Firebase Hosting (medconnect-e81ba.web.app/.firebaseapp.com
   — Electron via main.js, et navigateur direct). reCAPTCHA Enterprise
   restreint chaque clé à ses domaines déclarés : une seule clé fixe ne
   fonctionnerait donc que sur UNE des deux origines. La clé est résolue
   ici selon window.location.hostname ; domaine non reconnu (tests,
   file://, développement local) → chaîne vide → activateAppCheck() reste
   un no-op sûr, jamais de faux positif. Ne JAMAIS mettre autre chose ici
   qu'une clé reCAPTCHA publique (site key) — jamais de clé secrète/serveur. */
const APP_CHECK_SITE_KEYS = {
  'davekbg08-cloud.github.io': '6Lc8RjctAAAAAHMhYy1HuKAFqB55vFQqnbkSeCfC',
  'medconnect-e81ba.web.app': '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q',
  'medconnect-e81ba.firebaseapp.com': '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q',
};
function resolveAppCheckSiteKey() {
  const hostname = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
  return APP_CHECK_SITE_KEYS[hostname] || '';
}

/* Clé VAPID PUBLIQUE pour le push web (Phase 5 notifications) — à renseigner
   depuis Console Firebase → Cloud Messaging → « Certificats Web Push » (clé de
   paire de clés). PUBLIQUE (sûre à exposer, comme la clé reCAPTCHA) ; la clé
   PRIVÉE reste côté serveur (Secret Manager, functions). Tant qu'elle est vide,
   l'opt-in notifications affiche « non configuré » (jamais un faux bouton
   activé). */
window.PUSH_VAPID_PUBLIC_KEY = window.PUSH_VAPID_PUBLIC_KEY || '';

/* ── INITIALISATION ─────────────────────────────── */
let firebaseDB   = null;
let firebaseAuth = null;
let firebaseReady = false;
// Chantiers 6/7 (v2.9.42) : client Cloud Functions. Reste null tant que le SDK
// firebase-functions n'est pas chargé OU que les fonctions ne sont pas
// déployées — le code appelant (js/auth.js) détecte cette absence et conserve
// son chemin actuel en repli (aucune casse avant déploiement).
let firebaseFunctions = null;

// ── App Check — état de MODULE pour une activation STRICTEMENT idempotente
// et une vérification RÉELLE du jeton. Aucun jeton et aucune clé ne sont
// jamais journalisés ni exposés (voir docs/FIREBASE_APP_CHECK_SETUP.md).
// firebase.apps.length protège initializeApp mais PAS un second appel à
// activateAppCheck() — d'où cet état dédié.
let _appCheckInstance = null;           // instance firebase.appCheck() réutilisée
let _appCheckActivationStarted = false; // activation tentée une seule fois
let _appCheckTokenPromise = null;       // vérification getToken : une seule par chargement
const _appCheckStatus = {
  // idle|activating|activated|activation_failed|unconfigured_domain|sdk_missing|valid|token_failed|timeout
  status: 'idle',
  provider: 'recaptcha-enterprise',
  hostname: (typeof window !== 'undefined' && window.location && window.location.hostname) || '',
  activated: false,
  tokenVerified: false,
  lastCheckedAt: null,
  errorCode: null,
};
// Publie un état de diagnostic SÛR (jamais de jeton, jamais de clé, jamais
// d'objet Firebase interne) — utilisable par l'admin et les tests.
function _publishAppCheckStatus(patch) {
  if (patch) Object.assign(_appCheckStatus, patch);
  if (typeof window !== 'undefined') {
    window.MedConnectAppCheckStatus = {
      status: _appCheckStatus.status,
      provider: _appCheckStatus.provider,
      hostname: _appCheckStatus.hostname,
      activated: _appCheckStatus.activated,
      tokenVerified: _appCheckStatus.tokenVerified,
      lastCheckedAt: _appCheckStatus.lastCheckedAt,
      errorCode: _appCheckStatus.errorCode,
    };
  }
}
_publishAppCheckStatus();

// Séparée de initFirebase() pour rester testable isolément et pour que
// l'absence du SDK App Check (firebase.appCheck) — normale tant que le
// script firebase-app-check-compat.js n'est pas chargé — ne fasse jamais
// échouer l'initialisation. IDEMPOTENTE : une seule activation par
// chargement, même si initFirebase()/une restauration la rappelle.
function activateAppCheck() {
  if (_appCheckActivationStarted) return _appCheckInstance;
  _appCheckActivationStarted = true;

  const siteKey = resolveAppCheckSiteKey();
  if (!siteKey) {
    // Domaine non déclaré (tests, file://, dev local, origine inattendue) :
    // ne JAMAIS activer avec une mauvaise clé ; l'app reste en Surveillance.
    _publishAppCheckStatus({ status: 'unconfigured_domain', activated: false });
    console.warn('[MedConnect] App Check : domaine non configuré (' + (_appCheckStatus.hostname || 'inconnu') + ') — activation ignorée, mode Surveillance conservé.');
    return null;
  }
  if (typeof firebase === 'undefined' || !firebase.appCheck) {
    _publishAppCheckStatus({ status: 'sdk_missing', activated: false });
    return null;
  }
  try {
    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider(siteKey),
      true // isTokenAutoRefreshEnabled — laissé actif
    );
    _appCheckInstance = appCheck;
    _publishAppCheckStatus({ status: 'activated', activated: true, errorCode: null });
    return appCheck;
  } catch (err) {
    // Message expurgé : ni jeton, ni clé, ni objet d'erreur complet.
    _publishAppCheckStatus({ status: 'activation_failed', activated: false, errorCode: (err && err.code) || 'activation_error' });
    console.warn('[MedConnect] App Check : activation impossible (étape activate).');
    return null;
  }
}

// Vérification RÉELLE du jeton, UNE SEULE fois par chargement, NON bloquante
// pour Firestore (mode Surveillance). Réutilise l'instance existante, ne force
// pas le renouvellement, timeout 10 s. Ne journalise/expose JAMAIS le jeton.
function verifyAppCheckToken() {
  if (_appCheckTokenPromise) return _appCheckTokenPromise; // une par chargement
  _appCheckTokenPromise = (async () => {
    const inst = _appCheckInstance;
    if (!inst || typeof inst.getToken !== 'function') {
      const code = _appCheckStatus.status === 'unconfigured_domain' ? 'unconfigured_domain'
        : _appCheckStatus.status === 'sdk_missing' ? 'sdk_missing'
        : 'activation_failed';
      _publishAppCheckStatus({ status: code, tokenVerified: false, lastCheckedAt: new Date().toISOString(), errorCode: code });
      return code;
    }
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000));
      await Promise.race([inst.getToken(false), timeout]); // false = ne force pas le renouvellement
      // Succès : on ne journalise ni ne stocke JAMAIS le jeton (ni début, ni
      // fin, ni longueur, ni claims).
      _publishAppCheckStatus({ status: 'valid', tokenVerified: true, lastCheckedAt: new Date().toISOString(), errorCode: null });
      console.log('[MedConnect] App Check : jeton obtenu avec succès.');
      return 'valid';
    } catch (err) {
      const code = String(err && err.message) === 'timeout' ? 'timeout' : 'token_failed';
      _publishAppCheckStatus({ status: code, tokenVerified: false, lastCheckedAt: new Date().toISOString(), errorCode: code });
      console.warn('[MedConnect] App Check : jeton non obtenu — étape getToken — ' + (_appCheckStatus.hostname || 'inconnu') + ' — ' + code);
      return code;
    }
  })();
  return _appCheckTokenPromise;
}
if (typeof window !== 'undefined') { window.verifyAppCheckToken = verifyAppCheckToken; }

// Attend que le jeton App Check soit DISPONIBLE avant un appel soumis à
// enforceAppCheck (ex. la Cloud Function authLookup, seul chemin de
// résolution de compte AVANT authentification sur un appareil neuf).
//
// Sans cette attente, sur une install FRAÎCHE (PWA réinstallée, nouveau
// téléphone…) le premier « Se connecter » part AVANT que reCAPTCHA
// Enterprise ait produit son tout premier jeton (l'activation est lancée
// en arrière-plan). authLookup rejette alors l'appel (jeton absent) et,
// la lecture publique de mc_accounts étant fermée (v2.9.42), plus aucun
// compte n'est trouvé → « compte refusé ». On force donc l'obtention du
// jeton (getToken) une fois, avec un timeout borné, avant de continuer.
//
// Ne bloque JAMAIS durablement : renvoie true si un jeton est prêt, false
// sinon (domaine non configuré, SDK absent, timeout) — l'appelant continue
// de toute façon (le repli patient prend le relais). Ne journalise/expose
// JAMAIS le jeton. Idempotence légère : chaque appel réutilise l'instance
// et le cache de jeton du SDK (getToken(false) ne renvoie un nouvel appel
// réseau que si aucun jeton valide n'est en cache).
function waitForAppCheckToken(timeoutMs = 8000) {
  return (async () => {
    const inst = _appCheckInstance;
    if (!inst || typeof inst.getToken !== 'function') return false;
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs));
      await Promise.race([inst.getToken(false), timeout]);
      return true;
    } catch (_) {
      // Timeout ou échec : on ne journalise pas le jeton ; l'appelant gère.
      return false;
    }
  })();
}
if (typeof window !== 'undefined') { window.waitForAppCheckToken = waitForAppCheckToken; }

/* ── Attente de la restauration Firebase Auth ──────────────
   Au chargement, firebaseAuth.currentUser est synchroniquement null
   jusqu'à ce que le SDK ait fini de restaurer une session persistée
   (bref délai asynchrone). Sans l'attendre, tout code qui lit
   firebaseAuth.currentUser juste après l'init (ex. restauration d'une
   session desktop hôpital, voir hospital-desktop-ui.js) voit toujours
   "personne connecté", même quand une session valide existe — d'où le
   correctif : exposer une promesse résolue une seule fois, dès le
   premier appel de onAuthStateChanged (utilisateur ou null). */
let _resolveFirebaseAuthReady;
window.firebaseAuthReadyPromise = new Promise(resolve => { _resolveFirebaseAuthReady = resolve; });

function initFirebase() {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      _resolveFirebaseAuthReady();
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    activateAppCheck();
    firebaseDB    = firebase.firestore();
    firebaseAuth  = firebase.auth ? firebase.auth() : null;
    // Client Cloud Functions dans la MÊME région que les fonctions déployées
    // (voir functions/index.js REGION). Inerte si le SDK n'est pas chargé.
    try {
      firebaseFunctions = firebase.functions ? firebase.functions('europe-west1') : null;
      if (firebaseFunctions) window.firebaseFunctions = firebaseFunctions;
    } catch (_) { firebaseFunctions = null; }
    firebaseReady = true;

    // Vérification RÉELLE du jeton App Check — UNE fois par chargement, en
    // arrière-plan : ne bloque JAMAIS le démarrage de Firestore (mode
    // Surveillance). Le résultat alimente window.MedConnectAppCheckStatus.
    try { verifyAppCheckToken(); } catch (_) {}

    // Activer la persistance hors-ligne
    firebaseDB.enablePersistence({ synchronizeTabs: true })
      .catch(() => {});

    if (firebaseAuth && typeof firebaseAuth.onAuthStateChanged === 'function') {
      let settled = false;
      const unsubscribe = firebaseAuth.onAuthStateChanged(() => {
        if (settled) return;
        settled = true;
        try { unsubscribe(); } catch (_) {}
        _resolveFirebaseAuthReady();
      });
    } else {
      _resolveFirebaseAuthReady();
    }

  } catch (err) {
    firebaseReady = false;
    _resolveFirebaseAuthReady();
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
