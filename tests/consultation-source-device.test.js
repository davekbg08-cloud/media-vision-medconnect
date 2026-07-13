/* =====================================================
   Tests — DB.addConsultation pose sourceDevice

   Correctif (audit) : sans ce champ, hospitalCanWriteFromDevice()
   (firestore.rules, mc_consultations) reste permissif par défaut
   quelle que soit la plateforme réelle — voir
   tests/firestore-rules/subscription-device-gate.rules.test.js pour
   la vérification côté règles. addPrescription posait déjà ce champ ;
   addConsultation ne le faisait pas.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

// Même principe que tests/patient-pin-migration.test.js : js/db.js
// référence firebaseReady/firebaseDB en identifiants nus (pas
// window.firebaseReady) — ils doivent exister au niveau du contexte
// vm, pas seulement sur window.
function setup({ exchangeBridge = undefined } = {}) {
  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
    ExchangeBridge: exchangeBridge,
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

test("DB.addConsultation utilise sourceDevice fourni si présent", () => {
  const win = setup({ exchangeBridge: { currentSourceDevice: () => 'desktop' } });
  const c = win.DB.addConsultation({ patient_id: 'MC-1', sourceDevice: 'mobile' });
  assert.strictEqual(c.sourceDevice, 'mobile', 'une valeur explicite ne doit jamais être écrasée');
});

test("DB.addConsultation retombe sur ExchangeBridge.currentSourceDevice() si rien n'est fourni", () => {
  const win = setup({ exchangeBridge: { currentSourceDevice: () => 'desktop' } });
  const c = win.DB.addConsultation({ patient_id: 'MC-2' });
  assert.strictEqual(c.sourceDevice, 'desktop');
});

test("DB.addConsultation retombe sur 'mobile' si ExchangeBridge est indisponible (défaut permissif, jamais bloquant pour le soin)", () => {
  const win = setup({});
  const c = win.DB.addConsultation({ patient_id: 'MC-3' });
  assert.strictEqual(c.sourceDevice, 'mobile');
});
