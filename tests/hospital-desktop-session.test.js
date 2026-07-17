/* =====================================================
   Tests — Session professionnelle desktop & session fantôme
   (chantier fix/desktop-session-routing-packaging)

   Couvre les points SESSION 1-7 de l'audit :
   1. loginProfessionalSilently réussi crée sessionStorage.mc_user.
   2. uid et authUid correspondent au vrai firebaseAuth.currentUser.uid.
   3. Une authentification échouée ne crée aucune session.
   4. Un compte pending/rejected/suspended ne crée aucune session.
   5. Une affiliation refusée supprime la session et déconnecte Firebase.
   6. CloudDB.getCurrentUserProfile() fonctionne après le login desktop.
   7. Une session hospitalière sans utilisateur Firebase valide n'ouvre
      pas HospitalDesktopUI (via HospitalAuth.isSessionConsistent()).
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

/**
 * Sandbox partagé chargeant db.js + auth.js + hospital-auth.js, avec
 * firebaseAuth/firebaseDB/HospitalsRegistry entièrement simulables par
 * test (bare globals — même technique que lab-reception-login-status.test.js).
 */
function setup({ firebaseAuthImpl = null, accountData = null, hospitalsRegistryImpl = null } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };

  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
    HospitalsRegistry: hospitalsRegistryImpl || undefined,
  };
  win.window = win;
  const App = { toast(){}, afterLogin(){}, closeModal(){}, openModal(){} };

  // Requête chaînable générique : accepte n'importe quelle combinaison
  // de .where(...) (un seul, comme resolveProfessionalAccountFromFirestore,
  // ou plusieurs, comme la résolution lab/reception de
  // loginProfessionalSilently) avant .limit(...).get().
  function makeChainableQuery() {
    const q = {
      where: () => q,
      limit: () => q,
      get: async () => accountData
        ? { empty: false, docs: [{ id: accountData.uid || 'agent-uid-1', data: () => accountData }] }
        : { empty: true, docs: [] },
    };
    return q;
  }
  const firebaseDB = { collection: () => makeChainableQuery() };

  const sandbox = {
    window: win,
    document: { URL:'https://test/', addEventListener(){}, getElementById: getEl, querySelectorAll:()=>[], createElement: ()=>fakeElement() },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval:()=>0, clearInterval(){}, setTimeout:(fn)=>0,
    crypto: globalThis.crypto,
    firebaseReady: true, firebaseDB, firebaseAuth: firebaseAuthImpl,
    HospitalsRegistry: hospitalsRegistryImpl || undefined,
    App,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/auth.js', 'js/hospital-auth.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { win: sandbox.window, sandbox, getEl, App };
}

/* ── 1 & 2. Session créée + uid/authUid = vrai uid Firebase ────── */
test('loginProfessionalSilently("doctor", ...) réussi crée sessionStorage.mc_user avec uid=authUid=uid Firebase confirmé', async () => {
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => ({ user: { uid: 'doctor-real-fb-uid' } }) };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'doctor-local-id', role: 'doctor', order_num: 'DOC1', email: 'doc1@x.com', status: 'approved', name: 'Dr Test' },
  });
  const result = await win.Auth.loginProfessionalSilently('doctor', 'DOC1', 'whatever');
  assert.ok(result, 'une session doit être retournée pour un compte approuvé');
  assert.strictEqual(result.uid, 'doctor-real-fb-uid');
  assert.strictEqual(result.authUid, 'doctor-real-fb-uid');

  const stored = JSON.parse(win.sessionStorage.getItem('mc_user'));
  assert.ok(stored, 'sessionStorage.mc_user doit être créé après un login desktop réussi');
  assert.strictEqual(stored.uid, 'doctor-real-fb-uid');
  assert.strictEqual(stored.authUid, 'doctor-real-fb-uid');
  assert.strictEqual(stored.professionalNumber, 'DOC1');
});

