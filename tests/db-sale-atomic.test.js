/* =====================================================
   Tests — DB.addSaleAtomic (v2.9.34 P1 + v2.9.35 audit intégrité stocks)

   La vente est réalisée EN LIGNE dans une transaction Firestore : le
   stock réel de chaque médicament est RELU dans la transaction, la vente
   est refusée entièrement si un article n'a plus assez de stock (y
   compris survente CONCURRENTE : stock serveur < stock local), et le
   cache local n'est renseigné qu'après confirmation. Repli file hors
   ligne. Contrat identique à addPatientAndConfirmAtomic.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

/* Mock Firestore avec runTransaction : un "serverStore" distinct du cache
   local permet de simuler un stock serveur différent (survente
   concurrente). failMode : 'insufficient'∅ (géré par le stock), 'blocked'
   (permission-denied), 'transient' (unavailable), 'hang' (timeout). */
function makeTxFirestoreMock({ serverMeds = {}, failMode = null, saleExists = false } = {}) {
  const server = { mc_medicines: { ...serverMeds }, mc_sales: {} };
  const txWrites = [];
  function docRef(col, id) {
    return {
      __col: col, __id: String(id),
      async get() { const d = server[col]?.[String(id)]; return { exists: d !== undefined || (col === 'mc_sales' && saleExists), data: () => d || {}, id: String(id) }; },
    };
  }
  return {
    server, txWrites,
    collection(col) { return { doc: (id) => docRef(col, id) }; },
    async runTransaction(fn) {
      // 'slow' : occupe le verrou brièvement (test anti double-appel) sans
      // déclencher le vrai timeout de 15 s de addSaleAtomic.
      if (failMode === 'slow') { await new Promise(r => setTimeout(r, 30)); return fn({
        async get(ref) { return ref.get(); },
        update(ref, data) { server[ref.__col][ref.__id] = { ...server[ref.__col][ref.__id], ...data }; },
        set(ref, data) { server[ref.__col][ref.__id] = data; },
      }); }
      if (failMode === 'blocked') { const e = new Error('refus'); e.code = 'permission-denied'; throw e; }
      if (failMode === 'transient') { const e = new Error('indispo'); e.code = 'unavailable'; throw e; }
      const tx = {
        async get(ref) { return ref.get(); },
        update(ref, data) { server[ref.__col][ref.__id] = { ...server[ref.__col][ref.__id], ...data }; txWrites.push(['update', ref.__col, ref.__id, data]); },
        set(ref, data) { server[ref.__col][ref.__id] = data; txWrites.push(['set', ref.__col, ref.__id, data]); },
      };
      return fn(tx); // laisse remonter un éventuel throw 'insufficient_stock'
    },
  };
}

function setup({ firebaseReady = true, serverMeds = {}, failMode = null, saleExists = false, medicines = [] } = {}) {
  const firebaseDB = firebaseReady ? makeTxFirestoreMock({ serverMeds, failMode, saleExists }) : undefined;
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

const LOCAL_MEDS = [
  { mid: 'M1', name: 'Paracétamol', price: 2, stock: '10', pharmacyUid: 'pharma-1' },
  { mid: 'M2', name: 'Ibuprofène', price: 3, stock: '5', pharmacyUid: 'pharma-1' },
];
const SERVER_MEDS = {
  M1: { mid: 'M1', name: 'Paracétamol', stock: '10', pharmacyUid: 'pharma-1' },
  M2: { mid: 'M2', name: 'Ibuprofène', stock: '5', pharmacyUid: 'pharma-1' },
};

test('addSaleAtomic : vente valide → confirmed, stock serveur décrémenté dans la transaction', async () => {
  const { DB, firebaseDB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.confirmed, true);
  assert.strictEqual(firebaseDB.server.mc_medicines.M1.stock, '7', 'stock serveur décrémenté 10→7');
  assert.ok(firebaseDB.server.mc_sales[res.sale.sid], 'la vente est posée dans la transaction');
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '7', 'cache local à jour après confirmation');
});

