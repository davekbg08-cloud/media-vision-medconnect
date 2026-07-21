/* =====================================================
   Tests — DB.addSaleAtomic (chantier v2.9.34, P1)

   Bug : addSale() écrivait la vente PUIS décrémentait le stock par
   écritures indépendantes (échec partiel possible), et Math.max(0, …)
   MASQUAIT une survente au lieu de la refuser. addSaleAtomic() valide le
   stock d'abord (jamais de survente/stock négatif), écrit vente +
   décréments dans UN lot atomique, et ne renseigne le cache local
   qu'après confirmation — même contrat que addPatientAndConfirmAtomic.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function makeBatchFirestoreMock({ shouldFail = false, failCode = null, hangCommit = false, docExists = false } = {}) {
  const sets = [];
  return {
    batch() {
      return {
        set(ref, data) { sets.push({ col: ref.__col, id: ref.__id, data }); },
        async commit() {
          if (hangCommit) return new Promise(() => {});
          if (shouldFail) { const err = new Error('Batch commit failed (simulated)'); if (failCode) err.code = failCode; throw err; }
          return true;
        },
      };
    },
    collection(name) {
      return { doc: (id) => ({ __col: name, __id: id, async get() { return { exists: docExists, data: () => ({}) }; } }) };
    },
    _sets: sets,
  };
}

function setup({ firebaseReady = true, shouldFail = false, failCode = null, hangCommit = false, docExists = false, medicines = [] } = {}) {
  const firebaseDB = firebaseReady ? makeBatchFirestoreMock({ shouldFail, failCode, hangCommit, docExists }) : undefined;
  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
    Auth: { getUser: () => ({ uid: 'pharma-1' }) },
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: { URL:'https://test/', addEventListener(){}, getElementById: () => null, querySelectorAll:()=>[], createElement: () => ({ style:{}, classList:{add(){},remove(){},toggle(){}} }) },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval:()=>0, clearInterval(){}, setTimeout, clearTimeout,
    crypto: globalThis.crypto,
    firebaseReady, firebaseDB, firebaseAuth: null,
    Auth: win.Auth,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  const DB = sandbox.window.DB;
  if (medicines.length) sandbox.window.localStorage.setItem('mc_medicines', JSON.stringify(medicines));
  return { win: sandbox.window, firebaseDB, DB };
}

const MEDS = [
  { mid: 'M1', name: 'Paracétamol', price: 2, stock: '10', pharmacyUid: 'pharma-1' },
  { mid: 'M2', name: 'Ibuprofène', price: 3, stock: '5', pharmacyUid: 'pharma-1' },
];

test('addSaleAtomic : vente valide → confirmed, stock décrémenté dans le cache après confirmation', async () => {
  const { DB, firebaseDB } = setup({ medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.confirmed, true);
  // Le lot contient la vente + le médicament décrémenté.
  const cols = firebaseDB._sets.map(s => s.col).sort().join(',');
  assert.strictEqual(cols, 'mc_medicines,mc_sales');
  const medSet = firebaseDB._sets.find(s => s.col === 'mc_medicines');
  assert.strictEqual(medSet.data.stock, '7');
  // Cache local mis à jour.
  const stored = JSON.parse(DB.getMedicines ? JSON.stringify(DB.getMedicines()) : '[]');
  assert.strictEqual(stored.find(m => m.mid === 'M1').stock, '7');
});

test('addSaleAtomic : survente REFUSÉE (qty > stock) → insufficient_stock, RIEN écrit, stock intact', async () => {
  const { DB, firebaseDB } = setup({ medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M2', name: 'Ibuprofène', qty: 9, price: 3 }], 27, null);
  assert.strictEqual(res.confirmed, false);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].mid, 'M2');
  assert.strictEqual(res.insufficient[0].available, 5);
  assert.strictEqual(res.insufficient[0].requested, 9);
  assert.strictEqual(firebaseDB._sets.length, 0, 'aucune écriture ne doit partir sur une survente');
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M2').stock, '5', 'stock local intact');
});

test('addSaleAtomic : un panier multi-articles est refusé EN ENTIER si UN SEUL article dépasse le stock', async () => {
  const { DB, firebaseDB } = setup({ medicines: MEDS });
  const res = await DB.addSaleAtomic([
    { mid: 'M1', name: 'Paracétamol', qty: 2, price: 2 },
    { mid: 'M2', name: 'Ibuprofène', qty: 99, price: 3 },
  ], 301, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(firebaseDB._sets.length, 0);
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10', 'M1 ne doit pas être décrémenté si M2 échoue');
});

test('addSaleAtomic : quantité ≤ 0 refusée (invalid_qty)', async () => {
  const { DB } = setup({ medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 0, price: 2 }], 0, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].reason, 'invalid_qty');
});

test('addSaleAtomic : médicament inconnu refusé', async () => {
  const { DB } = setup({ medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M-UNKNOWN', name: 'Fantôme', qty: 1, price: 1 }], 1, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].reason, 'unknown');
});

test('addSaleAtomic : hors ligne (pas de batch) → queued avec operationId, cache NON renseigné', async () => {
  const { DB } = setup({ firebaseReady: false, medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.queued, true);
  assert.ok(res.operationId, 'un operationId doit être renvoyé');
  // Le lot atomique est en file comme UNE seule opération.
  const summary = DB.getOutboxSummary();
  assert.strictEqual(summary.total, 1);
  // Cache non modifié tant que non confirmé.
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10');
  assert.strictEqual(DB.getSales().length, 0);
});

test('addSaleAtomic : rejet réel (permission-denied) → failed/blocked, rien en file, stock intact', async () => {
  const { DB } = setup({ shouldFail: true, failCode: 'permission-denied', medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.failed, true);
  assert.strictEqual(res.blocked, true);
  assert.strictEqual(res.errorCode, 'permission-denied');
  assert.strictEqual(DB.getOutboxSummary().total, 0, 'un rejet réel ne doit jamais être mis en file');
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10');
});

test('addSaleAtomic : échec transitoire (unavailable) → queued (lot atomique en file)', async () => {
  const { DB } = setup({ shouldFail: true, failCode: 'unavailable', medicines: MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(DB.getOutboxSummary().total, 1);
});

test('addSaleAtomic : la vente porte pharmacyUid = utilisateur courant', async () => {
  const { DB, firebaseDB } = setup({ medicines: MEDS });
  await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 1, price: 2 }], 2, null);
  const saleSet = firebaseDB._sets.find(s => s.col === 'mc_sales');
  assert.strictEqual(saleSet.data.pharmacyUid, 'pharma-1');
});
