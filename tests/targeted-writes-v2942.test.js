/* =====================================================
   Tests — Écritures ciblées (chantier 8, v2.9.42)

   saveAccounts/saveUsers/saveRegistrationRequests (db.js) et
   saveAffiliations (hospitals_registry.js) ne republient plus TOUTE la
   liste vers Firestore à chaque appel : seuls les documents nouveaux ou
   modifiés (diff par identifiant) sont poussés. On ne renvoie jamais vers
   Firestore un document d'un autre utilisateur simplement présent dans le
   cache. Vérifié au comportement via un DB simulé (db.js) et au source
   (hospitals_registry.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDb() {
  const pushes = [];
  const stores = {};
  const sandbox = {
    console,
    window: {},
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
    },
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
    navigator: { onLine: true }, addEventListener: () => {},
    // Globals Firebase attendus par db.js (_push) — hors ligne : les
    // écritures partent proprement en outbox, sans ReferenceError.
    firebaseReady: false, firebaseDB: null, firebaseAuth: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  const DB = sandbox.window.DB;
  // Intercepte les écritures cloud en surchargeant firebaseDB/_push via l'API publique :
  // on observe les pushes par l'outbox (mc_cloud_outbox) — plus simple : on lit
  // combien de documents mc_accounts partent en file quand rien ne change.
  return { DB, sandbox, pushes, stores };
}

test('saveAccounts ne repousse pas les comptes inchangés', () => {
  const { DB, sandbox } = loadDb();
  // Premier enregistrement : 2 comptes → tous deux "nouveaux".
  const a1 = { uid: 'U1', name: 'Alice', role: 'patient' };
  const a2 = { uid: 'U2', name: 'Bob', role: 'doctor' };
  DB.saveAccounts([a1, a2]);
  const outbox1 = JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]');
  const pushed1 = outbox1.filter(e => (e.collection || e.col) === 'mc_accounts' || JSON.stringify(e).includes('mc_accounts')).length;
  // Deuxième appel : on ne modifie QUE a2 ; a1 est identique → a1 ne doit pas repartir.
  const a2b = { uid: 'U2', name: 'Bob M.', role: 'doctor' };
  const outboxBefore = JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]').length;
  DB.saveAccounts([a1, a2b]);
  const outboxAfter = JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]').length;
  // Le cache local reflète bien la modification.
  const accs = DB.getAccounts();
  assert.strictEqual(accs.find(a => a.uid === 'U2').name, 'Bob M.');
  assert.strictEqual(accs.find(a => a.uid === 'U1').name, 'Alice');
  // Au 2e appel, au plus UN document (U2) a pu être mis en file — jamais les deux.
  assert.ok(outboxAfter - outboxBefore <= 1, 'un seul document modifié doit être poussé, pas toute la liste');
});

test('un 2e saveAccounts identique ne génère aucune nouvelle écriture', () => {
  const { DB, sandbox } = loadDb();
  const list = [{ uid: 'U1', name: 'Alice', role: 'patient' }];
  DB.saveAccounts(list);
  const before = JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]').length;
  DB.saveAccounts([{ uid: 'U1', name: 'Alice', role: 'patient' }]); // identique
  const after = JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]').length;
  assert.strictEqual(after, before, 'aucune écriture cloud pour une liste identique');
});

test('le diff ciblé existe dans db.js et hospitals_registry.js', () => {
  const db = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  const reg = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospitals_registry.js'), 'utf8');
  assert.match(db, /function _changedByKey/);
  assert.match(db, /_changedByKey\(load\('mc_accounts'\), l, 'uid'\)/);
  assert.match(db, /_changedByKey\(load\('users'\), l, 'uid'\)/);
  assert.match(db, /_changedByKey\(load\('registration_requests'\), l, 'requestId'\)/);
  assert.match(reg, /prev\.get\(a\.requestId\) !== JSON\.stringify\(a\)/);
});