test('addSaleAtomic : SURVENTE CONCURRENTE — stock serveur (2) < stock local (10) → refus, rien écrit', async () => {
  // Le cache local croit encore stock=10, mais un autre poste a déjà vendu :
  // le serveur est à 2. La transaction relit 2 et refuse une vente de 8.
  const { DB, firebaseDB } = setup({
    medicines: LOCAL_MEDS,
    serverMeds: { M1: { mid: 'M1', name: 'Paracétamol', stock: '2', pharmacyUid: 'pharma-1' } },
  });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 8, price: 2 }], 16, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].available, 2, 'le stock refusé est celui RELU en base, pas le local');
  assert.strictEqual(res.insufficient[0].requested, 8);
  assert.strictEqual(firebaseDB.server.mc_medicines.M1.stock, '2', 'stock serveur intact');
  assert.strictEqual(Object.keys(firebaseDB.server.mc_sales).length, 0, 'aucune vente posée');
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10', 'cache local intact');
});

test('addSaleAtomic : survente évidente (local aussi) refusée avant transaction', async () => {
  const { DB, firebaseDB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M2', name: 'Ibuprofène', qty: 9, price: 3 }], 27, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].available, 5);
  assert.strictEqual(firebaseDB.txWrites.length, 0, 'la pré-validation locale évite même la transaction');
});

test('addSaleAtomic : panier multi-articles refusé EN ENTIER si un seul dépasse (relu en base)', async () => {
  const { DB, firebaseDB } = setup({
    medicines: LOCAL_MEDS,
    serverMeds: { M1: { mid: 'M1', stock: '10', name: 'Paracétamol' }, M2: { mid: 'M2', stock: '1', name: 'Ibuprofène' } },
  });
  // Local croit M2=5 (donc passe la pré-validation), serveur M2=1 → refus transactionnel.
  const res = await DB.addSaleAtomic([
    { mid: 'M1', name: 'Paracétamol', qty: 2, price: 2 },
    { mid: 'M2', name: 'Ibuprofène', qty: 4, price: 3 },
  ], 16, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(firebaseDB.server.mc_medicines.M1.stock, '10', 'M1 non décrémenté puisque la vente entière est refusée');
  assert.strictEqual(Object.keys(firebaseDB.server.mc_sales).length, 0);
});

test('addSaleAtomic : quantité ≤ 0 refusée', async () => {
  const { DB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 0, price: 2 }], 0, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].reason, 'invalid_qty');
});

test('addSaleAtomic : médicament inconnu refusé', async () => {
  const { DB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M-UNKNOWN', name: 'Fantôme', qty: 1, price: 1 }], 1, null);
  assert.strictEqual(res.reason, 'insufficient_stock');
  assert.strictEqual(res.insufficient[0].reason, 'unknown');
});

test('addSaleAtomic : hors ligne (pas de runTransaction) → queued, cache NON renseigné', async () => {
  const { DB } = setup({ firebaseReady: false, medicines: LOCAL_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.queued, true);
  assert.ok(res.operationId);
  assert.strictEqual(DB.getOutboxSummary().total, 1);
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10');
  assert.strictEqual(DB.getSales().length, 0);
});

test('addSaleAtomic : rejet réel (permission-denied) → failed/blocked, rien en file, stock intact', async () => {
  const { DB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS, failMode: 'blocked' });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.failed, true);
  assert.strictEqual(res.blocked, true);
  assert.strictEqual(res.errorCode, 'permission-denied');
  assert.strictEqual(DB.getOutboxSummary().total, 0);
  assert.strictEqual(DB.getMedicines().find(m => m.mid === 'M1').stock, '10');
});

test('addSaleAtomic : échec transitoire (unavailable) → queued', async () => {
  const { DB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS, failMode: 'transient' });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 3, price: 2 }], 6, null);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(DB.getOutboxSummary().total, 1);
});

test('addSaleAtomic : la vente porte pharmacyUid = utilisateur courant', async () => {
  const { DB, firebaseDB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS });
  const res = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 1, price: 2 }], 2, null);
  assert.strictEqual(firebaseDB.server.mc_sales[res.sale.sid].pharmacyUid, 'pharma-1');
});

test('addSaleAtomic : anti double-appel (busy) pendant une vente en cours', async () => {
  const { DB } = setup({ medicines: LOCAL_MEDS, serverMeds: SERVER_MEDS, failMode: 'slow' });
  const p1 = DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 1, price: 2 }], 2, null);
  const r2 = await DB.addSaleAtomic([{ mid: 'M1', name: 'Paracétamol', qty: 1, price: 2 }], 2, null);
  assert.strictEqual(r2.busy, true, 'le second appel concurrent est absorbé');
  await p1; // laisse la première vente se terminer proprement
});
