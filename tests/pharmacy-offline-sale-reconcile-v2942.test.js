/* =====================================================
   Tests — Réconciliation des ventes pharmacie hors ligne (chantier 10, v2.9.42)

   Une vente réalisée hors ligne est mise en file avec un PLAN de
   réconciliation (mid, qty). À la reconnexion, elle n'est plus rejouée par un
   lot qui écrase le stock avec une valeur absolue périmée (survente possible) :
   _replayEntry rejoue une TRANSACTION qui relit le stock réel, le décrémente
   relativement, refuse entièrement si insuffisant, et est idempotente.

   Vérifié au comportement via un db.js simulé avec un Firestore en mémoire
   (runTransaction inclus).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Firestore en mémoire minimal : documents + runTransaction (get/set/update). */
function makeFakeFirestore(seed = {}) {
  const store = {}; // `${col}/${id}` -> data
  for (const [col, docs] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(docs)) store[`${col}/${id}`] = { ...data };
  }
  const docApi = (col, id) => ({
    async set(data, opts) {
      const k = `${col}/${id}`;
      store[k] = opts && opts.merge ? { ...(store[k] || {}), ...data } : { ...data };
    },
    async get() {
      const k = `${col}/${id}`;
      return { exists: Object.prototype.hasOwnProperty.call(store, k), id, data: () => store[k] };
    },
  });
  const collectionApi = (col) => ({ doc: (id) => docApi(col, String(id)) });
  return {
    _store: store,
    collection: collectionApi,
    async runTransaction(fn) {
      const tx = {
        async get(ref) { return ref.get(); },
        set(ref, data) { return ref.set(data); },
        update(ref, patch) {
          // update = merge sur un document existant.
          return ref.set(patch, { merge: true });
        },
      };
      return fn(tx);
    },
  };
}

function loadDb(fakeDB) {
  const sandbox = {
    console, window: {},
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
    },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
    navigator: { onLine: true }, addEventListener: () => {},
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    firebaseReady: false, firebaseDB: null, firebaseAuth: { currentUser: { uid: 'PHARM' } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  sandbox.window.Auth = { getUser: () => ({ uid: 'PHARM', role: 'pharmacist' }) };
  return { DB: sandbox.window.DB, sandbox };
}

function readOutbox(sandbox) {
  return JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]');
}

// Injecte des médicaments avec un mid FIXE (addMedicine génère sinon son
// propre identifiant, ce qui casserait la correspondance mid dans la vente).
function seedMed(sandbox, mid, stock) {
  const meds = JSON.parse(sandbox.localStorage.getItem('mc_medicines') || '[]');
  meds.push({ mid, name: 'Paracétamol', stock: String(stock) });
  sandbox.localStorage.setItem('mc_medicines', JSON.stringify(meds));
}

test('une vente hors ligne est mise en file avec un plan de réconciliation', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false; // hors ligne
  // Stock local suffisant.
  seedMed(sandbox, 'M1', 10);
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3 }], '9.00', null);
  assert.strictEqual(res.queued, true, 'hors ligne : la vente part en file, jamais confirmée');
  assert.strictEqual(res.confirmed, false);
  const q = readOutbox(sandbox);
  const saleEntry = q.find(e => e.operationType === 'pharmacy_sale');
  assert.ok(saleEntry, 'entrée pharmacy_sale présente');
  assert.ok(saleEntry.saleReconcile, 'plan de réconciliation présent');
  assert.deepStrictEqual(saleEntry.saleReconcile.decrements, [{ mid: 'M1', qty: 3 }]);
});

test('au rejeu en ligne : le stock réel est décrémenté relativement (pas d\'écrasement absolu)', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  seedMed(sandbox, 'M1', 10);
  await DB.addSaleAtomic([{ mid: 'M1', qty: 3 }], '9.00', null); // file (stock local 10)

  // Reconnexion : le stock RÉEL en base est 5 (un autre poste a déjà vendu).
  const fake = makeFakeFirestore({ mc_medicines: { M1: { mid: 'M1', name: 'Paracétamol', stock: '5' } } });
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = fake;
  await DB.flushOutbox({ force: true });

  // 5 - 3 = 2 (décrément RELATIF sur le stock réel), pas 7 (10-3 périmé).
  assert.strictEqual(fake._store['mc_medicines/M1'].stock, '2');
  assert.ok(fake._store['mc_sales/' + Object.keys(fake._store).filter(k => k.startsWith('mc_sales/')).map(k => k.split('/')[1])[0]], 'la vente est posée');
  assert.strictEqual(readOutbox(sandbox).length, 0, 'la file est vidée après rejeu réussi');
});

test('au rejeu, si le stock réel est insuffisant : refus et quarantaine (jamais de survente)', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  seedMed(sandbox, 'M1', 10);
  await DB.addSaleAtomic([{ mid: 'M1', qty: 8 }], '24.00', null); // file (stock local 10)

  // Reconnexion : stock réel tombé à 2, la vente de 8 ne peut plus être honorée.
  const fake = makeFakeFirestore({ mc_medicines: { M1: { mid: 'M1', name: 'Paracétamol', stock: '2' } } });
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = fake;
  await DB.flushOutbox({ force: true });

  // Stock JAMAIS écrasé/négatif, vente NON posée.
  assert.strictEqual(fake._store['mc_medicines/M1'].stock, '2', 'le stock réel reste intact');
  assert.ok(!Object.keys(fake._store).some(k => k.startsWith('mc_sales/')), 'aucune vente posée');
  // L'entrée est quarantainée (blocked), conservée pour décision manuelle.
  const q = readOutbox(sandbox);
  assert.strictEqual(q.length, 1, 'l\'entrée reste en file');
  assert.strictEqual(q[0].classification, 'blocked', 'quarantainée pour intervention du pharmacien');
});

test('rejeu idempotent : une vente déjà posée n\'est pas re-décrémentée', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  seedMed(sandbox, 'M1', 10);
  const res = await DB.addSaleAtomic([{ mid: 'M1', qty: 3 }], '9.00', null);
  const sid = readOutbox(sandbox).find(e => e.operationType === 'pharmacy_sale').saleReconcile.saleId;

  // La vente a déjà été posée (ex. rejeu précédent) ; le stock réel est 5.
  const fake = makeFakeFirestore({
    mc_medicines: { M1: { mid: 'M1', name: 'Paracétamol', stock: '5' } },
    mc_sales: { [sid]: { sid, items: [{ mid: 'M1', qty: 3 }] } },
  });
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = fake;
  await DB.flushOutbox({ force: true });

  // Stock inchangé (pas de double décrément), file vidée.
  assert.strictEqual(fake._store['mc_medicines/M1'].stock, '5', 'aucun re-décrément');
  assert.strictEqual(readOutbox(sandbox).length, 0);
});