/* ── 3. Authentification échouée → aucune session ───────────────── */
test('loginProfessionalSilently() : un mot de passe refusé par Firebase Auth ne crée aucune session', async () => {
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { throw new Error('auth/wrong-password'); } };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'doctor-local-id', role: 'doctor', order_num: 'DOC2', email: 'doc2@x.com', status: 'approved' },
  });
  const result = await win.Auth.loginProfessionalSilently('doctor', 'DOC2', 'wrong');
  assert.strictEqual(result, null);
  assert.strictEqual(win.sessionStorage.getItem('mc_user'), null, 'aucune session ne doit être créée après un échec d\'authentification');
});

/* ── 4. Statut pending/rejected/suspended → aucune session ──────── */
for (const status of ['pending', 'rejected', 'suspended']) {
  test(`loginProfessionalSilently() : un compte de statut "${status}" ne crée aucune session`, async () => {
    let signInCalls = 0;
    const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'should-not-happen' } }; } };
    const { win } = setup({
      firebaseAuthImpl,
      accountData: { uid: 'doctor-local-id', role: 'doctor', order_num: 'DOC3', email: 'doc3@x.com', status },
    });
    const result = await win.Auth.loginProfessionalSilently('doctor', 'DOC3', 'whatever');
    assert.strictEqual(result, null);
    assert.strictEqual(signInCalls, 0, `signInWithEmailAndPassword ne doit jamais être appelé pour un compte ${status}`);
    assert.strictEqual(win.sessionStorage.getItem('mc_user'), null);
  });
}

/* ── Compte sans email ET sans mot de passe local : aucune vérification
   possible → aucune session (correctif du chantier). ────────────── */
test('loginProfessionalSilently() : un compte sans email et sans mot de passe local (aucune vérification possible) ne crée aucune session', async () => {
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => ({ user: { uid: 'should-not-happen' } }) };
  const { win } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'doctor-local-id', role: 'doctor', order_num: 'DOC4', status: 'approved' }, // pas d'email, pas de password
  });
  const result = await win.Auth.loginProfessionalSilently('doctor', 'DOC4', 'whatever');
  assert.strictEqual(result, null);
});

/* ── 6. CloudDB.getCurrentUserProfile() fonctionne après le login ── */
test('CloudDB.getCurrentUserProfile() résout normalement après un login desktop (mc_user présent)', async () => {
  const firebaseAuthImpl = { signInWithEmailAndPassword: async () => ({ user: { uid: 'nurse-real-fb-uid' } }) };
  const { win, sandbox } = setup({
    firebaseAuthImpl,
    accountData: { uid: 'nurse-local-id', role: 'nurse', matricule: 'NUR1', email: 'nurse1@x.com', status: 'approved', name: 'Inf. Test' },
  });
  await win.Auth.loginProfessionalSilently('nurse', 'NUR1', 'whatever');

  // Charge cloud-db.js dans le MÊME contexte, pour qu'il retrouve
  // window.Auth déjà peuplé par le login qui précède.
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/cloud-db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/cloud-db.js' });
  const profile = await sandbox.window.CloudDB.getCurrentUserProfile();
  assert.ok(profile, 'getCurrentUserProfile() doit résoudre un profil (pas de "Session expirée")');
  assert.strictEqual(profile.uid, 'nurse-real-fb-uid');
});

/* ── 7. isSessionConsistent() : sans utilisateur Firebase valide,
   une session hôpital restaurée est jugée invalide. ─────────────── */
test('HospitalAuth.isSessionConsistent() : refuse une session sans firebaseAuth.currentUser', async () => {
  const { win } = setup({ firebaseAuthImpl: { currentUser: null } });
  const session = {
    establishmentId: 'EST1', agentUid: 'agent-1', role: 'doctor',
    loggedAt: new Date().toISOString(),
  };
  const ok = await win.HospitalAuth.isSessionConsistent(session);
  assert.strictEqual(ok, false);
});

