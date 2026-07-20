/* =====================================================
   Tests — js/sync-badge.js : état ⚠️ (écritures bloquées)
   (audit "workflows mobile/desktop", sections 1-2)

   Bug confirmé : le badge ne distinguait jamais une écriture
   transitoire (réseau, se corrigera seule) d'une écriture
   structurellement bloquée (permission Firestore refusée — ne se
   corrigera JAMAIS toute seule) : les deux affichaient le même ⏳
   "en attente", masquant un vrai problème de configuration
   indéfiniment.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function setup({ summary = { total: 0, retryable: 0, blocked: 0 }, online = true, flushOutboxImpl } = {}) {
  const badgeEl = { innerHTML: '' };
  const toasts = [];
  const flushCalls = [];

  const win = {
    navigator: { onLine: online },
    DB: {
      outboxCount: () => summary.total,
      getOutboxSummary: () => summary,
      flushOutbox: flushOutboxImpl || (async (opts) => { flushCalls.push(opts); }),
    },
    App: { toast: (msg, type) => toasts.push({ msg, type }) },
    addEventListener: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  };
  win.window = win;

  const sandbox = {
    window: win,
    navigator: win.navigator,
    document: {
      getElementById: (id) => (id === 'sync-badge-container' ? badgeEl : null),
      readyState: 'complete',
      addEventListener: () => {},
    },
    console,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/sync-badge.js'), 'utf8'), sandbox, { filename: 'js/sync-badge.js' });
  return { win: sandbox.window, badgeEl, toasts, flushCalls };
}

test("render() affiche ☁️ 'Sauvegardé' quand la file est vide et en ligne", () => {
  const { win, badgeEl } = setup({ summary: { total: 0, retryable: 0, blocked: 0 } });
  win.SyncBadge.render();
  assert.match(badgeEl.innerHTML, /☁️/);
  assert.match(badgeEl.innerHTML, /Sauvegardé/);
});

test("render() affiche ⏳ 'N en attente de sync' quand tout est retryable (aucune écriture bloquée)", () => {
  const { win, badgeEl } = setup({ summary: { total: 3, retryable: 3, blocked: 0 } });
  win.SyncBadge.render();
  assert.match(badgeEl.innerHTML, /⏳/);
  assert.match(badgeEl.innerHTML, /3 en attente de sync/);
  assert.doesNotMatch(badgeEl.innerHTML, /⚠️/);
});

test("render() affiche ⚠️ 'N en attente (dont M bloquée(s))' dès qu'au moins une écriture est bloquée", () => {
  const { win, badgeEl } = setup({ summary: { total: 3, retryable: 2, blocked: 1 } });
  win.SyncBadge.render();
  assert.match(badgeEl.innerHTML, /⚠️/);
  assert.match(badgeEl.innerHTML, /3 en attente \(dont 1 bloquée\(s\)\)/);
});

test("render() affiche 📡 'Hors ligne' même si la file contient des écritures bloquées (priorité au signal réseau)", () => {
  const { win, badgeEl } = setup({ summary: { total: 2, retryable: 0, blocked: 2 }, online: false });
  win.SyncBadge.render();
  assert.match(badgeEl.innerHTML, /📡/);
  assert.match(badgeEl.innerHTML, /Hors ligne/);
});

test('forceSync() force le rejeu (flushOutbox({ force: true })) et affiche un toast différencié selon blocked', async () => {
  const { win, toasts, flushCalls } = setup({ summary: { total: 1, retryable: 0, blocked: 1 } });
  await win.SyncBadge.forceSync();
  assert.strictEqual(flushCalls[0].force, true);
  assert.ok(toasts.some(t => /bloquée/.test(t.msg)));
});

test("forceSync() affiche '✅ Tout est synchronisé.' si la file est vide après le rejeu", async () => {
  const { win, toasts } = setup({ summary: { total: 0, retryable: 0, blocked: 0 } });
  await win.SyncBadge.forceSync();
  assert.ok(toasts.some(t => /Tout est synchronisé/.test(t.msg)));
});

test("forceSync() n'appelle jamais flushOutbox() hors ligne (message clair au lieu d'un essai voué à l'échec)", async () => {
  const { win, toasts, flushCalls } = setup({ summary: { total: 1, retryable: 1, blocked: 0 }, online: false });
  await win.SyncBadge.forceSync();
  assert.strictEqual(flushCalls.length, 0);
  assert.ok(toasts.some(t => t.type === 'warning'));
});
