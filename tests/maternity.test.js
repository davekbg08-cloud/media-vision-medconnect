/* =====================================================
   Tests — Module Maternité
   Vérifie l'API, le calcul du terme, le parcours de statuts
   et les garde-fous. Test structurel + chargement du module.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.resolve(__dirname, '..', 'js/hospital-maternity.js');
const src = fs.readFileSync(srcPath, 'utf8');

function loadModule() {
  const win = {};
  const sandbox = { window: win, console,
    document: { getElementById: () => null }, App: {}, DB: {}, CloudDB: {} };
  sandbox.window = win;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'hospital-maternity.js' });
  return win.HospitalMaternityModule;
}

test('le module se charge et expose son API', () => {
  const M = loadModule();
  assert.ok(M, 'HospitalMaternityModule doit être exporté');
  ['render','openNew','saveNew','addPrenatalVisit','openDelivery','saveDelivery','closeCase']
    .forEach(fn => assert.strictEqual(typeof M[fn], 'function', `${fn} doit exister`));
});

test('le parcours de statuts couvre prénatal → accouchement → post-partum → clôturé', () => {
  ['prenatal','delivery','postpartum','closed'].forEach(s =>
    assert.match(src, new RegExp(`${s}:`), `statut ${s} défini`));
});

test('le terme prévu est calculé à DDR + 280 jours', () => {
  assert.match(src, /setDate\(d\.getDate\(\) \+ 280\)/);
});

test('la création d\'un dossier est gardée par une capacité', () => {
  assert.match(src, /guardHospitalAction\?\.\('view_patient'\)/);
});

test('l\'accouchement est un acte gardé par create_consultation', () => {
  assert.match(src, /guardHospitalAction\?\.\('create_consultation'\)/);
});

test('le module utilise la collection maternityCases via CloudDB', () => {
  assert.match(src, /CloudDB\.listByHospital\('maternityCases'/);
  assert.match(src, /CloudDB\.createDoc\('maternityCases'/);
  assert.match(src, /CloudDB\.updateDoc\('maternityCases'/);
});

test('une nouvelle patiente est créée avec gender F', () => {
  assert.match(src, /gender: 'F'/);
});