test('HospitalAuth.isSessionConsistent() : refuse si Auth.getUser().uid ne correspond pas à firebaseAuth.currentUser.uid', async () => {
  const { win, sandbox } = setup({ firebaseAuthImpl: { currentUser: { uid: 'real-fb-uid' } } });
  sandbox.window.Auth.__proto__; // no-op, juste pour clarifier qu'on ne touche pas Auth ici
  // Injecte directement une session mc_user incohérente.
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'un-autre-uid', role: 'doctor' }));
  const session = { establishmentId: 'EST1', agentUid: 'real-fb-uid', role: 'doctor', loggedAt: new Date().toISOString() };
  const ok = await win.HospitalAuth.isSessionConsistent(session);
  assert.strictEqual(ok, false);
});

test('HospitalAuth.isSessionConsistent() : refuse une session expirée (au-delà de SESSION_MAX_AGE_MS)', async () => {
  const { win } = setup({ firebaseAuthImpl: { currentUser: { uid: 'real-fb-uid' } } });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'real-fb-uid', role: 'doctor' }));
  const old = new Date(Date.now() - (win.HospitalAuth.SESSION_MAX_AGE_MS + 60_000)).toISOString();
  const session = { establishmentId: 'EST1', agentUid: 'real-fb-uid', role: 'doctor', loggedAt: old };
  const ok = await win.HospitalAuth.isSessionConsistent(session);
  assert.strictEqual(ok, false);
});

test('HospitalAuth.isSessionConsistent() : accepte une session cohérente, récente, avec établissement et affiliation valides', async () => {
  const hospitalsRegistryImpl = {
    getHospitalById: () => ({
      establishmentId: 'EST1', status: 'active',
      staff: [{ uid: 'real-fb-uid', role: 'doctor', status: 'active' }],
    }),
  };
  const { win } = setup({ firebaseAuthImpl: { currentUser: { uid: 'real-fb-uid' } }, hospitalsRegistryImpl });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'real-fb-uid', role: 'doctor' }));
  const session = { establishmentId: 'EST1', agentUid: 'real-fb-uid', role: 'doctor', loggedAt: new Date().toISOString() };
  const ok = await win.HospitalAuth.isSessionConsistent(session);
  assert.strictEqual(ok, true);
});

test('HospitalAuth.isSessionConsistent() : refuse si l\'affiliation au staff a été retirée entre-temps', async () => {
  const hospitalsRegistryImpl = {
    getHospitalById: () => ({
      establishmentId: 'EST1', status: 'active',
      staff: [{ uid: 'real-fb-uid', role: 'doctor', status: 'removed' }],
    }),
  };
  const { win } = setup({ firebaseAuthImpl: { currentUser: { uid: 'real-fb-uid' } }, hospitalsRegistryImpl });
  win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'real-fb-uid', role: 'doctor' }));
  const session = { establishmentId: 'EST1', agentUid: 'real-fb-uid', role: 'doctor', loggedAt: new Date().toISOString() };
  const ok = await win.HospitalAuth.isSessionConsistent(session);
  assert.strictEqual(ok, false);
});

test('HospitalAuth.isSessionExpired() : comparaison pure, testable indépendamment', () => {
  const { win } = setup();
  const now = Date.parse('2026-07-17T12:00:00.000Z');
  const recent = { loggedAt: new Date(now - 60_000).toISOString() };
  const old = { loggedAt: new Date(now - win.HospitalAuth.SESSION_MAX_AGE_MS - 1000).toISOString() };
  assert.strictEqual(win.HospitalAuth.isSessionExpired(recent, now), false);
  assert.strictEqual(win.HospitalAuth.isSessionExpired(old, now), true);
  assert.strictEqual(win.HospitalAuth.isSessionExpired({}, now), true, 'sans loggedAt, considérée expirée');
});

