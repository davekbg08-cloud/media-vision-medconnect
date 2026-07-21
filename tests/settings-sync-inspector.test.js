/* =====================================================
   Tests — Inspecteur de synchronisation (js/settings.js)
   (audit "workflows mobile/desktop", sections 1-2)

   Bug confirmé : le seul état de synchronisation visible était un
   compte global "N en attente", sans jamais distinguer une écriture
   transitoire (réseau, se corrigera seule) d'une écriture
   structurellement bloquée (permission Firestore refusée — ne se
   corrigera JAMAIS toute seule sans intervention). Cette section
   (mobile ET desktop, Settings.render() étant container-agnostic)
   affiche l'état réel (DB.getOutboxSummary()/getOutboxEntries()) et
   permet un rejeu manuel forcé (checkSync()).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { innerHTML: '', style: {}, textContent: '', disabled: false, dataset: {}, ...initial };
}

function setup({ outboxSummary = { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null }, outboxEntries = [], flushOutboxImpl } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const toasts = [];
  const flushCalls = [];

  const retryOpCalls = [];
  const retryBlockedCalls = [];
  const removeCalls = [];
  const confirmCalls = [];
  const win = {
    Auth: { getUser: () => ({ role: 'doctor', name: 'Dr Test' }), getRoleIcon: () => '👨‍⚕️' },
    DB: {
      getSettings: () => ({}),
      getOutboxSummary: () => outboxSummary,
      getOutboxEntries: () => outboxEntries,
      flushOutbox: flushOutboxImpl || (async (opts) => { flushCalls.push(opts); }),
      retryOutboxOperation: async (id) => { retryOpCalls.push(id); return { ok: true }; },
      retryBlockedOutbox: async () => { retryBlockedCalls.push(true); return { attempted: 1, succeeded: 1, failed: 0 }; },
      removeOutboxOperation: (id) => { removeCalls.push(id); return true; },
      exportOutboxDiagnostic: () => JSON.stringify({ summary: outboxSummary, entries: [] }),
    },
    Currency: { current: () => 'USD', get: () => ({ symbol: '$', name: 'Dollar' }), renderSelector: () => '' },
    I18n: { renderSelector: () => '' },
    App: { toast: (msg, type) => toasts.push({ msg, type }) },
    confirm: (msg) => { confirmCalls.push(msg); return win._confirmAnswer !== false; },
    _confirmAnswer: true,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: {
      body: { contains: () => true, classList: { contains: () => false }, appendChild: () => {} },
      getElementById: getEl,
      createElement: () => ({ style: {}, click(){}, remove(){}, set href(v) {}, set download(v) {} }),
    },
    console,
    Auth: win.Auth, DB: win.DB, Currency: win.Currency, I18n: win.I18n, App: win.App,
    URL: win.URL, Blob: win.Blob,
  };
  vm.createContext(sandbox);
  // js/action-feedback.js pose lui-même window.ActionFeedback (voir sa
  // dernière ligne) — ActionFeedback y est une const top-level, jamais
  // exposée comme propriété du sandbox vm : ne PAS tenter de la relire
  // depuis l'extérieur (sandbox.ActionFeedback serait undefined et
  // écraserait à tort l'assignation correcte faite par le script).
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/action-feedback.js'), 'utf8'), sandbox, { filename: 'js/action-feedback.js' });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/settings.js'), 'utf8'), sandbox, { filename: 'js/settings.js' });
  return { win: sandbox.window, getEl, toasts, flushCalls, retryOpCalls, retryBlockedCalls, removeCalls, confirmCalls };
}

test("l'inspecteur affiche '☁️ Tout est synchronisé' quand la file est vide", () => {
  const { win } = setup({ outboxSummary: { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null } });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /☁️ Tout est synchronisé/);
  assert.doesNotMatch(container.innerHTML, /Opérations bloquées/);
  assert.doesNotMatch(container.innerHTML, /Vérifier les bloquées/);
  assert.doesNotMatch(container.innerHTML, /Export JSON/);
});

test("l'inspecteur affiche le compte 'en attente' (état neutre ⏳) quand tout est retryable", () => {
  const { win } = setup({ outboxSummary: { total: 2, retryable: 2, blocked: 0, oldestQueuedAt: '2026-07-18T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /⏳ 2 écriture\(s\) en attente de synchronisation/);
  assert.match(container.innerHTML, /En attente depuis/);
});

function fakeEntry(over = {}) {
  return {
    operationId: over.operationId || `OP-${Math.random().toString(36).slice(2, 8)}`,
    type: 'set', operationType: `set:${over.collection || 'mc_patients'}`,
    module: over.module || null, userUid: 'user-1', userRole: 'reception', hospitalId: 'EST-1',
    queuedAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    attempts: 0, nextRetryAt: null, classification: 'retryable',
    lastErrorCode: null, lastErrorMessage: null,
    collection: 'mc_patients', docId: 'MC-X', data: {},
    ...over,
  };
}

test("l'inspecteur (v2.9.34) : détail par opération — bloquées ET en attente listées, avec boutons Réessayer/Supprimer par opération", () => {
  const { win } = setup({
    outboxSummary: { total: 2, retryable: 1, blocked: 1, oldestQueuedAt: '2026-07-18T00:00:00.000Z' },
    outboxEntries: [
      fakeEntry({ operationId: 'OP-BLK1', collection: 'mc_patients', docId: 'MC-1', classification: 'blocked', lastErrorCode: 'permission-denied' }),
      fakeEntry({ operationId: 'OP-RTY1', collection: 'mc_messages', docId: 'M-1' }),
    ],
  });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /⚠️ 1 écriture\(s\) bloquée\(s\), 1 en attente/);
  assert.match(container.innerHTML, /Opérations bloquées/);
  assert.match(container.innerHTML, /mc_patients\/MC-1/);
  assert.match(container.innerHTML, /permission-denied/);
  // Chantier v2.9.34 : le détail de CHAQUE opération est affiché,
  // y compris les retryable (module, utilisateur, tentatives...).
  assert.match(container.innerHTML, /mc_messages\/M-1/);
  assert.match(container.innerHTML, /retrySyncOperation\('OP-BLK1'/);
  assert.match(container.innerHTML, /removeSyncOperation\('OP-BLK1'/);
  assert.match(container.innerHTML, /retrySyncOperation\('OP-RTY1'/);
  assert.match(container.innerHTML, /Vérifier les bloquées \(1\)/);
  assert.match(container.innerHTML, /Export JSON de diagnostic/);
  assert.match(container.innerHTML, /reception/, "le rôle de l'utilisateur à l'origine de l'opération est affiché");
});

test("l'inspecteur affiche une opération atomique (batch) comme UNE seule opération, jamais décomposée", () => {
  const { win } = setup({
    outboxSummary: { total: 1, retryable: 1, blocked: 0, oldestQueuedAt: '2026-07-21T00:00:00.000Z' },
    outboxEntries: [fakeEntry({
      operationId: 'OP-GRP1', type: 'batch', operationType: 'patient_create',
      collection: undefined, docId: undefined,
      writes: [['mc_patients', 'MC-9', {}], ['patients', 'MC-9', {}], ['medical_records', 'MC-9', {}], ['patient_directory', 'MC-9', {}]],
      groupId: 'GRP-1',
    })],
  });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /Opération atomique \(mc_patients \+ patients \+ medical_records \+ patient_directory\)/);
  const rowCount = (container.innerHTML.match(/retrySyncOperation\(/g) || []).length;
  assert.strictEqual(rowCount, 1, 'un batch = une seule ligne, un seul bouton Réessayer');
});

test("l'inspecteur plafonne l'affichage à 10 écritures bloquées et indique le reste", () => {
  const entries = Array.from({ length: 13 }, (_, i) => fakeEntry({
    operationId: `OP-${i}`, docId: `MC-${i}`, classification: 'blocked', lastErrorCode: 'permission-denied',
  }));
  const { win } = setup({ outboxSummary: { total: 13, retryable: 0, blocked: 13, oldestQueuedAt: '2026-07-18T00:00:00.000Z' }, outboxEntries: entries });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /… et 3 autre\(s\)\./);
});

test('checkSync() force un rejeu (flushOutbox({ force: true })) puis rafraîchit la page', async () => {
  let callCount = 0;
  const { win, getEl, flushCalls } = setup({
    outboxSummary: { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null },
    flushOutboxImpl: async (opts) => { callCount++; flushCalls.push(opts); },
  });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.checkSync();
  assert.strictEqual(callCount, 1);
  assert.strictEqual(flushCalls[0].force, true);
});

test("checkSync() affiche un toast confirmé si la file est vide après le rejeu", async () => {
  const { win, toasts } = setup({ outboxSummary: { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null } });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.checkSync();
  assert.ok(toasts.some(t => /Tout est synchronisé/.test(t.msg)));
});

test("checkSync() affiche un toast d'erreur (jamais un faux succès) s'il reste des écritures bloquées après le rejeu", async () => {
  const { win, toasts } = setup({ outboxSummary: { total: 1, retryable: 0, blocked: 1, oldestQueuedAt: '2026-07-18T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.checkSync();
  assert.ok(toasts.some(t => t.type === 'error' && /bloquée/.test(t.msg)));
});

test("checkSync() affiche un toast 'en attente' (jamais un succès) s'il reste des écritures purement retryable après le rejeu", async () => {
  const { win, toasts } = setup({ outboxSummary: { total: 2, retryable: 2, blocked: 0, oldestQueuedAt: '2026-07-18T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.checkSync();
  assert.ok(toasts.some(t => /encore en attente/.test(t.msg)));
  assert.ok(!toasts.some(t => /Tout est synchronisé/.test(t.msg)));
});

/* ── Nouvelles actions manuelles (chantier v2.9.34, P0 outbox) ── */

