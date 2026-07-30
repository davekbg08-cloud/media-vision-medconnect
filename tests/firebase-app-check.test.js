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

function fakeFirebase({ withAppCheckSdk = false, getToken, withFunctions = false } = {}) {
  const activateCalls = [];
  const order = []; // ordre réel des créations de services (init/appcheck/firestore/auth/functions)
  const firebase = {
    apps: [],
    initializeApp() { order.push('init'); firebase.apps.push({}); },
    firestore: () => { order.push('firestore'); return { enablePersistence: async () => {} }; },
    auth: () => { order.push('auth'); return {}; },
  };
  if (withFunctions) firebase.functions = () => { order.push('functions'); return {}; };
  if (withAppCheckSdk) {
    function ReCaptchaEnterpriseProvider(siteKey) { this.siteKey = siteKey; }
    // Instance STABLE : firebase.appCheck() renvoie toujours le même objet,
    // pour vérifier que l'activation réutilise bien la même instance.
    const instance = {
      activate: (provider, autoRefresh) => { order.push('appcheck'); activateCalls.push({ provider, autoRefresh }); },
    };
    if (getToken) instance.getToken = getToken;
    firebase.appCheck = Object.assign(() => instance, { ReCaptchaEnterpriseProvider });
  }
  return { firebase, activateCalls, order };
}

function loadFirebaseConfig({ firebase, sourceOverride, hostname, setTimeoutImpl, consoleImpl } = {}) {
  const win = { addEventListener() {} };
  if (hostname) win.location = { hostname };
  const sandbox = {
    window: win,
    document: { getElementById: () => fakeElement(), addEventListener() {} },
    console: consoleImpl || console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: setTimeoutImpl || (() => 0),
    MutationObserver: class { observe(){} },
    firebase,
  };
  vm.createContext(sandbox);
  const code = sourceOverride ?? fs.readFileSync(path.resolve(__dirname, '..', 'js/firebase-config.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/firebase-config.js' });
  // firebaseReady/firebaseDB/firebaseAuth sont déclarées avec `let` au
  // top-level du script — elles vivent dans l'environnement lexical du
  // contexte vm, PAS comme propriétés de l'objet sandbox. Il faut donc les
  // relire via un second run dans le même contexte. `context` est retourné
  // pour pouvoir rappeler activateAppCheck()/verifyAppCheckToken()/initFirebase().
  const state = vm.runInContext('({ firebaseReady, firebaseDB, firebaseAuth })', sandbox);
  return { context: sandbox, ...sandbox, ...state };
}

// Capture les logs (console.log/warn/error) dans un tableau — pour vérifier
// qu'aucun caractère de jeton n'y apparaît.
function capturingConsole() {
  const lines = [];
  const rec = (...a) => lines.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return { console: { log: rec, warn: rec, error: rec, info: rec }, lines };
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

/* =====================================================
   Chantier « App Check : audit + fiabilisation » (fix/app-check-verification)
   20 tests comportementaux — idempotence, ordre d'init, résolution par
   domaine, vérification RÉELLE du jeton (getToken simulé), statut de
   diagnostic sûr, non-fuite du jeton. Aucune vraie clé/jeton/donnée de prod.
   ===================================================== */

const FAKE_TOKEN = 'FAKE_APPCHECK_TOKEN_ZZZ_ne_doit_jamais_apparaitre_1234567890';

async function loadAndVerify({ getToken, hostname = 'medconnect-e81ba.web.app', setTimeoutImpl, capture } = {}) {
  const cap = capture ? capturingConsole() : null;
  const { firebase, activateCalls, order } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true, getToken });
  const r = loadFirebaseConfig({ firebase, hostname, setTimeoutImpl, consoleImpl: cap ? cap.console : undefined });
  await vm.runInContext('verifyAppCheckToken()', r.context); // mémoïsée : même promesse que l'auto-vérif
  return { r, activateCalls, order, status: r.window.MedConnectAppCheckStatus, lines: cap ? cap.lines : [] };
}

test('01. firebase.initializeApp() est appelé une seule fois (même si initFirebase est rappelé)', () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  const r = loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.strictEqual(firebase.apps.length, 1);
  vm.runInContext('initFirebase()', r.context);
  assert.strictEqual(firebase.apps.length, 1, 'initializeApp ne doit pas être rappelé (firebase.apps.length garde)');
});

test('02. App Check est activé AVANT firestore()', () => {
  const { firebase, order } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.ok(order.includes('appcheck') && order.includes('firestore'));
  assert.ok(order.indexOf('appcheck') < order.indexOf('firestore'), 'appcheck doit précéder firestore');
});

test('03. App Check est activé AVANT auth()', () => {
  const { firebase, order } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.ok(order.indexOf('appcheck') < order.indexOf('auth'), 'appcheck doit précéder auth');
});

test('04. App Check est activé AVANT functions()', () => {
  const { firebase, order } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.ok(order.indexOf('appcheck') < order.indexOf('functions'), 'appcheck doit précéder functions');
});

test('05. Domaine GitHub Pages : bonne clé sélectionnée + activation réussie (jeton valide)', async () => {
  const { activateCalls, status } = await loadAndVerify({
    hostname: 'davekbg08-cloud.github.io',
    getToken: async () => ({ token: FAKE_TOKEN }),
  });
  assert.strictEqual(activateCalls.length, 1);
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAHMhYy1HuKAFqB55vFQqnbkSeCfC');
  assert.strictEqual(status.activated, true);
  assert.strictEqual(status.status, 'valid');
});

