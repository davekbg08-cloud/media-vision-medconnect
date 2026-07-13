/* =====================================================
   Tests — DB.addAppointment pose sourceDevice

   Correctif (audit) : la clause hospitalCanWriteFromDevice() existait
   déjà sur mc_appointments (firestore.rules, depuis PR2) mais restait
   un no-op car DB.addAppointment() ne posait jamais ce champ — même
   piège déjà corrigé pour addConsultation, voir
   tests/consultation-source-device.test.js et
   tests/firestore-rules/mc-appointments-create.rules.test.js pour la
   vérification côté règles.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

// Même principe que tests/consultation-source-device.test.js : js/db.js
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

test("DB.addAppointment utilise sourceDevice fourni si présent", () => {
  const win = setup({ exchangeBridge: { currentSourceDevice: () => 'desktop' } });
  const a = win.DB.addAppointment({ patient_id: 'MC-1', sourceDevice: 'mobile' });
  assert.strictEqual(a.sourceDevice, 'mobile', 'une valeur explicite ne doit jamais être écrasée');
});

test("DB.addAppointment retombe sur ExchangeBridge.currentSourceDevice() si rien n'est fourni", () => {
  const win = setup({ exchangeBridge: { currentSourceDevice: () => 'desktop' } });
  const a = win.DB.addAppointment({ patient_id: 'MC-2' });
  assert.strictEqual(a.sourceDevice, 'desktop');
});

test("DB.addAppointment retombe sur 'mobile' si ExchangeBridge est indisponible (défaut permissif, jamais bloquant pour le soin)", () => {
  const win = setup({});
  const a = win.DB.addAppointment({ patient_id: 'MC-3' });
  assert.strictEqual(a.sourceDevice, 'mobile');
});
