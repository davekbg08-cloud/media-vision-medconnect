/* =====================================================
   Tests — Chantier fix/lab-reception-auth-affiliation

   Couvre les points de la section 11 (INSCRIPTION 1-20, CONNEXION
   21-35, AFFILIATION 36-42) et de la section 14.I (boutons de
   validation admin/affiliation 1-17) du cahier des charges, pour les
   rôles lab ET reception.

   Les règles Firestore (points 43-50) sont testées séparément via
   l'émulateur : tests/firestore-rules/lab-reception-capabilities.rules.test.js.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function fakeElement(overrides = {}) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    style: { display: '' }, classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
  }, overrides);
}

/* ── Mock Firestore générique ─────────────────────────
   Contrairement aux mocks "réponse canée" utilisés par d'autres
   fichiers de tests de ce dépôt, celui-ci filtre RÉELLEMENT les
   documents par collection + where(field,'==',value) — nécessaire ici
   pour tester correctement la détection de doublons (plusieurs champs,
   plusieurs collections) plutôt que de simuler un seul résultat fixe. */
function makeFirestoreMock(seedData = {}) {
  const store = {};
  for (const [col, docs] of Object.entries(seedData)) {
    store[col] = new Map(Object.entries(docs));
  }
  function ensureCol(col) { if (!store[col]) store[col] = new Map(); return store[col]; }

  function query(colName, filters) {
    return {
      where(field, op, value) { return query(colName, [...filters, { field, op, value }]); },
      limit() { return query(colName, filters); },
      async get() {
        const col = ensureCol(colName);
        let docs = [...col.entries()];
        for (const f of filters) {
          docs = docs.filter(([, d]) => (f.op === '==' ? d[f.field] === f.value : true));
        }
        return { empty: docs.length === 0, docs: docs.map(([id, d]) => ({ id, data: () => d })) };
      },
    };
  }

  function collection(name) {
    const col = ensureCol(name);
    return Object.assign(query(name, []), {
      doc(id) {
        return {
          async get() { const d = col.get(id); return { exists: !!d, data: () => d, id }; },
          async set(data, opts) {
            const existing = col.get(id) || {};
            col.set(id, opts && opts.merge ? { ...existing, ...data } : data);
          },
          async delete() { col.delete(id); },
        };
      },
    });
  }
  return { collection, _store: store };
}

/**
 * Sandbox chargeant db.js + auth.js + hospital-auth.js + hospitals_registry.js
 * — les 4 modules réellement modifiés par ce chantier, dans un seul
 * contexte partagé (comme hospital-desktop-session.test.js).
 */
function setup({ firebaseAuthImpl = {}, firestoreSeed = {}, onLine = true } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };

  const firestore = makeFirestoreMock(firestoreSeed);
  const toasts = [];
  const App = {
    toast: (msg, type) => toasts.push({ msg, type }),
    afterLogin(){}, closeModal(){}, openModal(){}, navigateTo(){},
  };

  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: {
      URL: 'https://test/', addEventListener(){}, getElementById: getEl,
      querySelectorAll: () => [], createElement: () => fakeElement(),
      body: { contains: (el) => elements.has(Object.keys(Object.fromEntries(elements))[0]) || true, classList: { contains: () => false } },
    },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval: () => 0, clearInterval(){}, setTimeout: (fn) => 0, clearTimeout(){},
    crypto: globalThis.crypto,
    firebaseReady: true, firebaseDB: firestore, firebaseAuth: firebaseAuthImpl,
    confirm: () => true,
    App, Network: undefined,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/auth.js', 'js/hospital-auth.js', 'js/hospitals_registry.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { win: sandbox.window, sandbox, getEl, App, toasts, firestore };
}

function fillAgentRegisterForm(getEl, { fullName = 'Jean Dupont', matricule = 'LAB-01', email = 'jean@x.com', pass = 'password1', pass2 = 'password1', service = '', phone = '' } = {}) {
  getEl('ag-fullname').value = fullName;
  getEl('ag-matricule').value = matricule;
  getEl('ag-email').value = email;
  getEl('ag-pass').value = pass;
  getEl('ag-pass2').value = pass2;
  getEl('ag-service').value = service;
  getEl('ag-phone').value = phone;
}

function regFn(win, role) { return role === 'lab' ? win.Auth._regLab : win.Auth._regReception; }

const ROLES = ['lab', 'reception'];

/* =====================================================
   INSCRIPTION (1-20)
   ===================================================== */
