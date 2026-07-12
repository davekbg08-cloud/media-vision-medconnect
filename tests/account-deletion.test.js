/* =====================================================
   Tests — Suppression de compte self-service
   (Auth._deleteMyAccount / Auth._confirmDeleteMyAccount)

   Verrouille : la suppression exige une ré-authentification réussie
   avant toute suppression Firestore ; mc_accounts est la seule étape
   dont l'échec bloque la suite (les autres collections sont
   best-effort) ; l'utilisateur Firebase Auth n'est supprimé qu'après
   la confirmation de la suppression de mc_accounts ; la session locale
   est nettoyée après un succès complet.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function fakeElement() {
  return { value: '', innerHTML: '', style: { display: '' }, classList: { add(){}, remove(){}, toggle(){} }, addEventListener(){} };
}

function setup({ firebaseAuthImpl = null, firebaseReady = true, firebaseDB = undefined, firebaseImpl = undefined, toasts = [] } = {}) {
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
    openModal: () => {},
    closeModal: () => {},
  };
  const I18n = { renderSelector: () => '' };

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
    firebase: firebaseImpl,
    App,
    I18n,
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
    errorText: (id = 'del-acc-err') => getEl(id).innerHTML,
  };
}

// Mock firebase.auth.EmailAuthProvider — seul usage de ce global dans
// tout le dépôt (reauthenticateWithCredential exige un objet
// credential opaque, jamais inspecté au-delà de sa présence ici).
function fakeFirebaseGlobal() {
  return { auth: { EmailAuthProvider: { credential: (email, pass) => ({ email, pass }) } } };
}

function fakeEvent() { return { preventDefault: () => {} }; }

test("Auth._confirmDeleteMyAccount refuse sans mot de passe/PIN saisi", async () => {
  const { win, setField, errorText } = setup({ firebaseAuthImpl: {}, firebaseImpl: fakeFirebaseGlobal() });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'PAT_MC-1', role: 'patient' }));
  await win.Auth._confirmDeleteMyAccount(fakeEvent());
  assert.match(errorText(), /saisir votre mot de passe/i);
});

test("Auth._confirmDeleteMyAccount refuse si Firebase indisponible", async () => {
  const { win, setField, errorText } = setup({ firebaseAuthImpl: null, firebaseImpl: fakeFirebaseGlobal() });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'PAT_MC-1', role: 'patient' }));
  setField('del-acc-pass', '123456');
  await win.Auth._confirmDeleteMyAccount(fakeEvent());
  assert.match(errorText(), /connexion internet requise/i);
});

test("Auth._confirmDeleteMyAccount : mauvais PIN/mot de passe refusé, aucune suppression tentée", async () => {
  let deleteCalled = false;
  const firebaseAuthImpl = {
    currentUser: {
      email: 'patient-mc-1@patients.medconnect.internal',
      reauthenticateWithCredential: async () => { const e = new Error('wrong'); e.code = 'auth/wrong-password'; throw e; },
      delete: async () => { deleteCalled = true; },
    },
  };
  const { win, setField, errorText } = setup({ firebaseAuthImpl, firebaseDB: {}, firebaseImpl: fakeFirebaseGlobal() });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'PAT_MC-1', role: 'patient' }));
  setField('del-acc-pass', 'wrong-pin');
  await win.Auth._confirmDeleteMyAccount(fakeEvent());
  assert.match(errorText(), /PIN incorrect/i);
  assert.strictEqual(deleteCalled, false);
});

test("Auth._confirmDeleteMyAccount : succès complet (patient) supprime mc_accounts, l'utilisateur Firebase Auth, et nettoie la session locale", async () => {
  const deletedDocs = [];
  let authUserDeleted = false;
  const firebaseAuthImpl = {
    currentUser: {
      uid: 'firebase-real-uid-1',
      email: 'patient-mc-1@patients.medconnect.internal',
      reauthenticateWithCredential: async () => {},
      delete: async () => { authUserDeleted = true; },
    },
  };
  const firebaseDB = {
    collection: (name) => ({
      doc: (id) => ({ delete: async () => { deletedDocs.push(`${name}/${id}`); } }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
  const { win, setField, toasts } = setup({ firebaseAuthImpl, firebaseDB, firebaseImpl: fakeFirebaseGlobal() });
  win.localStorage.setItem('mc_accounts', JSON.stringify([{ uid: 'PAT_MC-1', role: 'patient' }, { uid: 'PAT_MC-2', role: 'patient' }]));
  win.localStorage.setItem('mc_my_patient_id', 'MC-1');
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'PAT_MC-1', role: 'patient' }));
  setField('del-acc-pass', '123456');

  await win.Auth._confirmDeleteMyAccount(fakeEvent());

  assert.ok(deletedDocs.includes('mc_accounts/PAT_MC-1'), 'mc_accounts doit être supprimé');
  assert.ok(deletedDocs.includes('users/PAT_MC-1'), 'users doit être supprimé (best-effort)');
  assert.strictEqual(authUserDeleted, true, "l'utilisateur Firebase Auth doit être supprimé après mc_accounts");
  assert.strictEqual(win.sessionStorage.getItem('mc_user'), null, 'la session locale doit être nettoyée');
  assert.strictEqual(win.localStorage.getItem('mc_my_patient_id'), null);
  const remaining = JSON.parse(win.localStorage.getItem('mc_accounts'));
  assert.deepStrictEqual(remaining.map(a => a.uid), ['PAT_MC-2'], "le compte supprimé doit disparaître du cache local");
  assert.ok(toasts.some(t => /supprimé/i.test(t.msg)));
});

test("Auth._confirmDeleteMyAccount : échec de suppression mc_accounts bloque la suppression du compte Firebase Auth", async () => {
  let authUserDeleted = false;
  const firebaseAuthImpl = {
    currentUser: {
      uid: 'firebase-real-uid-2',
      email: 'doctor@example.com',
      reauthenticateWithCredential: async () => {},
      delete: async () => { authUserDeleted = true; },
    },
  };
  const firebaseDB = {
    collection: (name) => ({
      doc: (id) => ({
        delete: async () => {
          if (name === 'mc_accounts') throw new Error('denied');
        },
      }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
  const { win, setField, errorText } = setup({ firebaseAuthImpl, firebaseDB, firebaseImpl: fakeFirebaseGlobal() });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'firebase-real-uid-2', role: 'doctor' }));
  setField('del-acc-pass', 'goodpass');

  await win.Auth._confirmDeleteMyAccount(fakeEvent());

  assert.match(errorText(), /suppression refusée/i);
  assert.strictEqual(authUserDeleted, false, "l'utilisateur Firebase Auth ne doit pas être supprimé si mc_accounts a échoué");
});

test("Auth._confirmDeleteMyAccount (professionnel) supprime aussi la collection de rôle (doctors)", async () => {
  const deletedDocs = [];
  const firebaseAuthImpl = {
    currentUser: {
      uid: 'firebase-real-uid-3',
      email: 'doctor2@example.com',
      reauthenticateWithCredential: async () => {},
      delete: async () => {},
    },
  };
  const firebaseDB = {
    collection: (name) => ({
      doc: (id) => ({ delete: async () => { deletedDocs.push(`${name}/${id}`); } }),
      where: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
  const { win, setField } = setup({ firebaseAuthImpl, firebaseDB, firebaseImpl: fakeFirebaseGlobal() });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'firebase-real-uid-3', role: 'doctor' }));
  setField('del-acc-pass', 'goodpass');

  await win.Auth._confirmDeleteMyAccount(fakeEvent());

  assert.ok(deletedDocs.includes('doctors/firebase-real-uid-3'), 'la collection de rôle (doctors) doit être supprimée pour un professionnel');
  assert.ok(deletedDocs.includes('mc_accounts/firebase-real-uid-3'));
});
