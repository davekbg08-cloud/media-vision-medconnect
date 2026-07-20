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
      if (ctrl.failNextSet) {
        const failure = ctrl.failNextSet;
        ctrl.failNextSet = false;
        // failNextSet peut être `true` (échec générique, sans code —
        // reproduit le cas hors-ligne/inconnu) ou { code, message }
        // (reproduit une vraie erreur Firestore typée).
        const err = new Error((failure && failure.message) || 'firestore indispo');
        if (failure && failure.code) err.code = failure.code;
        throw err;
      }
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

/* =====================================================
   Classification des erreurs + backoff exponentiel
   (chantier "workflows mobile/desktop", sections 1-2)

   Bug confirmé : TOUTE écriture échouée était rejouée indéfiniment, à
   la même fréquence, qu'elle soit transitoire (hors ligne, ressaie
   toute seule) ou structurellement condamnée à échouer pour toujours
   (permission Firestore refusée) — masquant un vrai problème de
   configuration derrière un badge "en attente" qui ne redescendait
   jamais.
   ===================================================== */

test('classifyOutboxError() : une erreur sans code (hors ligne) est retryable', () => {
  const { DB } = loadDB();
  assert.strictEqual(DB.classifyOutboxError(null), 'retryable');
  assert.strictEqual(DB.classifyOutboxError(new Error('offline')), 'retryable');
});

test("classifyOutboxError() : permission-denied/invalid-argument/failed-precondition sont 'blocked' (ne se corrigeront jamais tout seuls)", () => {
  const { DB } = loadDB();
  for (const code of ['permission-denied', 'invalid-argument', 'failed-precondition', 'not-found', 'already-exists', 'unauthenticated']) {
    const err = Object.assign(new Error('x'), { code });
    assert.strictEqual(DB.classifyOutboxError(err), 'blocked', `${code} doit être classé 'blocked'`);
  }
});

test("classifyOutboxError() : unavailable/deadline-exceeded/aborted restent 'retryable' (transitoires)", () => {
  const { DB } = loadDB();
  for (const code of ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'resource-exhausted']) {
    const err = Object.assign(new Error('x'), { code });
    assert.strictEqual(DB.classifyOutboxError(err), 'retryable', `${code} doit rester 'retryable'`);
  }
});

test('une écriture qui échoue avec permission-denied est classée "blocked" dans la file dès sa mise en attente', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
  await DB.pushCloud('mc_patients', 'MC-BLOCKED-1', { id: 'MC-BLOCKED-1' });

  const entries = DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].classification, 'blocked');
  assert.strictEqual(entries[0].lastErrorCode, 'permission-denied');
});

test('getOutboxSummary() distingue le nombre de retryable et de blocked', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-SUM-1', { id: 'MC-SUM-1' });
  ctrl.failNextSet = { code: 'unavailable' };
  await DB.pushCloud('mc_patients', 'MC-SUM-2', { id: 'MC-SUM-2' });

  const summary = DB.getOutboxSummary();
  assert.strictEqual(summary.total, 2);
  assert.strictEqual(summary.blocked, 1);
  assert.strictEqual(summary.retryable, 1);
  assert.ok(summary.oldestQueuedAt);
});

test('flushOutbox() : après un échec, une entrée reçoit un nextRetryAt futur (backoff) et n\'est PAS rejouée avant ce délai (sans force)', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  await DB.pushCloud('mc_patients', 'MC-BACKOFF-1', { id: 'MC-BACKOFF-1' });

  ctrl.ready = true;
  ctrl.failNextSet = { code: 'unavailable' }; // échoue encore une fois au premier flush
  await DB.flushOutbox();

  const entries = DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1, 'toujours en file après un nouvel échec');
  assert.strictEqual(entries[0].attempts, 1);
  assert.ok(entries[0].nextRetryAt, 'un délai de prochain essai doit être calculé');
  assert.ok(new Date(entries[0].nextRetryAt).getTime() > Date.now(), 'le délai doit être dans le futur');

  // Sans --force, un flush immédiat ne doit PAS retenter (backoff actif) :
  // aucun nouvel essai d'écriture, donc pas de nouvel incrément.
  await DB.flushOutbox();
  assert.strictEqual(DB.getOutboxEntries()[0].attempts, 1, 'le backoff doit empêcher un nouvel essai immédiat');
});

test('flushOutbox({ force: true }) : rejoue MÊME une entrée dont le nextRetryAt n\'est pas encore écoulé', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  await DB.pushCloud('mc_patients', 'MC-FORCE-1', { id: 'MC-FORCE-1' });

  ctrl.ready = true;
  ctrl.failNextSet = { code: 'unavailable' };
  await DB.flushOutbox(); // 1er échec -> backoff actif

  await DB.flushOutbox({ force: true }); // rejeu manuel forcé -> doit réessayer maintenant
  assert.strictEqual(DB.outboxCount(), 0, 'un rejeu forcé qui réussit doit vider la file');
});

test('une entrée "blocked" (permission-denied) reste dans la file (jamais supprimée) mais n\'est plus rejouée à pleine fréquence', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-STUCK-1', { id: 'MC-STUCK-1' });

  ctrl.failNextSet = { code: 'permission-denied' }; // échouera de nouveau si rejoué
  await DB.flushOutbox({ force: true });

  const entries = DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1, 'la donnée ne doit JAMAIS être perdue, même bloquée');
  assert.strictEqual(entries[0].classification, 'blocked');
  assert.ok(entries[0].nextRetryAt, 'même une entrée bloquée reçoit un délai — pas de martelage à pleine fréquence');
});
