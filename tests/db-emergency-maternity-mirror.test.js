/* =====================================================
   Tests — DB.addEmergencyCaseRecord/getPatientEmergencyCases et
   DB.addMaternityCaseRecord/getPatientMaternityCases (miroirs patient)

   Voir tests/firestore-rules/mc-emergency-maternity-write.rules.test.js
   pour la vérification côté règles et
   tests/timeline-emergency-maternity-wiring.test.js pour le câblage
   côté interface patient.
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

test('DB.addEmergencyCaseRecord/getPatientEmergencyCases filtrent bien par patient_id', () => {
  const win = setup();
  win.DB.addEmergencyCaseRecord({ patient_id: 'MC-1', complaint: 'A' });
  win.DB.addEmergencyCaseRecord({ patient_id: 'MC-2', complaint: 'B' });
  const results = win.DB.getPatientEmergencyCases('MC-1');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].complaint, 'A');
});

test('DB.addMaternityCaseRecord/getPatientMaternityCases filtrent bien par patient_id', () => {
  const win = setup();
  win.DB.addMaternityCaseRecord({ patient_id: 'MC-1', lmpDate: '2026-01-01' });
  win.DB.addMaternityCaseRecord({ patient_id: 'MC-2', lmpDate: '2026-02-01' });
  const results = win.DB.getPatientMaternityCases('MC-1');
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].lmpDate, '2026-01-01');
});
