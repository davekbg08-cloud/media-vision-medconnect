/* =====================================================
   Tests — DB.addAdmissionRecord / getPatientAdmissions
   (miroir patient de la collection desktop admissions)

   Découvert en auditant le dépôt : hospital-beds.js/
   hospital-reception.js écrivent l'admission dans la collection
   desktop `admissions` (patientMc, jamais lue par le patient) — le
   filtre "🏥 Hospitalisation" du dossier patient (js/timeline.js)
   existait déjà côté interface mais n'était jamais alimenté.
   mc_admissions est le miroir lisible côté patient, même principe que
   mc_lab_results (voir tests/hospital-lab-patient-sync.test.js et
   tests/firestore-rules/mc-admissions-write.rules.test.js pour la
   vérification côté règles).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

// Même principe que tests/appointment-source-device.test.js : js/db.js
// référence firebaseReady/firebaseDB en identifiants nus.
function setup() {
  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: { URL:'https://test/', addEventListener(){}, getElementById: () => null, querySelectorAll:()=>[], createElement: () => ({ style:{}, classList:{add(){},remove(){},toggle(){}} }) },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval:()=>0, clearInterval(){}, setTimeout:(fn)=>0,
    crypto: globalThis.crypto,
    firebaseReady: false, firebaseDB: undefined, firebaseAuth: null,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return sandbox.window;
}

test('DB.addAdmissionRecord enregistre bien un aid et une date', () => {
  const win = setup();
  const a = win.DB.addAdmissionRecord({ patient_id: 'MC-1', bedId: 'B1', reason: 'Observation', status: 'admitted' });
  assert.ok(a.aid, 'un identifiant aid doit être généré');
  assert.ok(a.date, 'une date par défaut doit être posée');
  assert.strictEqual(a.patient_id, 'MC-1');
});

test('DB.getPatientAdmissions filtre bien par patient_id', () => {
  const win = setup();
  win.DB.addAdmissionRecord({ patient_id: 'MC-1', bedId: 'B1', reason: 'A' });
  win.DB.addAdmissionRecord({ patient_id: 'MC-2', bedId: 'B2', reason: 'B' });
  const results = win.DB.getPatientAdmissions('MC-1');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].patient_id, 'MC-1');
});

test('DB.getPatientAdmissions trie du plus récent au plus ancien', () => {
  const win = setup();
  win.DB.addAdmissionRecord({ patient_id: 'MC-1', date: '2026-01-01', reason: 'Ancien' });
  win.DB.addAdmissionRecord({ patient_id: 'MC-1', date: '2026-06-01', reason: 'Récent' });
  const results = win.DB.getPatientAdmissions('MC-1');
  assert.strictEqual(results[0].reason, 'Récent');
  assert.strictEqual(results[1].reason, 'Ancien');
});
