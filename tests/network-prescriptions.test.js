/* =====================================================
   Tests — js/network.js : ordonnances et pharmacies (PARTIE H)

   Verrouille les 4 correctifs :
   - getAvailablePharmacies accepte 'approved' ET 'active' ;
   - canSendPrescription restreint à admin + auteur direct
     (retrait du repli ACL.canAccessPatient trop large) ;
   - RX_TRANSITIONS refuse les retours arbitraires de statut ;
   - sendPrescriptionToPharmacy est asynchrone et n'affiche un
     message de succès qu'après confirmation Firestore réelle.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

// js/db.js et js/network.js référencent Auth/App/firebaseReady/firebaseDB
// comme des globales NUES (pas window.Auth) — comme dans un vrai
// navigateur où window EST l'objet global. loadIntoWindow (helper.js)
// n'expose que window.X, pas X directement : on construit donc ici un
// contexte vm dédié qui place aussi ces valeurs au niveau global.
function setup({ firebaseReady = false, firebaseDB = undefined, user = null, toasts = [] } = {}) {
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

  const Auth = { getUser: () => user };
  const App = {
    toast: (msg, kind) => toasts.push({ msg, kind }),
    openModal: () => {}, closeModal: () => {}, navigateTo: () => {},
  };

  const sandbox = {
    window: win,
    document: { URL: 'https://test/', addEventListener: () => {}, getElementById: () => null,
      querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }) },
    navigator: win.navigator,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => 0,
    crypto: globalThis.crypto,
    firebaseReady, firebaseDB,
    Auth, App,
  };
  vm.createContext(sandbox);

  for (const f of ['js/db.js', 'js/network.js']) {
    const abs = path.resolve(__dirname, '..', f);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { win: sandbox.window, toasts };
}

test('getAvailablePharmacies accepte approved ET active', () => {
  const { win } = setup();
  win.DB.saveAccounts([
    { uid: 'ph1', role: 'pharmacist', status: 'approved' },
    { uid: 'ph2', role: 'pharmacist', status: 'active' },
    { uid: 'ph3', role: 'pharmacist', status: 'pending' },
    { uid: 'doc1', role: 'doctor', status: 'active' },
  ]);
  const list = Array.from(win.Network.getAvailablePharmacies().map(p => p.uid)).sort();
  assert.deepStrictEqual(list, ['ph1', 'ph2']);
});

test("canSendPrescription : l'auteur direct (created_by/doctor_uid) peut envoyer", () => {
  const { win } = setup({ user: { uid: 'doc1', role: 'doctor' } });
  assert.strictEqual(win.Network.canSendPrescription({ created_by: 'doc1' }), true);
  assert.strictEqual(win.Network.canSendPrescription({ doctor_uid: 'doc1' }), true);
});

test("canSendPrescription : un autre médecin (non auteur) ne peut PAS envoyer", () => {
  const { win } = setup({ user: { uid: 'doc2', role: 'doctor' } });
  assert.strictEqual(win.Network.canSendPrescription({ created_by: 'doc1', doctor_uid: 'doc1' }), false);
});

test("canSendPrescription : une infirmière ne peut jamais envoyer", () => {
  const { win } = setup({ user: { uid: 'nurse1', role: 'nurse' } });
  assert.strictEqual(win.Network.canSendPrescription({ created_by: 'doc1' }), false);
});

test('canSendPrescription : admin peut toujours envoyer', () => {
  const { win } = setup({ user: { uid: 'admin1', role: 'admin' } });
  assert.strictEqual(win.Network.canSendPrescription({ created_by: 'doc1' }), true);
});

test('RX_TRANSITIONS : delivered -> sent est refusé (transition arbitraire)', () => {
  const { win } = setup();
  assert.ok(!win.Network.RX_TRANSITIONS.delivered.includes('sent'));
  assert.deepStrictEqual(Array.from(win.Network.RX_TRANSITIONS.delivered), []);
});

test('RX_TRANSITIONS : chaîne normale sent->received->preparing->ready->delivered autorisée', () => {
  const { win } = setup();
  const t = win.Network.RX_TRANSITIONS;
  assert.ok(t.sent.includes('received'));
  assert.ok(t.received.includes('preparing'));
  assert.ok(t.preparing.includes('ready'));
  assert.ok(t.ready.includes('delivered'));
});

test('setPrescriptionStatus refuse une transition invalide (delivered -> sent)', () => {
  const toasts = [];
  const { win } = setup({ user: { uid: 'ph1', role: 'pharmacist' }, toasts });
  win.DB.addPrescription({ patient_id: 'MC1', doctor_uid: 'doc1', created_by: 'doc1' });
  const rx = win.DB.getPrescriptions()[0];
  win.DB.updatePrescription(rx.pid, { status: 'delivered' });
  win.Network.setPrescriptionStatus(rx.pid, 'sent');
  const updated = win.DB.getPrescriptions().find(p => p.pid === rx.pid);
  assert.strictEqual(updated.status, 'delivered', 'le statut ne doit pas changer');
  assert.ok(toasts.some(t => /Transition invalide/.test(t.msg)));
});

test("setPrescriptionStatus refuse 'cancelled' sans raison", () => {
  const toasts = [];
  const { win } = setup({ user: { uid: 'ph1', role: 'pharmacist' }, toasts });
  win.DB.addPrescription({ patient_id: 'MC1', doctor_uid: 'doc1', created_by: 'doc1' });
  const rx = win.DB.getPrescriptions()[0];
  win.Network.setPrescriptionStatus(rx.pid, 'cancelled');
  const updated = win.DB.getPrescriptions().find(p => p.pid === rx.pid);
  assert.strictEqual(updated.status, 'sent', 'le statut ne doit pas changer sans raison');
  assert.ok(toasts.some(t => /raison/.test(t.msg)));
});

test('sendPrescriptionToPharmacy (hors ligne) : message "en attente de synchronisation", jamais de faux succès', async () => {
  const toasts = [];
  const { win } = setup({ user: { uid: 'doc1', role: 'doctor' }, toasts, firebaseReady: false });
  win.DB.saveAccounts([{ uid: 'ph1', role: 'pharmacist', status: 'active', name: 'Pharma Test' }]);
  win.DB.addPrescription({ patient_id: 'MC1', doctor_uid: 'doc1', created_by: 'doc1' });
  const rx = win.DB.getPrescriptions()[0];
  await win.Network.sendPrescriptionToPharmacy(rx.pid, 'ph1');
  assert.ok(toasts.some(t => /en attente de synchronisation/.test(t.msg)),
    'doit indiquer clairement que ce n\'est pas encore synchronisé');
  assert.ok(!toasts.some(t => /envoyée à/.test(t.msg)),
    'ne doit jamais afficher un message de succès avant confirmation Firestore');
});

test('sendPrescriptionToPharmacy (confirmé par Firestore) : succès affiché après confirmation', async () => {
  const toasts = [];
  const fakeDoc = { set: async () => {} };
  const fakeFirebaseDB = { collection: () => ({ doc: () => fakeDoc }) };
  const { win } = setup({ user: { uid: 'doc1', role: 'doctor' }, toasts, firebaseReady: true, firebaseDB: fakeFirebaseDB });
  win.DB.saveAccounts([{ uid: 'ph1', role: 'pharmacist', status: 'active', name: 'Pharma Test' }]);
  win.DB.addPrescription({ patient_id: 'MC1', doctor_uid: 'doc1', created_by: 'doc1' });
  const rx = win.DB.getPrescriptions()[0];
  await win.Network.sendPrescriptionToPharmacy(rx.pid, 'ph1');
  assert.ok(toasts.some(t => /envoyée à/.test(t.msg)), 'le succès doit être annoncé une fois confirmé');
});

test("sendPrescriptionToPharmacy : une infirmière ne peut pas envoyer (message d'erreur, pas de succès)", async () => {
  const toasts = [];
  const { win } = setup({ user: { uid: 'nurse1', role: 'nurse' }, toasts });
  win.DB.saveAccounts([{ uid: 'ph1', role: 'pharmacist', status: 'active', name: 'Pharma Test' }]);
  win.DB.addPrescription({ patient_id: 'MC1', doctor_uid: 'doc1', created_by: 'doc1' });
  const rx = win.DB.getPrescriptions()[0];
  await win.Network.sendPrescriptionToPharmacy(rx.pid, 'ph1');
  assert.ok(toasts.some(t => /non autorisé/.test(t.msg)));
});

test('notify() porte recipientUid en plus de to_id', () => {
  const { win } = setup({ user: { uid: 'doc1', role: 'doctor' } });
  win.Network.notify({ to_role: 'patient', to_id: 'MC1', recipientUid: 'firebase-uid-123', type: 'prescription', subject: 's', body: 'b' });
  const msg = win.DB.getMessages()[0];
  assert.strictEqual(msg.to_id, 'MC1');
  assert.strictEqual(msg.recipientUid, 'firebase-uid-123');
});
