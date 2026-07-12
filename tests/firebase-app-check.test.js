/* =====================================================
   Tests — js/firebase-config.js : initFirebase() + App Check

   Verrouille : initFirebase() reste fonctionnel sans clé App Check
   configurée (comportement actuel en production, aucune régression),
   activateAppCheck() est un no-op tant que APP_CHECK_SITE_KEY est vide
   (ne doit jamais planter faute du SDK firebase.appCheck), et une fois
   une clé configurée, firebase.appCheck().activate() est bien appelé
   avec un ReCaptchaEnterpriseProvider et isTokenAutoRefreshEnabled=true.
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

function loadFirebaseConfig({ firebase, sourceOverride } = {}) {
  const win = { addEventListener() {} };
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

test("initFirebase() fonctionne normalement sans clé App Check configurée (APP_CHECK_SITE_KEY vide en production)", () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: true });
  const sandbox = loadFirebaseConfig({ firebase });
  assert.strictEqual(sandbox.firebaseReady, true);
  assert.ok(sandbox.firebaseDB);
  assert.ok(sandbox.firebaseAuth);
});

test("activateAppCheck() ne plante jamais si firebase.appCheck (le SDK) n'est pas chargé", () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: false });
  const sandbox = loadFirebaseConfig({ firebase });
  assert.strictEqual(sandbox.firebaseReady, true, "l'absence du SDK App Check ne doit jamais casser l'initialisation Firebase principale");
});

test("activateAppCheck() est un no-op tant que APP_CHECK_SITE_KEY est vide, même si le SDK est chargé", () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  loadFirebaseConfig({ firebase });
  assert.strictEqual(activateCalls.length, 0, "aucune activation ne doit être tentée sans clé configurée");
});

test('activateAppCheck() active bien App Check (ReCaptchaEnterpriseProvider, isTokenAutoRefreshEnabled=true) une fois une clé configurée', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true });
  const realSource = fs.readFileSync(path.resolve(__dirname, '..', 'js/firebase-config.js'), 'utf8');
  const withKey = realSource.replace('const APP_CHECK_SITE_KEY = "";', 'const APP_CHECK_SITE_KEY = "test-site-key-123";');
  assert.notStrictEqual(withKey, realSource, "le remplacement doit avoir trouvé la ligne exacte à substituer");

  loadFirebaseConfig({ firebase, sourceOverride: withKey });

  assert.strictEqual(activateCalls.length, 1);
  assert.strictEqual(activateCalls[0].provider.siteKey, 'test-site-key-123');
  assert.strictEqual(activateCalls[0].autoRefresh, true);
});