/* ── 5. Affiliation refusée : verifyAgent() nettoie la session ─────
   Scénario complet : l'agent s'authentifie avec succès (Firebase Auth
   confirmé) mais n'est PAS affilié au staff de l'établissement —
   verifyAgent() doit créer la demande d'affiliation, ET nettoyer toute
   session locale créée pendant la tentative, ET déconnecter Firebase,
   SANS jamais appeler enter() (qui ouvrirait le tableau de bord). */
test('HospitalAuth.verifyAgent() : agent authentifié mais non affilié → session nettoyée, Firebase déconnecté, tableau de bord jamais ouvert', async () => {
  let signOutCalls = 0;
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => ({ user: { uid: 'agent-real-fb-uid' } }),
    get currentUser() { return { uid: 'agent-real-fb-uid' }; },
    signOut: async () => { signOutCalls++; },
  };
  const hospitalsRegistryImpl = {
    getHospitalById: () => ({
      establishmentId: 'EST1', status: 'active',
      staff: [], // aucune affiliation
    }),
    getAffiliations: () => [],
    requestAffiliation: () => ({ requestId: 'AFF_1' }),
  };
  const { win, getEl } = setup({
    firebaseAuthImpl,
    hospitalsRegistryImpl,
    accountData: { uid: 'agent-local-id', role: 'doctor', order_num: 'DOC9', email: 'doc9@x.com', status: 'approved', name: 'Dr Non-Affilié' },
  });
  getEl('ha-agent-role').value = 'doctor';
  getEl('ha-agent-num').value = 'DOC9';
  getEl('ha-agent-pw').value = 'whatever';

  let openForSessionCalled = false;
  win.HospitalDesktopUI = { openForSession: () => { openForSessionCalled = true; } };

  await win.HospitalAuth.verifyAgent('EST1');

  assert.strictEqual(win.sessionStorage.getItem('mc_user'), null, 'mc_user créé pendant la tentative doit être supprimé');
  assert.strictEqual(win.sessionStorage.getItem('mc_hospital_session'), null, 'aucune session hôpital ne doit subsister');
  assert.strictEqual(signOutCalls, 1, 'Firebase doit être déconnecté');
  assert.strictEqual(openForSessionCalled, false, 'le tableau de bord ne doit jamais s\'ouvrir sans affiliation');
});

test('HospitalAuth.verifyAgent() : le rôle sélectionné doit concorder avec le rôle affilié réel', async () => {
  const firebaseAuthImpl = {
    signInWithEmailAndPassword: async () => ({ user: { uid: 'agent-real-fb-uid' } }),
    get currentUser() { return { uid: 'agent-real-fb-uid' }; },
    signOut: async () => {},
  };
  // Le staff affilie cet uid comme "nurse", mais l'agent sélectionne "doctor".
  const hospitalsRegistryImpl = {
    getHospitalById: () => ({
      establishmentId: 'EST1', status: 'active',
      staff: [{ uid: 'agent-real-fb-uid', role: 'nurse', status: 'active', professionalNumber: 'DOC9' }],
    }),
    getAffiliations: () => [],
    requestAffiliation: () => ({ requestId: 'AFF_1' }),
  };
  const { win, getEl } = setup({
    firebaseAuthImpl,
    hospitalsRegistryImpl,
    accountData: { uid: 'agent-local-id', role: 'doctor', order_num: 'DOC9', email: 'doc9@x.com', status: 'approved', name: 'Dr Mauvais Rôle' },
  });
  getEl('ha-agent-role').value = 'doctor';
  getEl('ha-agent-num').value = 'DOC9';
  getEl('ha-agent-pw').value = 'whatever';

  let openForSessionCalled = false;
  win.HospitalDesktopUI = { openForSession: () => { openForSessionCalled = true; } };

  await win.HospitalAuth.verifyAgent('EST1');

  assert.strictEqual(openForSessionCalled, false, 'un rôle sélectionné différent du rôle affilié ne doit jamais ouvrir le tableau de bord');
});
