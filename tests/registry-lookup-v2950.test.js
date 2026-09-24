/* =====================================================
   Tests — Registres officiels non énumérables (v2.9.50)

   Contexte (audit) : mc_verified_doctors / pharms / nurses étaient
   lisibles EN ENTIER sans connexion (« allow read: if true »). Or ces
   numéros d'ordre / matricules servent de preuve d'identité à
   l'inscription : la liste complète permettait d'usurper un numéro réel.

   Désormais : lecture unitaire (get) publique, liste (list) réservée à
   l'admin ; l'inscription vérifie UN numéro via ACL.lookupRegistry.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const rules = read('firestore.rules');

for (const col of ['mc_verified_doctors', 'mc_verified_pharms', 'mc_verified_nurses']) {
  test(`${col} : get public, list réservé à l'admin, écriture admin`, () => {
    const start = rules.indexOf(`match /${col}/{docId}`);
    assert.ok(start > 0, 'bloc présent');
    const block = rules.slice(start, rules.indexOf('\n    }', start) + 6);
    assert.match(block, /allow get: if true;/);
    assert.match(block, /allow list: if isAdmin\(\);/);
    assert.match(block, /allow write: if isAdmin\(\);/);
    assert.ok(!/allow read: if true/.test(block), 'plus de lecture publique en bloc');
  });
}

function loadACL(firebaseDB, local = {}) {
  const storage = { ...local };
  const ctx = {
    console: { warn() {}, log() {} },
    localStorage: {
      getItem: (k) => (k in storage ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
    },
    DB: { pushCloud() {}, deleteCloud() {} },
    firebaseDB,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/access_control.js') + '\nthis.ACL = ACL;', ctx);
  return ctx.ACL;
}

function fakeDB(docs, calls = []) {
  return {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => {
          calls.push(`${col}/${id}`);
          const d = docs[`${col}/${id}`];
          return { exists: !!d, data: () => d, metadata: { fromCache: false } };
        },
      }),
    }),
  };
}

test('lookupRegistry interroge UN document par numéro normalisé (majuscules, espaces)', async () => {
  const calls = [];
  const ACL = loadACL(fakeDB({ 'mc_verified_doctors/CNOM123': { order_num: 'CNOM123', name: 'Dr A' } }, calls));
  const r = await ACL.lookupRegistry('doctor', '  cnom123 ');
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.data.name, 'Dr A');
  assert.deepStrictEqual(calls, ['mc_verified_doctors/CNOM123']);
});

test('lookupRegistry : numéro absent côté serveur → non vérifié (sans repli sur un cache local)', async () => {
  const ACL = loadACL(fakeDB({}), {
    mc_verified_nurses: JSON.stringify([{ matricule: 'INF9', name: 'périmé' }]),
  });
  const r = await ACL.lookupRegistry('nurse', 'INF9');
  assert.strictEqual(r.verified, false);
});

test('lookupRegistry : Firestore indisponible → repli sur la liste locale', async () => {
  const broken = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };
  const ACL = loadACL(broken, { mc_verified_pharms: JSON.stringify([{ matricule: 'PH1', name: 'Pharma' }]) });
  const r = await ACL.lookupRegistry('pharmacist', 'ph1');
  assert.strictEqual(r.verified, true);
});

test('lookupRegistry : rôle inconnu ou numéro vide → non vérifié, sans appel réseau', async () => {
  const calls = [];
  const ACL = loadACL(fakeDB({}, calls));
  assert.strictEqual((await ACL.lookupRegistry('lab', 'X')).verified, false);
  assert.strictEqual((await ACL.lookupRegistry('doctor', '   ')).verified, false);
  assert.strictEqual(calls.length, 0);
});

test("l'inscription utilise la recherche unitaire (auth.js et registration-submit-flow.js)", () => {
  const auth = read('js/auth.js');
  const flow = read('js/registration-submit-flow.js');
  assert.match(auth, /await ACL\.lookupRegistry\(role, num\)/);
  assert.match(flow, /const registry = await roleRegistryInfo\(role, number\);/);
  assert.match(flow, /ACL\.lookupRegistry\(role, number\)/);
});

test('la synchro purge la copie locale des registres quand la liste est refusée', () => {
  const db = read('js/db.js');
  assert.match(db, /REGISTRY_COLLECTIONS\.has\(col\) && e\?\.code === 'permission-denied'\) \{ store\(col, \[\]\);/);
});
