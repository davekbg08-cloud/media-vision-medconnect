/* =====================================================
   Tests — inscription/connexion établissement (HospitalAuth)

   Verrouille le correctif : establishments/hospitals/mc_hospitals
   n'acceptaient l'écriture que d'un admin — HospitalAuth.register()
   attend désormais une confirmation Firestore réelle avant d'annoncer
   un succès, et supprime le compte Firebase Auth orphelin si le
   serveur refuse (même principe que Auth._createPatientPin, voir
   tests/patient-pin-migration.test.js). Verrouille aussi la migration
   organique du mot de passe hérité (passwordHash → Firebase Auth) :
   plus aucun hash en clair conservé une fois migré.
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
    TextEncoder: globalThis.TextEncoder,
    firebaseReady,
    firebaseDB,
    firebaseAuth: firebaseAuthImpl,
    // FieldValue.delete() : seule son identité importe pour les mocks
    // firebaseDB ci-dessous (ils n'appliquent pas de vraie sémantique
    // Firestore), pas sa valeur réelle.
    firebase: { firestore: { FieldValue: { delete: () => '__DELETE__' } } },
    App,
  };
  vm.createContext(sandbox);

  for (const f of ['js/db.js', 'js/hospitals_registry.js', 'js/hospital-auth.js']) {
    const abs = path.resolve(__dirname, '..', f);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }

  return {
    win: sandbox.window,
    toasts,
    setField: (id, value) => { getEl(id).value = value; },
  };
}

function fakeFirebaseDBOk() {
  return {
    collection: () => ({
      doc: () => ({
        set: async () => {},
        get: async () => ({ exists: false }),
      }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
  };
}

// N'échoue QUE pour les 3 collections établissement — la création du
// compte établissement (register()) écrit d'abord users/{authUid},
// une étape distincte qui doit réussir pour atteindre le code sous
// test (addHospitalAndConfirm) plus loin dans la fonction.
function fakeFirebaseDBRejecting() {
  const REJECTED = ['establishments', 'hospitals', 'mc_hospitals'];
  return {
    collection: (name) => ({
      doc: () => ({
        set: async () => { if (REJECTED.includes(name)) throw new Error('permission-denied'); },
      }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
  };
}

function registerForm(setField, overrides = {}) {
  const f = { name: 'Hôpital Test', mat: 'MAT-1', city: 'Kinshasa', pw: '123456', pw2: '123456', ...overrides };
  setField('ha-reg-name', f.name);
  setField('ha-reg-mat', f.mat);
  setField('ha-reg-city', f.city);
  setField('ha-reg-pw', f.pw);
  setField('ha-reg-pw2', f.pw2);
}

test('HospitalAuth.register : succès — le compte Firebase Auth est conservé et aucun passwordHash stocké', async () => {
  let deleteCalls = 0;
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async () => ({ user: { uid: 'est-uid-ok' } }),
    currentUser: { delete: async () => { deleteCalls++; } },
  };
  const { win, toasts, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBOk() });
  registerForm(setField);

  await win.HospitalAuth.register();

  assert.strictEqual(deleteCalls, 0, 'succès : rien à nettoyer');
  assert.ok(toasts.some(t => /Établissement créé/.test(t.msg)), 'toast de succès attendu');
  const h = win.HospitalsRegistry.getHospitals().find(x => x.officialId === 'MAT-1');
  assert.ok(h, 'établissement enregistré localement');
  assert.strictEqual(h.passwordHash, undefined, 'plus aucun passwordHash stocké pour un nouvel établissement');
  assert.strictEqual(h.authUid, 'est-uid-ok');
});

test('HospitalAuth.register : la confirmation Firestore échoue → le compte Firebase Auth orphelin est supprimé', async () => {
  let deleteCalls = 0;
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async () => ({ user: { uid: 'est-uid-orphan' } }),
    currentUser: { delete: async () => { deleteCalls++; } },
  };
  const { win, toasts, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBRejecting() });
  registerForm(setField, { mat: 'MAT-2' });

  await win.HospitalAuth.register();

  assert.strictEqual(deleteCalls, 1, 'le compte Firebase Auth orphelin doit être supprimé exactement une fois');
  assert.ok(toasts.some(t => /Création refusée/.test(t.msg)), 'message de refus attendu');
  assert.ok(!toasts.some(t => /Établissement créé/.test(t.msg)), 'pas de faux message de succès');
});

test("HospitalAuth.register : n'appelle jamais delete() quand la création Firebase Auth échoue elle-même", async () => {
  let deleteCalls = 0;
  const firebaseAuthImpl = {
    createUserWithEmailAndPassword: async () => { throw new Error('network-error'); },
    currentUser: { delete: async () => { deleteCalls++; } },
  };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBOk() });
  registerForm(setField, { mat: 'MAT-3' });

  await win.HospitalAuth.register();

  assert.strictEqual(deleteCalls, 0, 'rien à nettoyer : aucun compte Firebase Auth créé');
});

test('HospitalAuth.login : établissement moderne (Firebase Auth déjà migré) — pas de vérification de hash, pas de migration', async () => {
  let migrateCalls = 0;
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => ({ user: { uid: 'est-uid-modern' } }),
  };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBOk() });
  win.HospitalsRegistry.addHospital({ name: 'Hôpital Moderne', officialId: 'MAT-MODERN', status: 'active', authUid: 'est-uid-modern' });
  const realMigrate = win.HospitalsRegistry.migratePasswordHashToAuth;
  win.HospitalsRegistry.migratePasswordHashToAuth = async (...args) => { migrateCalls++; return realMigrate(...args); };
  setField('ha-login-mat', 'MAT-MODERN');
  setField('ha-login-pw', 'whatever123');

  await win.HospitalAuth.login();

  assert.strictEqual(migrateCalls, 0, 'un établissement déjà migré ne doit jamais repasser par la migration');
});

test('HospitalAuth.login : établissement hérité (passwordHash) — bon mot de passe migre organiquement vers Firebase Auth', async () => {
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => { throw { code: 'auth/user-not-found' }; },
    createUserWithEmailAndPassword: async () => ({ user: { uid: 'est-uid-migrated' } }),
  };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBOk() });
  const hash = await win.HospitalAuth.hashPassword('legacy-pw-1');
  win.HospitalsRegistry.addHospital({ name: 'Hôpital Hérité', officialId: 'MAT-LEGACY', status: 'active', passwordHash: hash });

  setField('ha-login-mat', 'MAT-LEGACY');
  setField('ha-login-pw', 'legacy-pw-1');

  await win.HospitalAuth.login();

  const h = win.HospitalsRegistry.getHospitals().find(x => x.officialId === 'MAT-LEGACY');
  assert.strictEqual(h.authUid, 'est-uid-migrated', 'authUid doit être posé après migration');
  assert.strictEqual(h.passwordHash, undefined, 'passwordHash doit être retiré après migration réussie');
});

test('HospitalAuth.login : établissement hérité — mauvais mot de passe refusé, aucune migration déclenchée', async () => {
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => { throw { code: 'auth/user-not-found' }; },
    createUserWithEmailAndPassword: async () => { throw new Error('ne doit pas être appelé'); },
  };
  const { win, toasts, setField } = setup({ firebaseAuthImpl, firebaseDB: fakeFirebaseDBOk() });
  const hash = await win.HospitalAuth.hashPassword('legacy-pw-2');
  win.HospitalsRegistry.addHospital({ name: 'Hôpital Hérité', officialId: 'MAT-LEGACY-2', status: 'active', passwordHash: hash });

  setField('ha-login-mat', 'MAT-LEGACY-2');
  setField('ha-login-pw', 'mauvais-mot-de-passe');

  await win.HospitalAuth.login();

  assert.ok(toasts.some(t => /incorrect/i.test(t.msg)));
  const h = win.HospitalsRegistry.getHospitals().find(x => x.officialId === 'MAT-LEGACY-2');
  assert.strictEqual(h.passwordHash, hash, 'le hash hérité reste en place tant que la migration n\'a pas réussi');
});
