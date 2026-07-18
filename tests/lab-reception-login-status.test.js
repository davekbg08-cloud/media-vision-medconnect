/* =====================================================
   Tests — statut de compte vérifié avant connexion lab/réception

   Découvert en auditant le dépôt : contrairement à
   doctor/nurse/pharmacist (_restoreProfessional, qui appelle
   handleAccountStatusBeforeAuth AVANT tout
   signInWithEmailAndPassword), le chemin lab/reception de
   Auth.loginProfessionalSilently() ne vérifiait jamais le statut du
   compte — un compte rejeté ou suspendu par l'admin (js/admin.js
   reject()/suspend(), qui ne peuvent que changer le statut Firestore,
   jamais désactiver le compte Firebase Auth lui-même : aucun Admin SDK
   sur ce projet, plan Spark) pouvait donc continuer à se connecter
   normalement. Verrouille le comportement attendu après correctif :
   même garde-fou que les autres rôles professionnels.
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

function setup({ firebaseAuthImpl = null, accountData = null } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };

  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
  };
  win.window = win;
  const App = { toast(){}, afterLogin(){} };

  // Une seule requête .where().where().limit().get() : renvoie le
  // compte fourni pour le 1er couple (collection, champ) essayé,
  // vide sinon — suffisant, loginProfessionalSilently s'arrête au
  // premier résultat non vide.
  const firebaseDB = {
    collection: () => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: async () => accountData
              ? { empty: false, docs: [{ id: accountData.uid || 'lab-uid-1', data: () => accountData }] }
              : { empty: true, docs: [] },
          }),
        }),
      }),
    }),
  };

  const sandbox = {
    window: win,
    document: { URL:'https://test/', addEventListener(){}, getElementById: getEl, querySelectorAll:()=>[], createElement: ()=>fakeElement() },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval:()=>0, clearInterval(){}, setTimeout:(fn)=>0,
    crypto: globalThis.crypto,
    firebaseReady: true, firebaseDB, firebaseAuth: firebaseAuthImpl,
    App,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/auth.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { win: sandbox.window };
}

test("loginProfessionalSilently('lab', ...) refuse un compte rejeté sans jamais appeler signInWithEmailAndPassword", async () => {
  let signInCalls = 0;
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'should-not-happen' } }; } };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'lab-uid-1', role: 'lab', matricule: 'LAB1', email: 'lab1@x.com', status: 'rejected' },
  });
  const result = await win.Auth.loginProfessionalSilently('lab', 'LAB1', 'whatever');
  assert.strictEqual(result, null, 'un compte rejeté ne doit jamais retourner de session');
  assert.strictEqual(signInCalls, 0, 'signInWithEmailAndPassword ne doit jamais être appelé pour un compte rejeté');
});

test("loginProfessionalSilently('reception', ...) refuse un compte suspendu sans jamais appeler signInWithEmailAndPassword", async () => {
  let signInCalls = 0;
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'should-not-happen' } }; } };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'rec-uid-1', role: 'reception', matricule: 'REC1', email: 'rec1@x.com', status: 'suspended' },
  });
  const result = await win.Auth.loginProfessionalSilently('reception', 'REC1', 'whatever');
  assert.strictEqual(result, null, 'un compte suspendu ne doit jamais retourner de session');
  assert.strictEqual(signInCalls, 0, 'signInWithEmailAndPassword ne doit jamais être appelé pour un compte suspendu');
});

test("loginProfessionalSilently('lab', ...) fonctionne toujours normalement pour un compte approuvé", async () => {
  let signInCalls = 0;
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'lab-real-uid' } }; } };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'lab-uid-2', role: 'lab', matricule: 'LAB2', email: 'lab2@x.com', status: 'approved', authUid: 'lab-real-uid' },
  });
  const result = await win.Auth.loginProfessionalSilently('lab', 'LAB2', 'whatever');
  assert.strictEqual(signInCalls, 1, 'signInWithEmailAndPassword doit être appelé pour un compte approuvé');
  assert.ok(result, 'un compte approuvé doit retourner une session');
  assert.strictEqual(result.uid, 'lab-real-uid');
});
