/* =====================================================
   Tests — PARTIE B : PIN patient → Firebase Authentication

   Verrouille : plus aucun PIN/mot de passe patient en clair écrit
   dans mc_accounts (Auth._createPatientPin utilise Firebase Auth via
   un email synthétique) ; la connexion (Auth._doPatient) vérifie via
   Firebase Auth pour les comptes migrés, et migre organiquement (sans
   jamais recopier le PIN) les comptes hérités qui portent encore un
   champ password en clair — la suppression de ce champ n'a lieu QUE
   si le compte Firebase Auth a bien été créé.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function fakeElement() {
  return { value: '', innerHTML: '', style: { display: '' }, classList: { add(){}, remove(){}, toggle(){} } };
}

function setup({ firebaseAuthImpl = null, firebaseReady = true, firebaseDB = undefined, toasts = [] } = {}) {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, fakeElement());
    return elements.get(id);
  };

  const win = {
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 },
    innerWidth: 1280,
    localStorage: makeMemoryStorage(),
    sessionStorage: makeMemoryStorage(),
    setInterval: () => 0,
    clearInterval: () => {},
    HospitalsRegistry: undefined,
  };
  win.window = win;

  const App = {
    toast: (msg, kind) => toasts.push({ msg, kind }),
    afterLogin: () => {},
  };

  const sandbox = {
    window: win,
    document: {
      URL: 'https://test/',
      addEventListener: () => {},
      getElementById: getEl,
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
    },
    navigator: win.navigator,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => 0,
    crypto: globalThis.crypto,
    firebaseReady,
    firebaseDB,
    firebaseAuth: firebaseAuthImpl,
    App,
  };
  vm.createContext(sandbox);

  for (const f of ['js/db.js', 'js/auth.js']) {
    const abs = path.resolve(__dirname, '..', f);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }

  return {
    win: sandbox.window,
    toasts,
    setField: (id, value) => { getEl(id).value = value; },
    errorText: (id = 'auth-err') => getEl(id).innerHTML,
  };
}

function seedPatient(win) {
  const p = win.DB.addPatient({ firstname: 'Jean', lastname: 'Kabila', country_code: 'CD' });
  return p.id;
}

// Code d'accès hôpital (chantier séparé) : requis désormais par
// Auth._createPatientPin, vérifié côté serveur (firestore.rules) contre
// mc_patients/{id}.firstAccessCode — voir js/db.js addPatient.
function accessCodeFor(win, id) {
  return win.DB.getPatientById(id)?.firstAccessCode || '';
}

// Mock minimal de firebaseDB : suffisant pour que DB.pushAndReport
// (confirmation cloud réelle avant d'annoncer un succès, même principe
// que _reg) résolve à un succès dans ces tests.
function fakeFirebaseDB() {
  return { collection: () => ({ doc: () => ({ set: async () => {} }) }) };
}

test("Auth._createPatientPin n'écrit jamais password/pin en clair dans mc_accounts (Firebase Auth dispo)", async () => {
  let createdWith = null;
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async (email, pass) => {
      createdWith = { email, pass };
      return { user: { uid: 'firebase-uid-abc' } };
    },
  };
  const { win, setField, toasts } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDB() });
  const id = seedPatient(win);
  setField('lp-id', id);
  setField('lp-pin', '123456');
  setField('lp-access-code', accessCodeFor(win, id));

  await win.Auth._createPatientPin();

  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.ok(acc, 'un compte doit être créé');
  assert.strictEqual(acc.password, undefined, 'aucun champ password en clair');
  assert.strictEqual(acc.pin, undefined, 'aucun champ pin en clair');
  assert.strictEqual(acc.authUid, 'firebase-uid-abc', 'authUid doit provenir de Firebase Auth');
  assert.strictEqual(acc.uid, `PAT_${id}`, 'uid stable PAT_{id} préservé (jamais remplacé par authUid)');
  assert.ok(createdWith.email.includes('@patients.medconnect.internal'), 'email synthétique attendu');
  assert.strictEqual(createdWith.pass, '123456');
  assert.ok(toasts.some(t => /Bienvenue/.test(t.msg)));
});

test('Auth._createPatientPin complète un PIN de 4 chiffres à 6 caractères pour Firebase Auth (sans changer le PIN affiché)', async () => {
  let createdWith = null;
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async (email, pass) => { createdWith = { email, pass }; return { user: { uid: 'uid1' } }; },
  };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDB() });
  const id = seedPatient(win);
  setField('lp-id', id);
  setField('lp-pin', '123456'); // >= 6 chiffres requis à la création désormais
  setField('lp-access-code', accessCodeFor(win, id));
  await win.Auth._createPatientPin();
  assert.strictEqual(createdWith.pass, '123456');
});

test('Auth._createPatientPin refuse un PIN de moins de 6 chiffres', async () => {
  const { win, setField, errorText } = setup({ firebaseAuthImpl: null });
  const id = seedPatient(win);
  setField('lp-id', id);
  setField('lp-pin', '1234');
  await win.Auth._createPatientPin();
  assert.match(errorText(), /trop court/);
  assert.strictEqual(win.DB.getAccounts().length, 0, 'aucun compte ne doit être créé');
});

// Chantier "code d'accès hôpital" (suite à la revue de sécurité de la
// PR #1) : ferme la préemption de compte par un tiers connaissant
// seulement le numéro de fiche — le code, donné par le personnel à la
// création de la fiche (js/db.js addPatient), est désormais requis au
// premier accès, en plus du PIN.
test("Auth._createPatientPin refuse la création sans code d'accès (client), même avec un PIN valide", async () => {
  const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: 'should-not-be-called' } }) };
  const { win, setField, errorText } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDB() });
  const id = seedPatient(win);
  setField('lp-id', id);
  setField('lp-pin', '123456');
  // lp-access-code volontairement laissé vide.
  await win.Auth._createPatientPin();
  assert.match(errorText(), /Code d'accès requis/);
  assert.strictEqual(win.DB.getAccounts().length, 0, 'aucun compte ne doit être créé sans code');
});

test("Auth._createPatientPin transmet le code d'accès saisi à l'écriture mc_accounts (vérifié côté serveur par firestore.rules)", async () => {
  const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: 'uid-access-code-test' } }) };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDB() });
  const id = seedPatient(win);
  const code = accessCodeFor(win, id);
  assert.ok(code, 'la fiche doit porter un code d\'accès généré à sa création');
  setField('lp-id', id);
  setField('lp-pin', '123456');
  setField('lp-access-code', code.toLowerCase()); // saisie insensible à la casse
  await win.Auth._createPatientPin();
  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.ok(acc, 'le compte doit être créé avec le bon code');
  assert.strictEqual(acc.firstAccessCode, code, 'le code transmis correspond à celui de la fiche (comparé côté règles, pas ici)');
});

// Correctif (revue de sécurité) : créer quand même le compte sans
// authUid produisait un compte fantôme — aucun secret Firebase Auth
// réel, et plus aucun password/pin local (PARTIE B) : la prochaine
// tentative de connexion tente un signInWithEmailAndPassword contre un
// utilisateur Firebase qui n'existe pas, et il n'y a plus rien à quoi
// se rattraper. Le patient reste verrouillé hors de son propre dossier
// après une simple panne réseau transitoire. On refuse maintenant la
// création plutôt que de produire ce compte inutilisable.
test("Auth._createPatientPin sans Firebase Auth disponible (hors-ligne) : refuse la création plutôt qu'un compte fantôme sans secret", async () => {
  const { win, setField, errorText } = setup({ firebaseAuthImpl: null });
  const id = seedPatient(win);
  setField('lp-id', id);
  setField('lp-pin', '123456');
  setField('lp-access-code', accessCodeFor(win, id));
  await win.Auth._createPatientPin();
  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.strictEqual(acc, undefined, 'aucun compte fantôme ne doit être créé sans authUid');
  assert.match(errorText(), /connexion internet/);
});

test('Auth._doPatient (compte déjà migré) : vérifie via Firebase Auth, jamais de comparaison en clair', async () => {
  let signedInWith = null;
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async (email, pass) => { signedInWith = { email, pass }; return { user: { uid: 'firebase-uid-abc' } }; },
  };
  const { win, setField } = setup({ firebaseAuthImpl });
  const id = seedPatient(win);
  win.DB.saveAccounts([{ uid: `PAT_${id}`, username: id, role: 'patient', status: 'approved', patient_id: id, email: `patient-${id.toLowerCase().replace(/[^a-z0-9]/g,'')}@patients.medconnect.internal`, authUid: 'firebase-uid-abc' }]);
  setField('lp-id', id);
  setField('lp-pin', '123456');
  await win.Auth._doPatient();
  assert.ok(signedInWith, 'doit tenter une connexion Firebase Auth');
  assert.strictEqual(signedInWith.pass, '123456');
  assert.strictEqual(win.Auth.getUser()?.uid, `PAT_${id}`, 'uid stable conservé après connexion');
});

test('Auth._doPatient (compte migré) : PIN incorrect refusé sans jamais toucher au mot de passe local', async () => {
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => { const e = new Error('wrong'); e.code = 'auth/invalid-credential'; throw e; },
  };
  const { win, setField, errorText } = setup({ firebaseAuthImpl });
  const id = seedPatient(win);
  win.DB.saveAccounts([{ uid: `PAT_${id}`, username: id, role: 'patient', status: 'approved', patient_id: id, email: 'x@patients.medconnect.internal', authUid: 'uid1' }]);
  setField('lp-id', id);
  setField('lp-pin', '999999');
  await win.Auth._doPatient();
  assert.match(errorText(), /PIN incorrect/);
  assert.strictEqual(win.Auth.getUser(), null, 'la session ne doit pas être ouverte');
});

test("Auth._doPatient migre un compte hérité (PIN en clair) vers Firebase Auth et supprime password SEULEMENT si l'authUid a bien été obtenu", async () => {
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async (email, pass) => ({ user: { uid: 'migrated-uid' } }),
  };
  const { win, setField } = setup({ firebaseAuthImpl });
  const id = seedPatient(win);
  // Compte hérité : password en clair, pas d'email ni d'authUid.
  win.DB.saveAccounts([{ uid: `PAT_${id}`, username: id, role: 'patient', status: 'approved', patient_id: id, password: '42'+'42' }]);
  setField('lp-id', id);
  setField('lp-pin', '4242');
  await win.Auth._doPatient();

  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.strictEqual(acc.password, undefined, 'le PIN en clair doit disparaître après migration réussie');
  assert.strictEqual(acc.authUid, 'migrated-uid');
  assert.ok(acc.email, 'un email synthétique doit avoir été posé');
  assert.strictEqual(win.Auth.getUser()?.uid, `PAT_${id}`);
});

test("Auth._doPatient : si la migration Firebase échoue (hors-ligne), l'ancien PIN reste temporairement (jamais supprimé sans authUid confirmé), mais la connexion réussit quand même", async () => {
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async () => { throw new Error('network-error'); },
  };
  const { win, setField } = setup({ firebaseAuthImpl });
  const id = seedPatient(win);
  win.DB.saveAccounts([{ uid: `PAT_${id}`, username: id, role: 'patient', status: 'approved', patient_id: id, password: '42'+'42' }]);
  setField('lp-id', id);
  setField('lp-pin', '4242');
  await win.Auth._doPatient();

  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.strictEqual(acc.password, '4242', 'le champ password reste tant que la migration Firebase Auth n\'a pas confirmé un authUid');
  assert.strictEqual(win.Auth.getUser()?.uid, `PAT_${id}`, 'la connexion doit malgré tout réussir cette fois (PIN vérifié avec succès)');
});

test("Auth._doPatient migré : le compte n'est jamais réidentifié par l'uid Firebase réel (uid stable PAT_ préservé, pas de casse d'adressage mc_accounts)", async () => {
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => ({ user: { uid: 'un-tout-autre-uid-firebase' } }),
  };
  const { win, setField } = setup({ firebaseAuthImpl });
  const id = seedPatient(win);
  win.DB.saveAccounts([{ uid: `PAT_${id}`, username: id, role: 'patient', status: 'approved', patient_id: id, email: 'x@patients.medconnect.internal', authUid: 'ancien-uid' }]);
  setField('lp-id', id);
  setField('lp-pin', '123456');
  await win.Auth._doPatient();
  const acc = win.DB.getAccounts().find(a => a.patient_id === id);
  assert.strictEqual(acc.uid, `PAT_${id}`, 'uid ne doit JAMAIS être remplacé par un uid Firebase — casserait mc_accounts/{uid}');
});