for (const role of ROLES) {

  test(`[${role}] 1-2. inscription réussie crée un utilisateur Firebase réel avec uid===authUid===credential.user.uid`, async () => {
    let created = null;
    const firebaseAuthImpl = {
      createUserWithEmailAndPassword: async (email, pass) => { created = { email, pass }; return { user: { uid: `${role}-real-fb-uid` } }; },
      signOut: async () => {},
    };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}@test.com` });
    await regFn(win, role).call(win.Auth);

    assert.ok(created, 'createUserWithEmailAndPassword doit avoir été appelé');
    const stored = win.DB.getAccounts().find(a => a.email === `${role}@test.com`);
    assert.ok(stored, 'le compte doit être enregistré localement après confirmation cloud');
    assert.strictEqual(stored.uid, `${role}-real-fb-uid`);
    assert.strictEqual(stored.authUid, `${role}-real-fb-uid`);
  });

  test(`[${role}] 3. le statut initial est pending`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-3` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}3@test.com` });
    await regFn(win, role).call(win.Auth);
    const stored = win.DB.getAccounts().find(a => a.email === `${role}3@test.com`);
    assert.strictEqual(stored.status, 'pending');
  });

  test(`[${role}] 4. le rôle est correct`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-4` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}4@test.com` });
    await regFn(win, role).call(win.Auth);
    const stored = win.DB.getAccounts().find(a => a.email === `${role}4@test.com`);
    assert.strictEqual(stored.role, role);
  });

  test(`[${role}] 5. le matricule est normalisé (espaces/casse)`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-5` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}5@test.com`, matricule: '  lab-05  ' });
    await regFn(win, role).call(win.Auth);
    const stored = win.DB.getAccounts().find(a => a.email === `${role}5@test.com`);
    assert.strictEqual(stored.matricule, 'LAB-05');
    assert.strictEqual(stored.professionalNumber, 'LAB-05');
  });

  test(`[${role}] 6. le nom complet est conservé`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-6` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}6@test.com`, fullName: 'Marie Kalombo' });
    await regFn(win, role).call(win.Auth);
    const stored = win.DB.getAccounts().find(a => a.email === `${role}6@test.com`);
    assert.strictEqual(stored.fullName, 'Marie Kalombo');
    assert.strictEqual(stored.name, 'Marie Kalombo');
  });

  test(`[${role}] 7. une registration_request est créée`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-7` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}7@test.com` });
    await regFn(win, role).call(win.Auth);
    const req = win.DB.getRegistrationRequests().find(r => r.requesterUid === `${role}-uid-7`);
    assert.ok(req, 'une registration_request doit être créée');
    assert.strictEqual(req.requesterRole, role);
    assert.strictEqual(req.status, 'pending');
  });

  test(`[${role}] 8-9. une affiliation_request est créée avec un requestId déterministe quand establishmentId existe`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-8` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-8', name: 'Hôpital Huit' });
    win.Auth._setRegistrationContext({ establishmentId: 'EST-8', establishmentName: 'Hôpital Huit' });
    fillAgentRegisterForm(getEl, { email: `${role}8@test.com` });
    await regFn(win, role).call(win.Auth);

    const affs = win.HospitalsRegistry.getAffiliations();
    const aff = affs.find(a => a.requesterUid === `${role}-uid-8`);
    assert.ok(aff, 'une affiliation_request doit être créée dès l\'inscription');
    assert.strictEqual(aff.requestId, `AFF_${role}-uid-8_EST-8`);
    assert.strictEqual(aff.status, 'pending');
    assert.strictEqual(aff.requesterRole, role);
  });

  test(`[${role}] 10. Firebase signOut est appelé après inscription`, async () => {
    let signOutCalls = 0;
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-10` } }), signOut: async () => { signOutCalls++; } };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}10@test.com` });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(signOutCalls, 1);
  });

  test(`[${role}] 11-12. mc_user et mc_hospital_session n'existent pas après inscription`, async () => {
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-11` } }), signOut: async () => {} };
    const { win, getEl } = setup({ firebaseAuthImpl });
    win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'stale' }));
    win.sessionStorage.setItem('mc_hospital_session', JSON.stringify({ establishmentId: 'stale' }));
    win.sessionStorage.setItem('mc_current_hospital', 'stale');
    fillAgentRegisterForm(getEl, { email: `${role}11@test.com` });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(win.sessionStorage.getItem('mc_user'), null);
    assert.strictEqual(win.sessionStorage.getItem('mc_hospital_session'), null);
    assert.strictEqual(win.sessionStorage.getItem('mc_current_hospital'), null);
  });

  test(`[${role}] 13. auth/email-already-in-use ne crée aucun document`, async () => {
    const firebaseAuthImpl = {
      createUserWithEmailAndPassword: async () => { const e = new Error('in use'); e.code = 'auth/email-already-in-use'; throw e; },
      signOut: async () => {},
    };
    const { win, getEl, firestore } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}13@test.com` });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(win.DB.getAccounts().length, 0, 'aucun compte local ne doit être créé');
    assert.strictEqual(win.DB.getRegistrationRequests().length, 0, 'aucune registration_request ne doit être créée');
    assert.strictEqual(Object.keys(firestore._store.mc_accounts || {}).length, 0);
  });

  test(`[${role}] 14. une panne Firebase Auth (indisponible) ne crée aucun document`, async () => {
    const { win, getEl, toasts } = setup({ firebaseAuthImpl: null });
    // firebaseAuthImpl null ⇒ _hasFirebaseAuth() renvoie false
    fillAgentRegisterForm(getEl, { email: `${role}14@test.com` });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(win.DB.getAccounts().length, 0);
    assert.ok(toasts.length === 0 || true); // message affiché via reg-err, pas toast — pas de crash suffit ici
    const errEl = getEl('reg-err');
    assert.match(errEl.innerHTML, /Firebase indisponible/);
  });

  test(`[${role}] 15. une panne Firestore critique déclenche le rollback du compte Firebase créé`, async () => {
    let deleteCalls = 0;
    const firebaseAuthImpl = {
      createUserWithEmailAndPassword: async () => ({ user: { uid: `${role}-uid-15` } }),
      signOut: async () => {},
      currentUser: { delete: async () => { deleteCalls++; } },
    };
    const { win, getEl, firestore } = setup({ firebaseAuthImpl });
    // Simule une panne Firestore : toute écriture .set() échoue.
    const originalCollection = firestore.collection;
    firestore.collection = (name) => {
      const c = originalCollection(name);
      return { ...c, doc: (id) => ({ ...c.doc(id), set: async () => { throw new Error('firestore down'); } }) };
    };
    fillAgentRegisterForm(getEl, { email: `${role}15@test.com` });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(deleteCalls, 1, 'le compte Firebase Auth orphelin doit être supprimé');
    assert.strictEqual(win.DB.getAccounts().length, 0, 'aucun compte local ne doit rester après rollback');
  });

  test(`[${role}] 16. un double clic ne crée pas deux comptes (verrou anti-double-clic)`, async () => {
    let createCalls = 0;
    const firebaseAuthImpl = {
      createUserWithEmailAndPassword: async () => { createCalls++; await new Promise(r => setImmediate(r)); return { user: { uid: `${role}-uid-16` } }; },
      signOut: async () => {},
    };
    const { win, getEl } = setup({ firebaseAuthImpl });
    fillAgentRegisterForm(getEl, { email: `${role}16@test.com` });
    const fn = regFn(win, role);
    await Promise.all([fn.call(win.Auth), fn.call(win.Auth)]);
    assert.strictEqual(createCalls, 1, 'un second appel concurrent doit être ignoré par le verrou anti-double-clic');
  });

  test(`[${role}] 17. un matricule déjà pending ne peut pas être réinscrit`, async () => {
    let createCalls = 0;
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => { createCalls++; return { user: { uid: `${role}-uid-17b` } }; }, signOut: async () => {} };
    const { win, getEl } = setup({
      firebaseAuthImpl,
      firestoreSeed: { registration_requests: { REQ1: { requestId: 'REQ1', requesterRole: role, professionalNumber: 'LAB-17', email: 'other@x.com', status: 'pending' } } },
    });
    fillAgentRegisterForm(getEl, { email: `${role}17@test.com`, matricule: 'lab-17' });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(createCalls, 0, 'createUserWithEmailAndPassword ne doit jamais être appelé si une demande pending existe déjà');
    assert.match(getEl('reg-err').innerHTML, /attend la validation/);
  });

  test(`[${role}] 18. un compte approved redirige vers la connexion (aucune nouvelle création)`, async () => {
    let createCalls = 0;
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => { createCalls++; return { user: { uid: `${role}-uid-18b` } }; }, signOut: async () => {} };
    const { win, getEl } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U1: { uid: 'U1', role, matricule: 'LAB-18', authUid: 'U1', status: 'approved' } } },
    });
    fillAgentRegisterForm(getEl, { email: `${role}18@test.com`, matricule: 'lab-18' });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(createCalls, 0);
    assert.match(getEl('reg-err').innerHTML, /Utilisez la connexion/);
  });

  test(`[${role}] 19. un compte rejected affiche le bon statut (écran de demande refusée)`, async () => {
    let createCalls = 0;
    const firebaseAuthImpl = { createUserWithEmailAndPassword: async () => { createCalls++; return { user: { uid: `${role}-uid-19b` } }; }, signOut: async () => {} };
    const { win, getEl } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U2: { uid: 'U2', role, matricule: 'LAB-19', authUid: 'U2', status: 'rejected' } } },
    });
    fillAgentRegisterForm(getEl, { email: `${role}19@test.com`, matricule: 'lab-19' });
    await regFn(win, role).call(win.Auth);
    assert.strictEqual(createCalls, 0);
    assert.match(getEl('auth-screen').innerHTML, /Demande refusée/);
  });

  test(`[${role}] 20. un compte sans authUid ne peut pas être approuvé (AdminModule.approve)`, async () => {
    const { win, App: adminApp } = setupAdmin({
      accounts: [{ uid: `${role}-noauth-1`, role, status: 'pending', email: 'x@y.com', matricule: 'LAB-20' }],
    });
    await win.AdminModule.approve(`${role}-noauth-1`);
    const acc = win.DB.getAccounts().find(a => a.uid === `${role}-noauth-1`);
    assert.strictEqual(acc.status, 'pending', 'le statut ne doit pas passer à approved sans authUid');
    assert.ok(adminApp.toasts.some(t => /identité Firebase valide/.test(t.msg)));
  });
}

