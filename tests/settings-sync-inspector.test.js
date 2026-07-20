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

  const win = {
    Auth: { getUser: () => ({ role: 'doctor', name: 'Dr Test' }), getRoleIcon: () => '👨‍⚕️' },
    DB: {
      getSettings: () => ({}),
      getOutboxSummary: () => outboxSummary,
      getOutboxEntries: () => outboxEntries,
      flushOutbox: flushOutboxImpl || (async (opts) => { flushCalls.push(opts); }),
    },
    Currency: { current: () => 'USD', get: () => ({ symbol: '$', name: 'Dollar' }), renderSelector: () => '' },
    I18n: { renderSelector: () => '' },
    App: { toast: (msg, type) => toasts.push({ msg, type }) },
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: { body: { contains: () => true, classList: { contains: () => false } }, getElementById: getEl },
    console,
    Auth: win.Auth, DB: win.DB, Currency: win.Currency, I18n: win.I18n, App: win.App,
  };
  vm.createContext(sandbox);
  // js/action-feedback.js pose lui-même window.ActionFeedback (voir sa
  // dernière ligne) — ActionFeedback y est une const top-level, jamais
  // exposée comme propriété du sandbox vm : ne PAS tenter de la relire
  // depuis l'extérieur (sandbox.ActionFeedback serait undefined et
  // écraserait à tort l'assignation correcte faite par le script).
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/action-feedback.js'), 'utf8'), sandbox, { filename: 'js/action-feedback.js' });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/settings.js'), 'utf8'), sandbox, { filename: 'js/settings.js' });
  return { win: sandbox.window, getEl, toasts, flushCalls };
}

test("l'inspecteur affiche '☁️ Tout est synchronisé' quand la file est vide", () => {
  const { win } = setup({ outboxSummary: { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null } });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /☁️ Tout est synchronisé/);
  assert.doesNotMatch(container.innerHTML, /ne se résoudront pas automatiquement/);
});

test("l'inspecteur affiche le compte 'en attente' (état neutre ⏳) quand tout est retryable", () => {
  const { win } = setup({ outboxSummary: { total: 2, retryable: 2, blocked: 0, oldestQueuedAt: '2026-07-18T00:00:00.000Z' } });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /⏳ 2 écriture\(s\) en attente de synchronisation/);
  assert.match(container.innerHTML, /En attente depuis/);
});

test("l'inspecteur affiche un état ⚠️ et liste les écritures bloquées quand certaines ne se résoudront jamais automatiquement", () => {
  const { win } = setup({
    outboxSummary: { total: 2, retryable: 1, blocked: 1, oldestQueuedAt: '2026-07-18T00:00:00.000Z' },
    outboxEntries: [
      { collection: 'mc_patients', docId: 'MC-1', classification: 'blocked', lastErrorCode: 'permission-denied' },
      { collection: 'mc_messages', docId: 'M-1', classification: 'retryable', lastErrorCode: null },
    ],
  });
  const container = fakeElement();
  win.Settings.render(container);
  assert.match(container.innerHTML, /⚠️ 1 écriture\(s\) bloquée\(s\), 1 en attente/);
  assert.match(container.innerHTML, /ne se résoudront pas automatiquement/);
  assert.match(container.innerHTML, /mc_patients\/MC-1 — permission-denied/);
  assert.doesNotMatch(container.innerHTML, /mc_messages\/M-1/, 'seules les écritures BLOQUÉES sont listées, jamais les simples "en attente"');
});

test("l'inspecteur plafonne l'affichage à 10 écritures bloquées et indique le reste", () => {
  const entries = Array.from({ length: 13 }, (_, i) => ({
    collection: 'mc_patients', docId: `MC-${i}`, classification: 'blocked', lastErrorCode: 'permission-denied',
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
