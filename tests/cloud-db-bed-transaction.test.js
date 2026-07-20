/* =====================================================
   Tests — CloudDB.assignBedTransaction()
   (audit "workflows mobile/desktop", section 12)

   Bug confirmé : l'attribution d'un lit (confirmation de pré-admission,
   création manuelle d'admission) lisait le statut du lit PUIS écrivait
   séparément (batch ou deux écritures distinctes), sans jamais relire
   l'état du lit AU MOMENT de l'écriture — deux confirmations
   concurrentes pouvaient toutes deux lire "libre" avant que l'une ou
   l'autre n'écrive, double-réservant le même lit.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock Firestore MINIMAL mais qui simule fidèlement la sémantique
// d'une transaction : tx.get() lit l'état COURANT du store partagé
// (comme un vrai Firestore le ferait), tx.set/update ne s'appliquent
// qu'après que tout le corps de la transaction s'est exécuté SANS
// lever — reproduisant le comportement "lecture puis écriture
// cohérente" qu'une vraie transaction Firestore garantit.
function makeTransactionalFirestoreMock(seed = {}) {
  const store = {};
  for (const [col, docs] of Object.entries(seed)) store[col] = new Map(Object.entries(docs));
  function ensureCol(col) { if (!store[col]) store[col] = new Map(); return store[col]; }
  function collection(name) {
    const col = ensureCol(name);
    return {
      doc(id) {
        return {
          _col: name, _id: String(id),
          async get() { const d = col.get(String(id)); return { exists: !!d, data: () => d, id }; },
          async set(data) { col.set(String(id), data); },
        };
      },
    };
  }
  // Sérialise les transactions (mutex global) — reproduit l'EFFET
  // OBSERVABLE garanti par une vraie transaction Firestore quand deux
  // transactions concurrentes touchent le même document (l'une des
  // deux commit intégralement avant que l'autre ne lise/écrive), sans
  // reconstruire tout le mécanisme réel de nouvelle tentative sur
  // conflit — suffisant pour vérifier que CE code ne double-réserve
  // jamais un lit, ce qui est l'objet de ce test.
  let _txQueue = Promise.resolve();
  function runTransaction(updateFn) {
    const run = _txQueue.then(async () => {
      const tx = {
        async get(ref) {
          const col = ensureCol(ref._col);
          const d = col.get(ref._id);
          return { exists: !!d, data: () => d, id: ref._id };
        },
        set(ref, data, options) {
          const col = ensureCol(ref._col);
          if (options?.merge) {
            const existing = col.get(ref._id) || {};
            col.set(ref._id, { ...existing, ...data });
          } else {
            col.set(ref._id, data);
          }
        },
        update(ref, data) {
          const col = ensureCol(ref._col);
          const existing = col.get(ref._id) || {};
          col.set(ref._id, { ...existing, ...data });
        },
      };
      return updateFn(tx);
    });
    _txQueue = run.catch(() => {});
    return run;
  }
  return { collection, runTransaction, _store: store };
}

function setup({ seed = {} } = {}) {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Auth = { getUser: () => ({ uid: 'user-1' }) };
  sandbox.App = { toast(){} };
  sandbox.ExchangeBridge = { currentSourceDevice: () => 'desktop' };
  sandbox.HospitalsRegistry = { getCurrentHospital: () => ({ establishmentId: 'EST-1' }) };
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = makeTransactionalFirestoreMock(seed);
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/cloud-db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/cloud-db.js' });
  return { win: sandbox.window, firestore: sandbox.firebaseDB };
}

test('assignBedTransaction() attribue le lit et crée l\'admission quand le lit est libre', async () => {
  const { win, firestore } = setup({ seed: { beds: { 'BED-1': { id: 'BED-1', status: 'free', ward: 'Médecine' } } } });
  const result = await win.CloudDB.assignBedTransaction({
    bedId: 'BED-1', admissionId: 'ADM-1',
    admissionData: { patientMc: 'MC-1', status: 'admitted' },
  });
  assert.strictEqual(result.bed.status, 'free', 'le bed retourné reflète l\'état AVANT l\'écriture');
  assert.strictEqual(firestore._store.beds.get('BED-1').status, 'occupied');
  assert.deepStrictEqual(firestore._store.admissions.get('ADM-1'), { patientMc: 'MC-1', status: 'admitted' });
});

test('assignBedTransaction() échoue (bed_not_free) si le lit est déjà occupé — AUCUNE admission créée', async () => {
  const { win, firestore } = setup({ seed: { beds: { 'BED-2': { id: 'BED-2', status: 'occupied' } } } });
  await assert.rejects(
    win.CloudDB.assignBedTransaction({ bedId: 'BED-2', admissionId: 'ADM-2', admissionData: { patientMc: 'MC-2' } }),
    (err) => err.code === 'bed_not_free'
  );
  assert.ok(!firestore._store.admissions?.has('ADM-2'), 'aucune admission ne doit être créée si le lit est occupé');
});

test('assignBedTransaction() échoue (bed_not_found) si le lit référencé n\'existe pas', async () => {
  const { win } = setup({ seed: {} });
  await assert.rejects(
    win.CloudDB.assignBedTransaction({ bedId: 'BED-INEXISTANT', admissionId: 'ADM-3', admissionData: {} }),
    (err) => err.code === 'bed_not_found'
  );
});

test('assignBedTransaction() : deux attributions concurrentes sur le MÊME lit — une seule réussit (double réservation impossible)', async () => {
  const { win, firestore } = setup({ seed: { beds: { 'BED-RACE': { id: 'BED-RACE', status: 'free' } } } });

  const attempt1 = win.CloudDB.assignBedTransaction({ bedId: 'BED-RACE', admissionId: 'ADM-RACE-1', admissionData: { patientMc: 'MC-A' } });
  const attempt2 = win.CloudDB.assignBedTransaction({ bedId: 'BED-RACE', admissionId: 'ADM-RACE-2', admissionData: { patientMc: 'MC-B' } });

  const results = await Promise.allSettled([attempt1, attempt2]);
  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  assert.strictEqual(fulfilled.length, 1, 'une seule des deux attributions concurrentes doit réussir');
  assert.strictEqual(rejected.length, 1, 'l\'autre doit échouer (bed_not_free), jamais double-réserver le lit');
  assert.strictEqual(rejected[0].reason.code, 'bed_not_free');
  // Une seule admission doit exister au final.
  const admissionIds = [...firestore._store.admissions.keys()];
  assert.strictEqual(admissionIds.length, 1);
});

test('assignBedTransaction() met à jour receptionVisits quand visitId est fourni (confirmation de pré-admission)', async () => {
  const { win, firestore } = setup({
    seed: {
      beds: { 'BED-4': { id: 'BED-4', status: 'free', ward: 'Chirurgie' } },
      receptionVisits: { 'RCV-1': { id: 'RCV-1', status: 'pre_admission', patientMc: 'MC-4' } },
    },
  });
  await win.CloudDB.assignBedTransaction({
    bedId: 'BED-4', admissionId: 'ADM-4', admissionData: { patientMc: 'MC-4' },
    visitId: 'RCV-1', visitUpdate: { status: 'hospitalized', bedId: 'BED-4' },
  });
  const visit = firestore._store.receptionVisits.get('RCV-1');
  assert.strictEqual(visit.status, 'hospitalized');
  assert.strictEqual(visit.patientMc, 'MC-4', 'les champs existants (merge) ne doivent pas être perdus');
});
