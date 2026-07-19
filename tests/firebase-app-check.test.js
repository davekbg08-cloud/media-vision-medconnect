/* =====================================================
   Tests — js/firebase-config.js : initFirebase() + App Check

   Verrouille : initFirebase() reste fonctionnel sans clé App Check
   configurée (comportement actuel en production, aucune régression),
   activateAppCheck() est un no-op tant qu'aucune clé n'est résolue pour
   le domaine courant (ne doit jamais planter faute du SDK
   firebase.appCheck, ni faute de window.location dans un sandbox de
   test), et firebase.appCheck().activate() est bien appelé avec un
   ReCaptchaEnterpriseProvider et isTokenAutoRefreshEnabled=true une fois
   une clé résolue.

   Chantier "App Check par domaine" : la même PWA est chargée depuis 2
   origines (GitHub Pages pour l'APK/Electron, miroir Firebase Hosting) —
   reCAPTCHA Enterprise restreint chaque clé à ses domaines déclarés,
   donc resolveAppCheckSiteKey() choisit la clé selon
   window.location.hostname (voir js/firebase-config.js,
   APP_CHECK_SITE_KEYS) plutôt qu'une seule constante fixe.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement() {
  return { value: '', innerHTML: '', style: { display: '' }, classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){} };
}

function fakeFirebase({ withAppCheckSdk = false } = {}) {
  const activateCalls = [];
  const firebase = {
    apps: [],
    initializeApp() { firebase.apps.push({}); },
    firestore: () => ({ enablePersistence: async () => {} }),
    auth: () => ({}),
  };
  if (withAppCheckSdk) {
    function ReCaptchaEnterpriseProvider(siteKey) { this.siteKey = siteKey; }
    firebase.appCheck = Object.assign(
      () => ({ activate: (provider, autoRefresh) => activateCalls.push({ provider, autoRefresh }) }),
      { ReCaptchaEnterpriseProvider }
    );
  }
  return { firebase, activateCalls };
}

function loadFirebaseConfig({ firebase, sourceOverride, hostname } = {}) {
  const win = { addEventListener() {} };
  if (hostname) win.location = { hostname };
  const sandbox = {
    window: win,
    document: { getElementById: () => fakeElement(), addEventListener() {} },
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    MutationObserver: class { observe(){} },
    firebase,
  };
  vm.createContext(sandbox);
  const code = sourceOverride ?? fs.readFileSync(path.resolve(__dirname, '..', 'js/firebase-config.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/firebase-config.js' });
  // firebaseReady/firebaseDB/firebaseAuth sont déclarées avec `let` au
  // top-level du script — elles vivent dans l'environnement lexical du
  // contexte vm, PAS comme propriétés de l'objet sandbox (contrairement
  // à js/db.js/js/auth.js qui font explicitement `window.DB = DB`). Il
  // faut donc les relire via un second run dans le même contexte.
  const state = vm.runInContext('({ firebaseReady, firebaseDB, firebaseAuth })', sandbox);
  return { ...sandbox, ...state };
}

test("initFirebase() fonctionne normalement sur un domaine non reconnu (aucune clé App Check résolue, sandbox de test sans window.location)", () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: true });
  const sandbox = loadFirebaseConfig({ firebase });
  assert.strictEqual(sandbox.firebaseReady, true);
  assert.ok(sandbox.firebaseDB);
  assert.ok(sandbox.firebaseAuth);
});

test("activateAppCheck() ne plante jamais si firebase.appCheck (le SDK) n'est pas chargé", () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: false });
  const sandbox = loadFirebaseConfig({ firebase, hostname: 'davekbg08-cloud.github.io' });
  assert.strictEqual(sandbox.firebaseReady, true, "l'absence du SDK App Check ne doit jamais casser l'initialisation Firebase principale");
});

test("activateAppCheck() est un no-op sur un domaine sans clé résolue (aucun window.location, ex. sandbox de test)", () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase });
  assert.strictEqual(activateCalls.length, 0, "aucune activation ne doit être tentée sans clé résolue pour ce domaine");
});

test("activateAppCheck() est un no-op sur un domaine INCONNU (ni GitHub Pages ni Firebase Hosting) même avec le SDK chargé", () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase, hostname: 'exemple-quelconque.invalid' });
  assert.strictEqual(activateCalls.length, 0, "un domaine non déclaré dans APP_CHECK_SITE_KEYS ne doit jamais activer App Check");
});

test('activateAppCheck() active App Check sur davekbg08-cloud.github.io (APK/Electron) avec la clé dédiée à ce domaine', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase, hostname: 'davekbg08-cloud.github.io' });

  assert.strictEqual(activateCalls.length, 1);
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAHMhYy1HuKAFqB55vFQqnbkSeCfC');
  assert.strictEqual(activateCalls[0].autoRefresh, true);
});

test('activateAppCheck() active App Check sur medconnect-e81ba.web.app (miroir Firebase Hosting) avec la clé dédiée à ce domaine', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });

  assert.strictEqual(activateCalls.length, 1);
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q');
  assert.strictEqual(activateCalls[0].autoRefresh, true);
});

test('activateAppCheck() active App Check sur medconnect-e81ba.firebaseapp.com avec la même clé que .web.app', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.firebaseapp.com' });

  assert.strictEqual(activateCalls.length, 1);
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q');
});
