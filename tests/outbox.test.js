/* =====================================================
   Tests — File d'écriture cloud (outbox) de db.js
   Vérifie la logique qui a corrigé les pertes de données :
   une écriture qui échoue est mise en file et rejouée
   quand Firestore redevient disponible.

   db.js utilise firebaseReady/firebaseDB comme globales :
   on les fournit dans le sandbox et on les pilote.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

/* Charge db.js avec un Firestore contrôlable. Retourne { DB, ctrl }
   où ctrl permet de simuler la disponibilité et d'inspecter les
   écritures reçues. */
function loadDB() {
  const ctrl = {
    ready: false,          // firebaseReady
    written: [],           // {collection, docId, data}
    failNextSet: false,    // forcer un échec ponctuel
  };
  const fakeDoc = (collection, docId) => ({
    set: async (data) => {
      if (ctrl.failNextSet) { ctrl.failNextSet = false; throw new Error('firestore indispo'); }
      ctrl.written.push({ collection, docId, data });
      return true;
    },
    delete: async () => true,
  });
  const fakeDB = { collection: (c) => ({ doc: (id) => fakeDoc(c, String(id)), get: async () => ({ forEach(){}, empty:true, docs:[] }) }) };

  const storage = makeMemoryStorage();
  const sandbox = {
    console,
    localStorage: storage,
    window: { addEventListener: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    crypto: globalThis.crypto,
    get firebaseReady() { return ctrl.ready; },
    firebaseDB: fakeDB,
    Date,
    JSON,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { DB: sandbox.window.DB, ctrl, storage };
}

test('db.js se charge et expose flushOutbox / outboxCount', () => {
  const { DB } = loadDB();
  assert.ok(DB, 'DB doit être exporté');
  assert.strictEqual(typeof DB.flushOutbox, 'function');
  assert.strictEqual(typeof DB.outboxCount, 'function');
});

test('une écriture hors-ligne est mise en file (pas perdue)', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false; // Firestore indisponible
  // addPatient déclenche _push en interne ; on vérifie via outboxCount.
  DB.addPatient({ firstname: 'Test', lastname: 'Hors-ligne', country_code: 'CD' });
  assert.ok(DB.outboxCount() >= 1, 'la file doit contenir au moins une écriture');
  assert.strictEqual(ctrl.written.length, 0, 'rien ne doit être écrit au cloud hors-ligne');
});

test('la file est rejouée quand Firestore redevient disponible', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  DB.addPatient({ firstname: 'A', lastname: 'B', country_code: 'CD' });
  const enFile = DB.outboxCount();
  assert.ok(enFile >= 1);

  ctrl.ready = true;       // réseau revenu
  await DB.flushOutbox();  // rejeu

  assert.strictEqual(DB.outboxCount(), 0, 'la file doit être vidée après rejeu réussi');
  assert.ok(ctrl.written.length >= 1, 'les écritures doivent atteindre le cloud');
});

test('flushOutbox ne fait rien si Firestore est indisponible', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  DB.addPatient({ firstname: 'C', lastname: 'D', country_code: 'CD' });
  const avant = DB.outboxCount();
  await DB.flushOutbox(); // doit rester en file
  assert.strictEqual(DB.outboxCount(), avant, 'la file ne doit pas se vider hors-ligne');
});