test('06. Domaine Firebase Hosting .web.app : bonne clé sélectionnée', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q');
});

test('07. Domaine .firebaseapp.com : bonne clé sélectionnée', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.firebaseapp.com' });
  assert.strictEqual(activateCalls[0].provider.siteKey, '6Lc8RjctAAAAAGRsiWiaaKdHBAJptn54Q0oO724q');
});

test('08. Domaine inconnu : aucune activation + statut unconfigured_domain', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  const r = loadFirebaseConfig({ firebase, hostname: 'exemple-quelconque.invalid' });
  assert.strictEqual(activateCalls.length, 0);
  assert.strictEqual(r.window.MedConnectAppCheckStatus.status, 'unconfigured_domain');
  assert.strictEqual(r.window.MedConnectAppCheckStatus.activated, false);
});

test('09. SDK App Check absent : application non cassée + statut sdk_missing', () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: false, withFunctions: true });
  const r = loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.strictEqual(r.firebaseReady, true, "l'absence du SDK ne doit jamais casser l'init");
  assert.ok(r.firebaseDB);
  assert.strictEqual(r.window.MedConnectAppCheckStatus.status, 'sdk_missing');
});

test('10. Double appel initFirebase : activate appelé une seule fois', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  const r = loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  vm.runInContext('initFirebase()', r.context);
  vm.runInContext('initFirebase()', r.context);
  assert.strictEqual(activateCalls.length, 1, 'App Check ne doit être activé qu\'une fois');
});

test('11. Double appel activateAppCheck : même instance réutilisée (une seule activation)', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  const r = loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  vm.runInContext('activateAppCheck()', r.context);
  vm.runInContext('activateAppCheck()', r.context);
  assert.strictEqual(activateCalls.length, 1, 'aucun second provider ni second activate()');
});

test('12. getToken réussi : statut valid + tokenVerified', async () => {
  const { status } = await loadAndVerify({ getToken: async () => ({ token: FAKE_TOKEN }) });
  assert.strictEqual(status.status, 'valid');
  assert.strictEqual(status.tokenVerified, true);
  assert.strictEqual(status.errorCode, null);
});

test('13. getToken échoué : statut token_failed', async () => {
  const { status } = await loadAndVerify({ getToken: async () => { throw new Error('recaptcha-error'); } });
  assert.strictEqual(status.status, 'token_failed');
  assert.strictEqual(status.tokenVerified, false);
});

test('14. getToken timeout : statut timeout', async () => {
  const { status } = await loadAndVerify({
    getToken: () => new Promise(() => {}), // ne se résout jamais
    setTimeoutImpl: (cb) => { cb(); return 0; }, // le timeout se déclenche
  });
  assert.strictEqual(status.status, 'timeout');
  assert.strictEqual(status.tokenVerified, false);
});

test('15. Aucun caractère du faux jeton n\'apparaît dans les logs', async () => {
  const { lines } = await loadAndVerify({ getToken: async () => ({ token: FAKE_TOKEN }), capture: true });
  const joined = lines.join('\n');
  assert.ok(!joined.includes(FAKE_TOKEN), 'le jeton ne doit jamais être journalisé');
  assert.ok(joined.includes('App Check : jeton obtenu avec succès'), 'seul le message de succès expurgé est journalisé');
});

test('16. Aucun jeton n\'apparaît dans MedConnectAppCheckStatus', async () => {
  const { status } = await loadAndVerify({ getToken: async () => ({ token: FAKE_TOKEN }) });
  assert.ok(!('token' in status), 'pas de champ token dans le statut');
  assert.ok(!JSON.stringify(status).includes(FAKE_TOKEN), 'aucune trace du jeton dans le statut');
});

test('17. isTokenAutoRefreshEnabled reste activé (true)', () => {
  const { firebase, activateCalls } = fakeFirebase({ withAppCheckSdk: true, withFunctions: true });
  loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.strictEqual(activateCalls[0].autoRefresh, true);
});

test('18. Firestore reste initialisé même si App Check échoue (mode Surveillance)', () => {
  const { firebase } = fakeFirebase({ withAppCheckSdk: false, withFunctions: true }); // sdk_missing
  const r = loadFirebaseConfig({ firebase, hostname: 'medconnect-e81ba.web.app' });
  assert.strictEqual(r.firebaseReady, true);
  assert.ok(r.firebaseDB, 'Firestore doit être initialisé malgré l\'échec App Check');
});

test('19. Parité racine / miroir Android de js/firebase-config.js', () => {
  const root = fs.readFileSync(path.resolve(__dirname, '..', 'js/firebase-config.js'), 'utf8');
  const mirror = fs.readFileSync(path.resolve(__dirname, '..', 'android/app/src/main/assets/js/firebase-config.js'), 'utf8');
  assert.strictEqual(root, mirror, 'le miroir Android doit être identique octet pour octet');
});

test('20. Le service worker précache le SDK App Check et js/firebase-config.js', () => {
  const sw = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /const CACHE = 'medconnect-v[0-9.]+'/, 'un nom de cache versionné doit être défini');
  assert.match(sw, /firebase-app-check-compat\.js/, 'le SDK App Check doit être précaché');
  assert.match(sw, /\.\/js\/firebase-config\.js/, 'firebase-config.js doit être précaché');
});
