/* =====================================================
   Tests — Module Urgences (triage)
   Vérifie la logique de triage et les garde-fous du
   module. Test structurel (analyse du source) + chargement
   du module dans un window simulé pour l'API publique.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.resolve(__dirname, '..', 'js/hospital-emergency.js');
const src = fs.readFileSync(srcPath, 'utf8');

// Charge le module dans un contexte minimal pour tester l'API exposée.
function loadModule() {
  const win = {};
  const sandbox = { window: win, console,
    document: { getElementById: () => null }, App: {}, DB: {}, CloudDB: {} };
  sandbox.window = win;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'hospital-emergency.js' });
  return win.HospitalEmergencyModule;
}

test('le module se charge et expose son API', () => {
  const M = loadModule();
  assert.ok(M, 'HospitalEmergencyModule doit être exporté');
  ['render','openIntake','saveIntake','takeCharge','closeCase','lookupPatient']
    .forEach(fn => assert.strictEqual(typeof M[fn], 'function', `${fn} doit exister`));
});

test('les 5 niveaux de triage sont définis', () => {
  for (let lvl = 1; lvl <= 5; lvl++) {
    assert.match(src, new RegExp(`${lvl}: \\{ label:`), `niveau ${lvl} défini`);
  }
});

test('la file est triée par gravité (niveau 1 en premier)', () => {
  assert.match(src, /\(a\.triageLevel \|\| 5\) - \(b\.triageLevel \|\| 5\)/,
    'tri ascendant par triageLevel');
});

test('l\'enregistrement d\'une arrivée est gardé par une capacité', () => {
  assert.match(src, /guardHospitalAction\?\.\('view_patient'\)/);
});

test('la prise en charge médicale est gardée par create_consultation', () => {
  assert.match(src, /guardHospitalAction\?\.\('create_consultation'\)/);
});

test('le module réutilise les conventions CloudDB (createDoc/updateDoc/listByHospital)', () => {
  assert.match(src, /CloudDB\.listByHospital\('emergencyCases'/);
  assert.match(src, /CloudDB\.createDoc\('emergencyCases'/);
  assert.match(src, /CloudDB\.updateDoc\('emergencyCases'/);
});

test('un nouveau cas démarre en statut waiting', () => {
  assert.match(src, /status: 'waiting'/);
});