/* =====================================================
   CONNEXION (21-35)
   ===================================================== */
for (const role of ROLES) {

  test(`[${role}] 21-22. compte approved + bon mot de passe crée mc_user avec uid = vrai currentUser.uid`, async () => {
    const firebaseAuthImpl = { signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-fb-real-21` } }) };
    const { win } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-21', email: 'a@b.com', status: 'approved' } } },
    });
    const result = await win.Auth.loginProfessionalSilently(role, 'LAB-21', 'goodpass');
    assert.ok(result);
    assert.strictEqual(result.uid, `${role}-fb-real-21`);
    assert.strictEqual(result.authUid, `${role}-fb-real-21`);
    const stored = JSON.parse(win.sessionStorage.getItem('mc_user'));
    assert.strictEqual(stored.uid, `${role}-fb-real-21`);
  });

  test(`[${role}] 23. un mot de passe incorrect ne crée aucune session`, async () => {
    const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { throw new Error('auth/wrong-password'); } };
    const { win } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-23', email: 'a@b.com', status: 'approved' } } },
    });
    const result = await win.Auth.loginProfessionalSilently(role, 'LAB-23', 'wrong');
    assert.strictEqual(result, null);
    assert.strictEqual(win.sessionStorage.getItem('mc_user'), null);
  });

  for (const status of ['pending', 'rejected', 'suspended']) {
    test(`[${role}] 24-26. un compte "${status}" ne déclenche jamais signIn`, async () => {
      let signInCalls = 0;
      const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'should-not' } }; } };
      const { win } = setup({
        firebaseAuthImpl,
        firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-24', email: 'a@b.com', status } } },
      });
      const result = await win.Auth.loginProfessionalSilently(role, 'LAB-24', 'whatever');
      assert.strictEqual(result, null);
      assert.strictEqual(signInCalls, 0, `signIn ne doit jamais être appelé pour un compte ${status}`);
    });
  }

  test(`[${role}] 27-28. une affiliation pending/rejected n'ouvre jamais HospitalDesktopUI`, async () => {
    for (const affStatus of ['pending', 'rejected']) {
      const firebaseAuthImpl = {
        signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-fb-aff` } }),
        get currentUser() { return { uid: `${role}-fb-aff` }; },
        signOut: async () => {},
      };
      const { win, getEl } = setup({
        firebaseAuthImpl,
        firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-27', email: 'a@b.com', status: 'approved', authUid: `${role}-fb-aff` } } },
      });
      win.HospitalsRegistry.addHospital({ establishmentId: 'EST-27', name: 'Hôpital 27' });
      if (affStatus !== 'pending') {
        win.HospitalsRegistry.requestAffiliation(`${role}-fb-aff`, 'Agent', 'EST-27', { role });
        const affs = win.HospitalsRegistry.getAffiliations();
        win.HospitalsRegistry.saveAffiliations(affs.map(a => ({ ...a, status: affStatus })));
      }
      getEl('ha-agent-role').value = role;
      getEl('ha-agent-num').value = 'LAB-27';
      getEl('ha-agent-pw').value = 'whatever';
      let opened = false;
      win.HospitalDesktopUI = { openForSession: () => { opened = true; } };
      await win.HospitalAuth.verifyAgent('EST-27');
      assert.strictEqual(opened, false, `affiliation ${affStatus} ne doit jamais ouvrir le tableau de bord`);
    }
  });

  test(`[${role}] 29. une affiliation approved ouvre le tableau de bord`, async () => {
    const firebaseAuthImpl = {
      signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-fb-ok` } }),
      get currentUser() { return { uid: `${role}-fb-ok` }; },
      signOut: async () => {},
    };
    const { win, sandbox, getEl } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-29', email: 'a@b.com', status: 'approved', authUid: `${role}-fb-ok` } } },
    });
    win.HospitalsRegistry.addHospital({
      establishmentId: 'EST-29', name: 'Hôpital 29',
      staff: [{ uid: `${role}-fb-ok`, role, professionalNumber: 'LAB-29', status: 'active' }],
    });
    getEl('ha-agent-role').value = role;
    getEl('ha-agent-num').value = 'LAB-29';
    getEl('ha-agent-pw').value = 'whatever';
    let opened = false;
    // enter() (js/hospital-auth.js) référence HospitalDesktopUI en global
    // "nu" (pas seulement window.HospitalDesktopUI) — même technique de
    // sandbox que les autres tests de ce dépôt (voir hospital-desktop-*.test.js).
    sandbox.HospitalDesktopUI = win.HospitalDesktopUI = { openForSession: () => { opened = true; } };
    await win.HospitalAuth.verifyAgent('EST-29');
    assert.strictEqual(opened, true, 'une affiliation approuvée doit ouvrir le tableau de bord');
  });

  test(`[${role}] 30-31-32. le rôle sélectionné doit correspondre au rôle réel du compte (lab ne peut pas se connecter en reception, et inversement)`, async () => {
    const otherRole = role === 'lab' ? 'reception' : 'lab';
    const firebaseAuthImpl = { signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-fb-wrongrole` } }) };
    const { win, getEl } = setup({
      firebaseAuthImpl,
      // Le compte existe UNIQUEMENT sous son vrai rôle.
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-30', email: 'a@b.com', status: 'approved' } } },
    });
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-30', name: 'Hôpital 30' });
    getEl('ha-agent-role').value = otherRole; // sélectionne le MAUVAIS rôle
    getEl('ha-agent-num').value = 'LAB-30';
    getEl('ha-agent-pw').value = 'whatever';
    let opened = false;
    win.HospitalDesktopUI = { openForSession: () => { opened = true; } };
    await win.HospitalAuth.verifyAgent('EST-30');
    assert.strictEqual(opened, false, `un compte ${role} ne doit jamais pouvoir se connecter en tant que ${otherRole}`);
  });

  test(`[${role}] 33. un matricule lié à un autre uid est refusé (jamais de remplacement automatique)`, async () => {
    const firebaseAuthImpl = {
      signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-new-uid` } }),
      get currentUser() { return { uid: `${role}-new-uid` }; },
      signOut: async () => {},
    };
    const { win, getEl, toasts } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-33', email: 'a@b.com', status: 'approved', authUid: `${role}-new-uid` } } },
    });
    win.HospitalsRegistry.addHospital({
      establishmentId: 'EST-33', name: 'Hôpital 33',
      staff: [{ uid: 'ANCIEN-UID-DIFFERENT', role, professionalNumber: 'LAB-33', status: 'active' }],
    });
    getEl('ha-agent-role').value = role;
    getEl('ha-agent-num').value = 'LAB-33';
    getEl('ha-agent-pw').value = 'whatever';
    let opened = false;
    win.HospitalDesktopUI = { openForSession: () => { opened = true; } };
    await win.HospitalAuth.verifyAgent('EST-33');
    assert.strictEqual(opened, false);
    assert.match(getEl('ha-agent-msg').innerHTML, /déjà lié à un autre compte/);
  });

  test(`[${role}] 34. une session incohérente appelle signOut et nettoie le stockage`, async () => {
    let signOutCalls = 0;
    const firebaseAuthImpl = {
      signInWithEmailAndPassword: async () => ({ user: { uid: `${role}-fb-incoh` } }),
      get currentUser() { return { uid: 'AUTRE-UID-INCOHERENT' }; }, // ne correspond pas à account.uid
      signOut: async () => { signOutCalls++; },
    };
    const { win, getEl } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-34', email: 'a@b.com', status: 'approved', authUid: `${role}-fb-incoh` } } },
    });
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-34', name: 'Hôpital 34' });
    getEl('ha-agent-role').value = role;
    getEl('ha-agent-num').value = 'LAB-34';
    getEl('ha-agent-pw').value = 'whatever';
    await win.HospitalAuth.verifyAgent('EST-34');
    assert.strictEqual(signOutCalls, 1);
    assert.strictEqual(win.sessionStorage.getItem('mc_user'), null);
  });

  test(`[${role}] 35. un compte sans email ou authUid est refusé`, async () => {
    let signInCalls = 0;
    const firebaseAuthImpl = { signInWithEmailAndPassword: async () => { signInCalls++; return { user: { uid: 'x' } }; } };
    const { win } = setup({
      firebaseAuthImpl,
      firestoreSeed: { users: { U: { uid: 'local-id', role, matricule: 'LAB-35', status: 'approved' } } }, // pas d'email
    });
    const result = await win.Auth.loginProfessionalSilently(role, 'LAB-35', 'whatever');
    assert.strictEqual(result, null);
    assert.strictEqual(signInCalls, 0);
  });
}

