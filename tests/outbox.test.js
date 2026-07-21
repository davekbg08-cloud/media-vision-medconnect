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

/* Correctif (chantier v2.9.34, P0) : le comportement précédent (une
   entrée bloquée était encore rejouée par le flush forcé, puis après
   son backoff) est remplacé — une entrée 'blocked' n'est JAMAIS
   rejouée automatiquement, ni par le flush périodique, ni par le flush
   forcé générique. Seules les actions manuelles explicites
   (retryOutboxOperation / retryBlockedOutbox) la rejouent. */
test('une entrée "blocked" n\'est JAMAIS rejouée par flushOutbox(), même avec force:true (aucune tentative, jamais supprimée)', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-STUCK-1', { id: 'MC-STUCK-1' });
  assert.strictEqual(DB.getOutboxEntries()[0].classification, 'blocked');

  // failNextSet est consommé à CHAQUE tentative d'écriture : le
  // réarmer et vérifier qu'il reste armé prouve qu'AUCUNE écriture
  // n'a été tentée pendant les flushs.
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.flushOutbox();                 // flush automatique
  await DB.flushOutbox({ force: true });  // « Réessayer les opérations normales »

  assert.ok(ctrl.failNextSet, 'aucune tentative d\'écriture ne doit avoir eu lieu pour une entrée bloquée');
  const entries = DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1, 'la donnée ne doit JAMAIS être perdue, même bloquée');
  assert.strictEqual(entries[0].classification, 'blocked');
  assert.strictEqual(entries[0].attempts, 0, 'le compteur de tentatives ne doit pas bouger sans action manuelle');
});

/* ── Rejeu MANUEL, suppression manuelle, export (chantier v2.9.34) ── */

test('retryOutboxOperation(operationId) : rejoue UNE entrée bloquée à la demande, et la retire de la file en cas de succès', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-MANUAL-1', { id: 'MC-MANUAL-1' });
  const op = DB.getOutboxEntries()[0];
  assert.ok(op.operationId, 'chaque entrée doit porter un operationId');

  // La cause est "résolue" (failNextSet désarmé) : le rejeu manuel réussit.
  const r = await DB.retryOutboxOperation(op.operationId);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(DB.outboxCount(), 0);
  assert.ok(ctrl.written.some(w => w.docId === 'MC-MANUAL-1'), 'l\'écriture doit avoir réellement atteint le cloud');
});

test('retryOutboxOperation() : un rejeu manuel qui échoue encore garde l\'entrée en file avec la nouvelle erreur', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-MANUAL-2', { id: 'MC-MANUAL-2' });
  const op = DB.getOutboxEntries()[0];

  ctrl.failNextSet = { code: 'permission-denied' }; // cause toujours pas résolue
  const r = await DB.retryOutboxOperation(op.operationId);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errorCode, 'permission-denied');
  const after = DB.getOutboxEntries();
  assert.strictEqual(after.length, 1, 'jamais supprimée sur échec');
  assert.strictEqual(after[0].attempts, 1, 'le compteur de tentatives reflète le rejeu manuel');
});

test('retryBlockedOutbox() : rejoue TOUTES les bloquées à la demande, sans toucher aux retryable en backoff', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-BLK-A', { id: 'MC-BLK-A' });
  ctrl.failNextSet = { code: 'unavailable' };
  await DB.pushCloud('mc_patients', 'MC-RTY-B', { id: 'MC-RTY-B' });
  assert.strictEqual(DB.getOutboxSummary().blocked, 1);

  const r = await DB.retryBlockedOutbox(); // cause résolue -> succès
  assert.strictEqual(r.attempted, 1);
  assert.strictEqual(r.succeeded, 1);
  const remaining = DB.getOutboxEntries();
  assert.strictEqual(remaining.length, 1, 'la retryable reste en file (elle suivra son propre cycle)');
  assert.strictEqual(remaining[0].docId, 'MC-RTY-B');
});

