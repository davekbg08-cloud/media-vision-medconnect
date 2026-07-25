/* =====================================================
   Tests — Messagerie fiable et confidentielle (chantier 11, v2.9.42)

   Verrouille au comportement les garanties déjà en place (v2.9.34) contre
   toute régression future :
   - pushMessageAndConfirm n'annonce JAMAIS un succès avant confirmation
     serveur réelle : false (en file) hors ligne, true seulement une fois
     l'écriture Firestore aboutie.
   - une seule écriture ciblée (mc_messages/{mid}) par envoi — jamais de copie
     vers une collection `notifications`, jamais de réécriture de toute la boîte.
   - updateMessageStatusAndConfirm ne modifie QUE des champs de statut : le
     contenu, l'expéditeur et le destinataire restent immuables.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadDb() {
  const written = []; // { col, id, data }
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
    firebaseReady: false, firebaseDB: null, firebaseAuth: { currentUser: { uid: 'U' } },
    _written: written,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { DB: sandbox.window.DB, sandbox, written };
}

// Firestore en mémoire enregistrant chaque écriture (pour prouver l'absence
// d'écriture vers `notifications` et l'unicité de l'écriture message).
function onlineFirestore(written) {
  return {
    collection: (col) => ({
      doc: (id) => ({
        async set(data) { written.push({ col, id: String(id), data }); },
      }),
    }),
  };
}

test('hors ligne : pushMessageAndConfirm renvoie false (en file) — jamais de faux « envoyé »', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  const ok = await DB.pushMessageAndConfirm({ mid: 'N1', to_id: 'DOC', subject: 's', body: 'secret' });
  assert.strictEqual(ok, false, 'hors ligne, l\'envoi n\'est jamais confirmé');
  // Le message est bien conservé localement pour rejeu (jamais perdu).
  assert.ok(DB.getMessages().some(m => m.mid === 'N1'));
});

test('en ligne : confirme (true) et écrit UN SEUL document mc_messages (aucune copie notifications)', async () => {
  const { DB, sandbox, written } = loadDb();
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = onlineFirestore(written);
  const ok = await DB.pushMessageAndConfirm({ mid: 'N2', to_id: 'DOC', subject: 's', body: 'secret' });
  assert.strictEqual(ok, true, 'en ligne, la confirmation reflète l\'écriture réelle');
  const cols = written.map(w => w.col);
  assert.deepStrictEqual(cols, ['mc_messages'], 'une seule écriture ciblée, jamais notifications');
  assert.strictEqual(written[0].id, 'N2');
});

test('updateMessageStatusAndConfirm ne touche QUE les champs de statut (contenu immuable)', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  await DB.pushMessageAndConfirm({ mid: 'N3', to_id: 'DOC', fromUid: 'A', subject: 'sujet', body: 'corps' });
  const res = await DB.updateMessageStatusAndConfirm('N3', {
    read: true, readStatus: 'read',
    // Tentative de mutation interdite du contenu / de l'identité :
    body: 'ALTÉRÉ', subject: 'ALTÉRÉ', fromUid: 'PIRATE', to_id: 'AUTRE',
  });
  assert.strictEqual(res.ok, true);
  const m = DB.getMessages().find(x => x.mid === 'N3');
  assert.strictEqual(m.read, true, 'le statut lu est bien appliqué');
  assert.strictEqual(m.body, 'corps', 'le contenu reste immuable');
  assert.strictEqual(m.subject, 'sujet', 'le sujet reste immuable');
  assert.strictEqual(m.fromUid, 'A', 'l\'expéditeur reste immuable');
  assert.strictEqual(m.to_id, 'DOC', 'le destinataire reste immuable');
});

test('updateMessageStatusAndConfirm : état honnête confirmed/queued selon le serveur', async () => {
  const { DB, sandbox, written } = loadDb();
  sandbox.firebaseReady = false;
  await DB.pushMessageAndConfirm({ mid: 'N4', to_id: 'DOC', body: 'x' });
  const offline = await DB.updateMessageStatusAndConfirm('N4', { read: true });
  assert.strictEqual(offline.state, 'queued');
  assert.strictEqual(offline.cloudConfirmed, false);

  sandbox.firebaseReady = true;
  sandbox.firebaseDB = onlineFirestore(written);
  const online = await DB.updateMessageStatusAndConfirm('N4', { read: true });
  assert.strictEqual(online.state, 'confirmed');
  assert.strictEqual(online.cloudConfirmed, true);
});

test('le corps du message ne fuite jamais dans l\'export de diagnostic (metadata-only)', async () => {
  const { DB, sandbox } = loadDb();
  sandbox.firebaseReady = false;
  await DB.pushMessageAndConfirm({ mid: 'N5', to_id: 'DOC', subject: 'RDV', body: 'CONTENU-CONFIDENTIEL' });
  const json = DB.exportOutboxDiagnostic();
  assert.ok(!json.includes('CONTENU-CONFIDENTIEL'), 'le corps ne doit jamais apparaître dans le diagnostic');
});