test('checkBlockedSync() délègue à DB.retryBlockedOutbox() — la SEULE voie groupée de rejeu des bloquées', async () => {
  const { win, retryBlockedCalls, flushCalls, toasts } = setup({ outboxSummary: { total: 1, retryable: 0, blocked: 1, oldestQueuedAt: '2026-07-21T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.checkBlockedSync();
  assert.strictEqual(retryBlockedCalls.length, 1);
  assert.strictEqual(flushCalls.length, 0, 'checkBlockedSync ne passe jamais par flushOutbox (qui ignore les bloquées)');
  assert.ok(toasts.some(t => /synchronisée\(s\) avec succès/.test(t.msg)));
});

test('retrySyncOperation(id) délègue à DB.retryOutboxOperation(id) et annonce le succès', async () => {
  const { win, retryOpCalls, toasts } = setup({ outboxSummary: { total: 1, retryable: 0, blocked: 1, oldestQueuedAt: '2026-07-21T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  await win.Settings.retrySyncOperation('OP-XYZ');
  assert.deepStrictEqual(retryOpCalls, ['OP-XYZ']);
  assert.ok(toasts.some(t => /Opération synchronisée avec succès/.test(t.msg)));
});

test('removeSyncOperation(id) : exige une confirmation explicite — refus = aucune suppression', () => {
  const { win, removeCalls, confirmCalls } = setup({ outboxSummary: { total: 1, retryable: 0, blocked: 1, oldestQueuedAt: '2026-07-21T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);

  win._confirmAnswer = false; // l'utilisateur clique « Annuler »
  const refused = win.Settings.removeSyncOperation('OP-DEL');
  assert.strictEqual(refused, false);
  assert.strictEqual(removeCalls.length, 0, 'aucune suppression sans confirmation');
  assert.ok(confirmCalls.length >= 1 && /irréversible/i.test(confirmCalls[0]), 'la confirmation doit avertir du caractère irréversible');

  win._confirmAnswer = true; // l'utilisateur confirme
  const accepted = win.Settings.removeSyncOperation('OP-DEL');
  assert.strictEqual(accepted, true);
  assert.deepStrictEqual(removeCalls, ['OP-DEL']);
});

test('exportSyncDiagnostic() délègue à DB.exportOutboxDiagnostic() (contenu déjà expurgé côté DB) et annonce l\'export', () => {
  const { win, toasts } = setup({ outboxSummary: { total: 1, retryable: 1, blocked: 0, oldestQueuedAt: '2026-07-21T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  win.Settings.exportSyncDiagnostic();
  assert.ok(toasts.some(t => /Diagnostic exporté/.test(t.msg)));
});
