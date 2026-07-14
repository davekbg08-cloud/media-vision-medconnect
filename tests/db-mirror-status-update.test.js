/* =====================================================
   Tests — DB.updateAdmissionRecord / updateEmergencyCaseRecord /
   updateMaternityCaseRecord (mise à jour du miroir patient au moment
   de la sortie / clôture)

   Découvert en audit : les miroirs patient (mc_admissions,
   mc_emergency_cases, mc_maternity_cases) n'étaient alimentés qu'à la
   CRÉATION. Une sortie (discharge), une clôture d'urgence ou de
   maternité mettait à jour la collection desktop mais pas le miroir —
   le patient voyait son hospitalisation "en cours" après sa sortie
   (la Timeline sait afficher "· Sortie" si le statut est là). Ces
   helpers retrouvent le miroir par sourceAdmissionId/sourceCaseId (l'id
   du document desktop, posé à la création) et mettent à jour son statut.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

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

test('updateAdmissionRecord met à jour le miroir retrouvé par sourceAdmissionId', () => {
  const win = setup();
  win.DB.addAdmissionRecord({ sourceAdmissionId: 'ADM-1', patient_id: 'MC-1', status: 'admitted' });
  const updated = win.DB.updateAdmissionRecord('ADM-1', { status: 'discharged', dischargedAt: '2026-07-14T00:00:00Z' });
  assert.ok(updated, 'le miroir doit être trouvé et mis à jour');
  assert.strictEqual(updated.status, 'discharged');
  assert.strictEqual(win.DB.getPatientAdmissions('MC-1')[0].status, 'discharged');
});

test('updateAdmissionRecord ne touche rien si sourceAdmissionId est inconnu ou absent', () => {
  const win = setup();
  win.DB.addAdmissionRecord({ sourceAdmissionId: 'ADM-1', patient_id: 'MC-1', status: 'admitted' });
  assert.strictEqual(win.DB.updateAdmissionRecord('ADM-INCONNU', { status: 'discharged' }), null);
  assert.strictEqual(win.DB.updateAdmissionRecord(undefined, { status: 'discharged' }), null);
  assert.strictEqual(win.DB.getPatientAdmissions('MC-1')[0].status, 'admitted', 'aucune modification');
});

test('updateEmergencyCaseRecord met à jour le miroir urgence par sourceCaseId', () => {
  const win = setup();
  win.DB.addEmergencyCaseRecord({ sourceCaseId: 'ER-1', patient_id: 'MC-1', status: 'waiting' });
  const updated = win.DB.updateEmergencyCaseRecord('ER-1', { status: 'discharged' });
  assert.ok(updated);
  assert.strictEqual(win.DB.getPatientEmergencyCases('MC-1')[0].status, 'discharged');
});

test('updateMaternityCaseRecord met à jour le miroir maternité par sourceCaseId', () => {
  const win = setup();
  win.DB.addMaternityCaseRecord({ sourceCaseId: 'MAT-1', patient_id: 'MC-1', status: 'prenatal' });
  const updated = win.DB.updateMaternityCaseRecord('MAT-1', { status: 'closed' });
  assert.ok(updated);
  assert.strictEqual(win.DB.getPatientMaternityCases('MC-1')[0].status, 'closed');
});
