/* =====================================================
   Tests — Outbox multi-utilisateur sûre (chantier 5, v2.9.42)

   Sur un poste PARTAGÉ (desktop d'établissement), plusieurs agents se
   connectent tour à tour. Une opération mise en file par l'agent A ne doit
   JAMAIS être rejouée sous le compte Firebase de l'agent B qui se connecte
   ensuite : elle est mise en QUARANTAINE et attend le retour de son auteur.

   Vérifié au comportement via un db.js simulé :
   - chaque entrée capture l'ownerAuthUid (uid Firebase réel) à la mise en file ;
   - flushOutbox ne rejoue que les entrées de l'utilisateur courant et laisse
     intactes (jamais rejouées, jamais supprimées) celles d'un autre auteur ;
   - l'export de diagnostic ne contient AUCUN payload (data/writes/ownerAuthUid).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDb() {
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
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    // Firebase : contrôlé test par test (prêt / auth courant / DB simulée).
    firebaseReady: false, firebaseDB: null, firebaseAuth: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { DB: sandbox.window.DB, sandbox };
}

function readOutbox(sandbox) {
  return JSON.parse(sandbox.localStorage.getItem('mc_cloud_outbox') || '[]');
}

test('chaque entrée capture l\'ownerAuthUid Firebase à la mise en file', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false; // hors ligne → mise en file
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_A' } };
  await DB.pushCloud('mc_patients', 'P1', { id: 'P1' });
  const q = readOutbox(sandbox);
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].ownerAuthUid, 'USER_A', 'l\'uid Firebase réel doit être mémorisé');
});

test('flushOutbox rejoue les entrées de l\'utilisateur courant et met en quarantaine celles d\'un autre auteur', async () => {
  const { DB, sandbox } = loadDb();

  // Agent A met une opération en file (hors ligne).
  sandbox.firebaseReady = false;
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_A' } };
  await DB.pushCloud('mc_patients', 'P1', { id: 'P1' });

  // Agent B (même poste) met SON opération en file.
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_B' } };
  await DB.pushCloud('mc_patients', 'P2', { id: 'P2' });

  assert.strictEqual(readOutbox(sandbox).length, 2);

  // Le cloud redevient disponible, l'utilisateur COURANT est A.
  const written = [];
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_A' } };
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = {
    collection: (col) => ({
      doc: (id) => ({
        set: async (data) => { written.push({ col, id, data }); },
      }),
    }),
  };

  await DB.flushOutbox({ force: true });

  // Seule l'opération de A a été rejouée…
  assert.deepStrictEqual(written.map(w => w.id), ['P1'],
    'seule l\'opération de l\'utilisateur courant doit être rejouée');
  // …et celle de B reste intacte en file (jamais rejouée ni supprimée).
  const remaining = readOutbox(sandbox);
  assert.strictEqual(remaining.length, 1, 'l\'opération de l\'autre auteur reste en file');
  assert.strictEqual(remaining[0].ownerAuthUid, 'USER_B');
  assert.strictEqual(remaining[0].docId, 'P2');
});

test('sans utilisateur Firebase connecté, une entrée à propriétaire connu n\'est jamais rejouée', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_A' } };
  await DB.pushCloud('mc_patients', 'P1', { id: 'P1' });

  const written = [];
  sandbox.firebaseReady = true;
  sandbox.firebaseAuth = { currentUser: null }; // personne connecté
  sandbox.firebaseDB = {
    collection: (col) => ({ doc: (id) => ({ set: async (d) => { written.push({ col, id, d }); } }) }),
  };
  await DB.flushOutbox({ force: true });

  assert.strictEqual(written.length, 0, 'aucun rejeu sans identité prouvée');
  assert.strictEqual(readOutbox(sandbox).length, 1, 'l\'entrée attend le retour de son auteur');
});

test('l\'export de diagnostic ne contient aucun payload (data/writes/ownerAuthUid)', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  sandbox.firebaseAuth = { currentUser: { uid: 'USER_A' } };
  await DB.pushCloud('mc_patients', 'P1', { id: 'P1', firstname: 'Jean', lastname: 'Secret', phone: '0102030405' });

  const json = DB.exportOutboxDiagnostic();
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.entries.length, 1);
  const entry = parsed.entries[0];
  // Métadonnées présentes.
  assert.strictEqual(entry.type, 'set');
  assert.deepStrictEqual(entry.collections, ['mc_patients']);
  assert.strictEqual(entry.docCount, 1);
  // JAMAIS de payload ni d'identité propriétaire.
  assert.strictEqual(entry.data, undefined);
  assert.strictEqual(entry.writes, undefined);
  assert.strictEqual(entry.ownerAuthUid, undefined);
  // Aucun contenu sensible dans le JSON complet.
  assert.ok(!json.includes('Secret'), 'aucun nom ne doit fuiter');
  assert.ok(!json.includes('0102030405'), 'aucun téléphone ne doit fuiter');
  assert.ok(!json.includes('USER_A'), 'aucun uid propriétaire ne doit fuiter');
});