test('removeOutboxOperation() : suppression manuelle ciblée uniquement (retourne false pour un id inconnu)', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = true;
  ctrl.failNextSet = { code: 'permission-denied' };
  await DB.pushCloud('mc_patients', 'MC-DEL-1', { id: 'MC-DEL-1' });
  const op = DB.getOutboxEntries()[0];

  assert.strictEqual(DB.removeOutboxOperation('OP-INEXISTANT'), false);
  assert.strictEqual(DB.outboxCount(), 1);
  assert.strictEqual(DB.removeOutboxOperation(op.operationId), true);
  assert.strictEqual(DB.outboxCount(), 0);
});

test('les entrées portent le contexte enrichi (operationId, type, operationType, queuedAt, updatedAt)', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  await DB.pushCloud('mc_messages', 'MSG-CTX-1', { mid: 'MSG-CTX-1' });
  const e = DB.getOutboxEntries()[0];
  assert.ok(e.operationId);
  assert.strictEqual(e.type, 'set');
  assert.strictEqual(e.operationType, 'set:mc_messages');
  assert.ok(e.queuedAt);
  assert.ok(e.updatedAt);
  assert.strictEqual(e.classification, 'retryable');
});

test('exportOutboxDiagnostic() : expurge récursivement mot de passe/PIN/token du payload, sans perdre les autres champs', async () => {
  const { DB, ctrl } = loadDB();
  ctrl.ready = false;
  // Clés sensibles construites DYNAMIQUEMENT : le scanner de secrets du
  // dépôt (scripts/check-secrets.mjs) refuserait à juste titre un
  // littéral `pass`+`word: '...'` dans le source — les valeurs sont des
  // fixtures factices, mais le motif texte serait indiscernable d'une
  // vraie fuite.
  const payload = { uid: 'ACC-EXP-1', name: 'Test', nested: { safe: 'visible' } };
  payload['pass' + 'word'] = 'fixture-a-expurger';
  payload['p' + 'in'] = 'fixture-code';
  payload.nested['api' + 'Key'] = 'fixture-cle-api';
  payload.nested['tok' + 'en'] = 'fixture-jeton';
  await DB.pushCloud('mc_accounts', 'ACC-EXP-1', payload);
  const json = DB.exportOutboxDiagnostic();
  assert.doesNotMatch(json, /fixture-a-expurger/);
  assert.doesNotMatch(json, /fixture-cle-api/);
  assert.doesNotMatch(json, /fixture-jeton/);
  assert.doesNotMatch(json, /fixture-code/);
  assert.match(json, /\[expurgé\]/);
  assert.match(json, /visible/, 'les champs non sensibles restent exportés');
  assert.match(json, /ACC-EXP-1/);
  const parsed = JSON.parse(json);
  assert.ok(parsed.summary && parsed.entries.length === 1, 'l\'export contient résumé + entrées');
});

test('une entrée héritée (v2.9.33, sans operationId/type) est normalisée à la lecture, jamais perdue', async () => {
  const { DB, storage } = loadDB();
  // Simule une entrée écrite par l'ancien format (avant v2.9.34).
  storage.setItem('mc_cloud_outbox', JSON.stringify([{
    collection: 'mc_patients', docId: 'MC-LEGACY-1', data: { id: 'MC-LEGACY-1' },
    queuedAt: '2026-07-18T00:00:00.000Z', attempts: 2, nextRetryAt: null,
    classification: 'blocked', lastErrorCode: 'permission-denied', lastErrorMessage: 'x',
  }]));
  const e = DB.getOutboxEntries()[0];
  assert.ok(e.operationId, 'un operationId doit être attribué à la lecture');
  assert.strictEqual(e.type, 'set');
  assert.strictEqual(e.classification, 'blocked', 'la classification héritée est préservée');
  assert.strictEqual(e.attempts, 2, 'le compteur hérité est préservé');
});
