/* =====================================================
   Tests — DB.addPatientAndConfirmAtomic / DB.buildPatientRecord
   (audit "workflows mobile/desktop", section 5)

   Bug confirmé : addPatientAndConfirmAtomic() appelait addPatient(),
   qui écrit IMMÉDIATEMENT dans le cache local ET lance trois écritures
   _push() INDÉPENDANTES (mc_patients/patients/medical_records) —
   chacune capable de se mettre en file d'outbox SÉPARÉMENT — avant même
   que le batch supposé atomique ne s'exécute. Hors ligne, ça pouvait
   mettre en file trois écritures non groupées pour une fiche que le
   batch rejetait ensuite. Corrigé : buildPatientRecord() est un helper
   PUR (aucune écriture), et addPatientAndConfirmAtomic() n'écrit dans
   le cache qu'APRÈS confirmation réelle du batch, sans jamais appeler
   addPatient() ni _push() individuellement.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function makeBatchFirestoreMock({ shouldFail = false } = {}) {
  const sets = [];
  return {
    batch() {
      return {
        set(ref, data) { sets.push({ col: ref.__col, id: ref.__id, data }); },
        async commit() {
          if (shouldFail) throw new Error('Batch commit failed (simulated)');
          return true;
        },
      };
    },
    collection(name) {
      return { doc: (id) => ({ __col: name, __id: id }) };
    },
    _sets: sets,
  };
}

function setup({ firebaseReady = true, shouldFail = false } = {}) {
  const firebaseDB = firebaseReady ? makeBatchFirestoreMock({ shouldFail }) : undefined;
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
    console, setInterval:()=>0, clearInterval(){}, setTimeout, clearTimeout,
    crypto: globalThis.crypto,
    firebaseReady, firebaseDB, firebaseAuth: null,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { win: sandbox.window, firebaseDB };
}

test('buildPatientRecord() est un helper pur : aucune écriture cache, aucune entrée en outbox', () => {
  const { win } = setup({ firebaseReady: false });
  const before = win.DB.outboxCount();
  const p = win.DB.buildPatientRecord({ firstname: 'Jean', lastname: 'Kalala', country_code: 'CD' });
  assert.ok(p.id, 'un id doit être généré');
  assert.ok(p.firstAccessCode, 'un code de premier accès doit être généré');
  assert.strictEqual(win.DB.getPatients().length, 0, 'aucune écriture dans le cache local');
  assert.strictEqual(win.DB.outboxCount(), before, "aucune entrée d'outbox ne doit être créée");
});

test('addPatientAndConfirmAtomic() confirmé : le patient apparaît dans le cache APRÈS le batch, jamais avant', async () => {
  const { win, firebaseDB } = setup({ firebaseReady: true, shouldFail: false });
  const { patient, confirmed } = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Marie', lastname: 'Tshisekedi', country_code: 'CD' });
  assert.strictEqual(confirmed, true);
  assert.strictEqual(win.DB.getPatients().length, 1);
  assert.strictEqual(win.DB.getPatients()[0].id, patient.id);
  // Les 3 documents doivent être écrits dans le MÊME batch (un seul commit).
  const cols = firebaseDB._sets.map(s => s.col).sort();
  assert.deepStrictEqual(cols, ['mc_patients', 'medical_records', 'patients']);
});

test("addPatientAndConfirmAtomic() échoué (batch rejeté) : AUCUNE trace en cache ni en outbox (plus de 3 écritures non groupées)", async () => {
  const { win } = setup({ firebaseReady: true, shouldFail: true });
  const before = win.DB.outboxCount();
  const { patient, confirmed } = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Paul', lastname: 'Mukendi', country_code: 'CD' });
  assert.strictEqual(confirmed, false);
  assert.ok(patient.id, "l'objet patient est retourné pour affichage d'erreur, mais n'est écrit nulle part");
  assert.strictEqual(win.DB.getPatients().length, 0, 'aucune fiche provisoire ne doit rester en cache après un échec');
  assert.strictEqual(win.DB.outboxCount(), before,
    "correctif central : contrairement à l'ancien addPatient(), aucune des 3 écritures ne doit être mise en file séparément");
});

test('addPatientAndConfirmAtomic() hors ligne (firebaseDB indisponible) : refusé proprement, sans écriture partielle', async () => {
  const { win } = setup({ firebaseReady: false });
  const before = win.DB.outboxCount();
  const { confirmed } = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Alice', lastname: 'Kabongo', country_code: 'CD' });
  assert.strictEqual(confirmed, false);
  assert.strictEqual(win.DB.getPatients().length, 0);
  assert.strictEqual(win.DB.outboxCount(), before);
});

test('addPatient() (chemin historique médecin/infirmier, INCHANGÉ) continue de peupler le cache immédiatement', () => {
  const { win } = setup({ firebaseReady: false });
  const p = win.DB.addPatient({ firstname: 'Historique', lastname: 'Test', country_code: 'CD' });
  assert.strictEqual(win.DB.getPatients().length, 1, 'addPatient() garde son comportement existant (non touché par ce correctif)');
  assert.strictEqual(win.DB.getPatients()[0].id, p.id);
});
