/* =====================================================
   Tests — Recherche patient bornée par établissement (chantier 9, v2.9.42)

   searchPatients(q, establishmentIds?) : sans le 2e paramètre, comportement
   inchangé (rétro-compatible). Avec un ou plusieurs establishmentId, aucune
   fiche hors de ces établissements ne remonte — même si elle traîne encore
   dans le cache local (mergeStore ne supprime jamais). Vérifie l'isolation
   inter-établissements contre une fuite via un cache non purgé.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDb() {
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
    firebaseReady: false, firebaseDB: null, firebaseAuth: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { DB: sandbox.window.DB, sandbox };
}

function seed(DB) {
  // Deux fiches, deux établissements différents, présentes dans le MÊME cache.
  DB.savePatients([
    { id: 'MC-A', firstname: 'Alice', lastname: 'Martin', phone: '111', establishmentId: 'HOSP-A' },
    { id: 'MC-B', firstname: 'Alice', lastname: 'Bernard', phone: '222', hospital_id: 'HOSP-B' },
  ]);
}

test('sans borne d\'établissement : comportement inchangé (rétro-compatible)', () => {
  const { DB } = loadDb();
  seed(DB);
  const res = DB.searchPatients('alice');
  assert.strictEqual(res.length, 2, 'les deux fiches remontent sans borne');
});

test('avec borne : seule la fiche de l\'établissement demandé remonte', () => {
  const { DB } = loadDb();
  seed(DB);
  const res = DB.searchPatients('alice', 'HOSP-A');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-A');
});

test('la borne accepte hospital_id comme establishmentId (champs équivalents)', () => {
  const { DB } = loadDb();
  seed(DB);
  const res = DB.searchPatients('alice', 'HOSP-B');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-B', 'la fiche portant hospital_id est bien reconnue');
});

test('borne multi-établissements (agent rattaché à plusieurs) : union', () => {
  const { DB } = loadDb();
  seed(DB);
  const res = DB.searchPatients('alice', ['HOSP-A', 'HOSP-B']);
  assert.strictEqual(res.length, 2);
});

test('une fiche d\'un établissement hors borne ne fuite jamais, même en cache', () => {
  const { DB } = loadDb();
  seed(DB);
  // L'agent n'est rattaché qu'à HOSP-A ; MC-B (HOSP-B) traîne en cache.
  const res = DB.searchPatients('', 'HOSP-A'); // liste complète bornée
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-A', 'aucune fiche hors borne ne remonte');
});