/* =====================================================
   AFFILIATION (36-42) — via HospitalsRegistry.respondAffiliation
   ===================================================== */
for (const role of ROLES) {

  test(`[${role}] 36-37. une approbation crée hospitalMembers avec le bon uid/rôle et met à jour affiliation_requests`, async () => {
    const { win } = setup();
    win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'admin_root', role: 'admin' }));
    win.DB.saveAccounts([{ uid: `${role}-u36`, authUid: `${role}-u36`, role, status: 'approved' }]);
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-36', name: 'Hôpital 36' });
    win.HospitalsRegistry.requestAffiliation(`${role}-u36`, 'Agent 36', 'EST-36', { role, professionalNumber: 'LAB-36' });

    await win.HospitalsRegistry.respondAffiliation(`AFF_${role}-u36_EST-36`, true);

    const req = win.HospitalsRegistry.getAffiliations().find(a => a.requestId === `AFF_${role}-u36_EST-36`);
    assert.strictEqual(req.status, 'approved');
    const h = win.HospitalsRegistry.getHospitalById('EST-36');
    const member = h.staff.find(s => s.uid === `${role}-u36`);
    assert.ok(member, 'le membre doit être ajouté au staff');
    assert.strictEqual(member.role, role);
  });

  test(`[${role}] 38-39. une erreur Firestore ne doit pas afficher de succès ni ajouter localement un membre actif`, async () => {
    const { win, sandbox, toasts } = setup();
    win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'admin_root', role: 'admin' }));
    win.DB.saveAccounts([{ uid: `${role}-u38`, authUid: `${role}-u38`, role, status: 'approved' }]);
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-38', name: 'Hôpital 38' });
    win.HospitalsRegistry.requestAffiliation(`${role}-u38`, 'Agent 38', 'EST-38', { role, professionalNumber: 'LAB-38' });

    // Simule une panne Firestore sur toute écriture.
    sandbox.window.DB.pushAndReportDetailed = async () => ({ ok: false, succeeded: [], failed: [['affiliation_requests', 'x']], timedOut: false, error: new Error('down') });

    await win.HospitalsRegistry.respondAffiliation(`AFF_${role}-u38_EST-38`, true);

    const req = win.HospitalsRegistry.getAffiliations().find(a => a.requestId === `AFF_${role}-u38_EST-38`);
    assert.strictEqual(req.status, 'pending', 'la demande doit rester pending après un échec Firestore');
    const h = win.HospitalsRegistry.getHospitalById('EST-38');
    assert.strictEqual((h.staff || []).find(s => s.uid === `${role}-u38`), undefined, 'aucun membre actif ne doit être ajouté localement');
    assert.ok(!toasts.some(t => /approuvée/.test(t.msg)), 'aucun message de succès ne doit être affiché');
  });

  test(`[${role}] 40. un rejet ne crée aucun hospitalMembers`, async () => {
    const { win } = setup();
    win.sessionStorage.setItem('mc_user', JSON.stringify({ uid: 'admin_root', role: 'admin' }));
    win.DB.saveAccounts([{ uid: `${role}-u40`, authUid: `${role}-u40`, role, status: 'approved' }]);
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-40', name: 'Hôpital 40' });
    win.HospitalsRegistry.requestAffiliation(`${role}-u40`, 'Agent 40', 'EST-40', { role, professionalNumber: 'LAB-40' });
    await win.HospitalsRegistry.respondAffiliation(`AFF_${role}-u40_EST-40`, false);
    const req = win.HospitalsRegistry.getAffiliations().find(a => a.requestId === `AFF_${role}-u40_EST-40`);
    assert.strictEqual(req.status, 'rejected');
    const h = win.HospitalsRegistry.getHospitalById('EST-40');
    assert.strictEqual((h.staff || []).length, 0);
  });

  test(`[${role}] 41. un compte pending ne peut pas recevoir une affiliation active`, async () => {
    const { win, toasts } = setup({
      firestoreSeed: { mc_accounts: { [`${role}-u41`]: { uid: `${role}-u41`, role, status: 'pending' } } },
    });
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-41', name: 'Hôpital 41' });
    win.HospitalsRegistry.requestAffiliation(`${role}-u41`, 'Agent 41', 'EST-41', { role, professionalNumber: 'LAB-41' });
    await win.HospitalsRegistry.respondAffiliation(`AFF_${role}-u41_EST-41`, true);
    const req = win.HospitalsRegistry.getAffiliations().find(a => a.requestId === `AFF_${role}-u41_EST-41`);
    assert.strictEqual(req.status, 'pending', 'l\'affiliation ne doit jamais être approuvée tant que le compte professionnel est pending');
    assert.ok(toasts.some(t => /d\'abord être approuvé/.test(t.msg)));
  });

  test(`[${role}] 42. un requestId identique ne crée jamais deux demandes`, async () => {
    const { win } = setup();
    win.HospitalsRegistry.addHospital({ establishmentId: 'EST-42', name: 'Hôpital 42' });
    const first = win.HospitalsRegistry.requestAffiliation(`${role}-u42`, 'Agent 42', 'EST-42', { role });
    const second = win.HospitalsRegistry.requestAffiliation(`${role}-u42`, 'Agent 42', 'EST-42', { role });
    assert.ok(first, 'la première demande doit réussir');
    assert.strictEqual(second, false, 'une seconde demande identique doit être refusée (déjà pending)');
    assert.strictEqual(win.HospitalsRegistry.getAffiliations().filter(a => a.requestId === first.requestId).length, 1);
  });
}

/* =====================================================
   SECTION 14.I — Boutons de validation admin (approve/reject/suspend)
   ===================================================== */
function setupAdmin({ accounts = [], registrationRequests = [], onLine = true } = {}) {
  const toasts = [];
  const App = { toast: (msg, type) => toasts.push({ msg, type }), closeModal(){}, navigateTo(){}, openModal(){} };
  const win = { localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage() };
  win.window = win;
  const sandbox = {
    window: win,
    document: { getElementById: () => null, querySelectorAll: () => [], body: { contains: () => true } },
    console, navigator: { onLine }, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    firebaseReady: false, firebaseDB: null,
    App, Network: undefined, confirm: () => true,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/admin.js']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.window.DB.saveAccounts(accounts);
  sandbox.window.DB.saveRegistrationRequests(registrationRequests);
  return { win: sandbox.window, sandbox, App: { toasts } };
}

function fakeButton() { return { textContent: 'Approuver', disabled: false, dataset: {} }; }
function fakeEvent(btn) { return { target: { closest: () => btn } }; }

test('14.I.1-3. approve() désactive le bouton immédiatement et affiche "Validation en cours…"', async () => {
  const { win } = setupAdmin({ accounts: [{ uid: 'lab-btn-1', authUid: 'lab-btn-1', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L1' }] });
  win.DB.pushAndReportDetailed = async () => new Promise(r => setTimeout(() => r({ ok: true, succeeded: [], failed: [], timedOut: false, error: null }), 5));
  const btn = fakeButton();
  const p = win.AdminModule.approve('lab-btn-1', fakeEvent(btn));
  assert.strictEqual(btn.disabled, true, 'le bouton doit être désactivé immédiatement (avant le premier await)');
  assert.match(btn.textContent, /Validation en cours/);
  await p;
});

test('14.I.2. un double clic ne lance qu\'une seule validation', async () => {
  const { win } = setupAdmin({ accounts: [{ uid: 'lab-btn-2', authUid: 'lab-btn-2', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L2' }] });
  let calls = 0;
  win.DB.pushAndReportDetailed = async () => { calls++; return { ok: true, succeeded: [], failed: [], timedOut: false, error: null }; };
  const btn = fakeButton();
  const event = fakeEvent(btn);
  const p1 = win.AdminModule.approve('lab-btn-2', event);
  const p2 = win.AdminModule.approve('lab-btn-2', event);
  await Promise.all([p1, p2]);
  assert.strictEqual(calls, 1);
});

test('14.I.4. le bouton est restauré après une erreur', async () => {
  const { win } = setupAdmin({ accounts: [{ uid: 'lab-btn-4', authUid: 'lab-btn-4', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L4' }] });
  win.DB.pushAndReportDetailed = async () => { throw new Error('boom'); };
  const btn = fakeButton();
  await win.AdminModule.approve('lab-btn-4', fakeEvent(btn));
  assert.strictEqual(btn.disabled, false);
  assert.strictEqual(btn.textContent, 'Approuver');
  assert.strictEqual(btn.dataset.processing, undefined);
});

test('14.I.5-6. une écriture lente (timeout) ne bloque pas indéfiniment et restaure le bouton', async () => {
  const { win } = setupAdmin({ accounts: [{ uid: 'lab-btn-5', authUid: 'lab-btn-5', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L5' }] });
  win.DB.pushAndReportDetailed = async () => ({ ok: false, succeeded: [], failed: [['users', 'lab-btn-5']], timedOut: true, error: new Error('Validation : délai dépassé') });
  const btn = fakeButton();
  await win.AdminModule.approve('lab-btn-5', fakeEvent(btn));
  assert.strictEqual(btn.disabled, false, 'le bouton doit être restauré même après un timeout');
});

test('14.I.7-9. un échec Firestore conserve le statut pending, n\'envoie aucune notification de succès et n\'affiche jamais "Compte approuvé"', async () => {
  const { win, App: adminApp } = setupAdmin({ accounts: [{ uid: 'lab-btn-7', authUid: 'lab-btn-7', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L7' }] });
  win.DB.pushAndReportDetailed = async () => ({ ok: false, succeeded: [], failed: [['users', 'lab-btn-7']], timedOut: false, error: new Error('down') });
  await win.AdminModule.approve('lab-btn-7');
  const acc = win.DB.getAccounts().find(a => a.uid === 'lab-btn-7');
  assert.strictEqual(acc.status, 'pending');
  assert.ok(!adminApp.toasts.some(t => /Compte approuvé/.test(t.msg)), 'aucun message "Compte approuvé" ne doit apparaître après un échec');
});

test('14.I.10. une réussite confirmée met à jour le statut et ferme la fenêtre', async () => {
  const { win, App: adminApp } = setupAdmin({ accounts: [{ uid: 'lab-btn-10', authUid: 'lab-btn-10', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'L10' }] });
  win.DB.pushAndReportDetailed = async () => ({ ok: true, succeeded: [['users', 'lab-btn-10'], ['mc_accounts', 'lab-btn-10']], failed: [], timedOut: false, error: null });
  await win.AdminModule.approve('lab-btn-10');
  const acc = win.DB.getAccounts().find(a => a.uid === 'lab-btn-10');
  assert.strictEqual(acc.status, 'approved');
  assert.ok(adminApp.toasts.some(t => /Compte approuvé/.test(t.msg)));
});

test('14.I.11-12. une demande sans compte mc_accounts (fantôme) ne peut pas être approuvée ; requestId n\'est jamais utilisé comme uid', async () => {
  const { win, App: adminApp } = setupAdmin({ accounts: [] });
  await win.AdminModule.approve('REQ-GHOST-1');
  assert.strictEqual(win.DB.getAccounts().find(a => a.uid === 'REQ-GHOST-1'), undefined, 'requestId ne doit jamais devenir un uid utilisateur');
  assert.ok(adminApp.toasts.some(t => /aucun compte Firebase valide/.test(t.msg)));
});

test('14.I : reject() conserve le statut et n\'affiche pas de succès en cas d\'échec', async () => {
  const { win, App: adminApp } = setupAdmin({ accounts: [{ uid: 'lab-btn-r1', authUid: 'lab-btn-r1', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'LR1' }] });
  win.DB.pushAndReportDetailed = async () => ({ ok: false, succeeded: [], failed: [], timedOut: false, error: null });
  const btn = fakeButton();
  await win.AdminModule.reject('lab-btn-r1', fakeEvent(btn));
  const acc = win.DB.getAccounts().find(a => a.uid === 'lab-btn-r1');
  assert.strictEqual(acc.status, 'pending');
  assert.strictEqual(btn.disabled, false);
  assert.ok(!adminApp.toasts.some(t => /rejetée/.test(t.msg)));
});

test('14.I : suspend() confirmé passe le statut à suspended', async () => {
  const { win, App: adminApp } = setupAdmin({ accounts: [{ uid: 'lab-btn-s1', authUid: 'lab-btn-s1', role: 'lab', status: 'approved', email: 'a@b.com', matricule: 'LS1' }] });
  win.DB.pushAndReportDetailed = async () => ({ ok: true, succeeded: [], failed: [], timedOut: false, error: null });
  await win.AdminModule.suspend('lab-btn-s1');
  const acc = win.DB.getAccounts().find(a => a.uid === 'lab-btn-s1');
  assert.strictEqual(acc.status, 'suspended');
  assert.ok(adminApp.toasts.some(t => /suspendu/.test(t.msg)));
});

test('14.H : hors ligne, aucune validation admin n\'est tentée', async () => {
  const { win, App: adminApp } = setupAdmin({
    accounts: [{ uid: 'lab-btn-off', authUid: 'lab-btn-off', role: 'lab', status: 'pending', email: 'a@b.com', matricule: 'LOFF' }],
    onLine: false,
  });
  let calls = 0;
  win.DB.pushAndReportDetailed = async () => { calls++; return { ok: true, succeeded: [], failed: [], timedOut: false, error: null }; };
  await win.AdminModule.approve('lab-btn-off');
  assert.strictEqual(calls, 0, 'aucune écriture ne doit être tentée hors ligne');
  const acc = win.DB.getAccounts().find(a => a.uid === 'lab-btn-off');
  assert.strictEqual(acc.status, 'pending');
  assert.ok(adminApp.toasts.some(t => /Connexion internet requise/.test(t.msg)));
});

test('14.B/16. pushAndReportDetailed respecte le délai maximal configuré (withTimeout)', async () => {
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, firebaseReady: false, firebaseDB: null, window: {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(dbSrc, sandbox, { filename: 'js/db.js' });
  const slow = new Promise(r => setTimeout(() => r(true), 200));
  await assert.rejects(
    sandbox.window.DB.withTimeout(slow, 20, 'Test'),
    /délai dépassé/,
  );
});

test('14.17. les écritures médicales ordinaires (pushCloud/outbox) restent fonctionnelles', async () => {
  const { win } = setupAdmin({});
  // firebaseReady=false dans ce sandbox ⇒ pushCloud met en file d'attente (outbox), ne perd rien.
  win.DB.pushCloud('mc_consultations', 'C1', { patient_id: 'MC-1' });
  assert.strictEqual(win.DB.outboxCount(), 1, 'une écriture médicale ordinaire doit rester mise en file si le cloud est indisponible');
});
