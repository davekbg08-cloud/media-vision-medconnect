/* =====================================================
   Tests — ActionFeedback (chantier "workflows mobile/desktop",
   section 14)

   Bug confirmé : chaque écran critique réimplémentait à la main
   son propre verrou de réentrance + état du bouton + toast
   confirmé/en attente/échec (js/hospital-messages.js send(),
   js/network.js sendMessage()...), avec des variations
   involontaires (parfois pas de verrou du tout). Ce fichier
   verrouille le comportement du helper commun.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeButton(initial = {}) {
  return { textContent: '', disabled: false, dataset: {}, ...initial };
}

function setup() {
  const toasts = [];
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.App = { toast: (msg, type) => toasts.push({ msg, type }) };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/action-feedback.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/action-feedback.js' });
  return { win: sandbox.window, toasts };
}

test('start() verrouille le bouton (disabled, label, dataset.processing) et retourne true la première fois', () => {
  const { win } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  const ok = win.ActionFeedback.start(btn, '⏳ Envoi…');
  assert.strictEqual(ok, true);
  assert.strictEqual(btn.disabled, true);
  assert.strictEqual(btn.textContent, '⏳ Envoi…');
  assert.strictEqual(btn.dataset.processing, 'true');
  assert.strictEqual(btn.dataset.originalLabel, 'Envoyer', 'le label d\'origine doit être mémorisé pour reset()');
});

test('start() refuse un second verrouillage tant que le premier n\'a pas été reset() (anti-réentrance)', () => {
  const { win } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  assert.strictEqual(win.ActionFeedback.start(btn, '⏳…'), true);
  assert.strictEqual(win.ActionFeedback.start(btn, '⏳…'), false, 'un second clic pendant l\'action en cours ne doit jamais relancer l\'action');
});

test('start() sans bouton (btn null/undefined) ne lève jamais et retourne true (action non bloquée par un DOM absent)', () => {
  const { win } = setup();
  assert.strictEqual(win.ActionFeedback.start(null, '…'), true);
  assert.strictEqual(win.ActionFeedback.start(undefined, '…'), true);
});

test('reset() restaure le label d\'origine, réactive le bouton et efface le verrou', () => {
  const { win } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  win.ActionFeedback.start(btn, '⏳…');
  win.ActionFeedback.reset(btn);
  assert.strictEqual(btn.disabled, false);
  assert.strictEqual(btn.textContent, 'Envoyer');
  assert.strictEqual(btn.dataset.processing, undefined);
  assert.strictEqual(btn.dataset.originalLabel, undefined);
  // Un nouveau start() doit donc de nouveau réussir.
  assert.strictEqual(win.ActionFeedback.start(btn, '⏳…'), true);
});

test('progress() change le texte SANS re-verrouiller (utile pour un texte à plusieurs étapes)', () => {
  const { win } = setup();
  const btn = fakeButton({ textContent: 'Enregistrer' });
  win.ActionFeedback.start(btn, '⏳ Recherche…');
  win.ActionFeedback.progress(btn, '⏳ Création…');
  assert.strictEqual(btn.textContent, '⏳ Création…');
  assert.strictEqual(btn.disabled, true, 'progress() ne doit pas altérer le verrouillage');
});

test('confirmed()/queued()/failed() relaient un toast via App.toast (succès, succès partiel, erreur)', () => {
  const { win, toasts } = setup();
  win.ActionFeedback.confirmed('✅ Message envoyé.');
  win.ActionFeedback.queued('📶 En attente.');
  win.ActionFeedback.failed('Erreur réseau.');
  assert.strictEqual(toasts[0].msg, '✅ Message envoyé.');
  assert.strictEqual(toasts[1].msg, '📶 En attente.');
  assert.strictEqual(toasts[2].msg, 'Erreur réseau.');
  assert.strictEqual(toasts[2].type, 'error');
});

test("failed() sans message utilise un texte de repli générique (jamais un toast vide)", () => {
  const { win, toasts } = setup();
  win.ActionFeedback.failed();
  assert.strictEqual(toasts[0].msg, 'Action impossible.');
});

test("withAction() : verrouille, appelle fn(), affiche 'confirmed' pour state:'confirmed', puis reset() même en succès", async () => {
  const { win, toasts } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  let calledWhileLocked = null;
  const result = await win.ActionFeedback.withAction(btn, {
    startLabel: '⏳ Envoi…', confirmedMsg: '✅ Envoyé.',
  }, async () => {
    calledWhileLocked = btn.disabled;
    return { ok: true, state: 'confirmed', cloudConfirmed: true };
  });
  assert.strictEqual(calledWhileLocked, true, 'fn() doit s\'exécuter PENDANT que le bouton est verrouillé');
  assert.deepStrictEqual(result, { ok: true, state: 'confirmed', cloudConfirmed: true });
  assert.strictEqual(toasts[0].msg, '✅ Envoyé.');
  assert.strictEqual(btn.disabled, false, 'le bouton doit être réactivé après l\'action');
  assert.strictEqual(btn.textContent, 'Envoyer', 'le label d\'origine doit être restauré');
});

test("withAction() : affiche 'queued' pour state:'queued' (jamais un faux succès plein)", async () => {
  const { win, toasts } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  const result = await win.ActionFeedback.withAction(btn, {
    queuedMsg: '📶 En file.',
  }, async () => ({ ok: true, state: 'queued', cloudConfirmed: false }));
  assert.strictEqual(result.state, 'queued');
  assert.strictEqual(toasts[0].msg, '📶 En file.');
});

test("withAction() : une exception dans fn() déclenche failed(), reset() quand même, et RE-LÈVE l'erreur (l'appelant garde le contrôle)", async () => {
  const { win, toasts } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  await assert.rejects(
    win.ActionFeedback.withAction(btn, { failedMsg: 'Repli.' }, async () => { throw new Error('Panne réseau'); }),
    /Panne réseau/
  );
  assert.strictEqual(toasts[0].msg, 'Panne réseau');
  assert.strictEqual(toasts[0].type, 'error');
  assert.strictEqual(btn.disabled, false, 'reset() doit s\'exécuter même après une exception (finally)');
});

test("withAction() : refuse un second appel concurrent (réentrance) et retourne { ok:false, state:'busy' } sans appeler fn()", async () => {
  const { win } = setup();
  const btn = fakeButton({ textContent: 'Envoyer' });
  let fnCalls = 0;
  const first = win.ActionFeedback.withAction(btn, {}, async () => {
    fnCalls++;
    await new Promise(r => setTimeout(r, 10));
    return { ok: true, state: 'confirmed' };
  });
  const second = await win.ActionFeedback.withAction(btn, {}, async () => { fnCalls++; return { ok: true, state: 'confirmed' }; });
  // deepStrictEqual comparerait aussi le prototype de l'objet — `second`
  // provient d'un autre "royaume" JS (vm.createContext) — voir la même
  // note dans tests/network-messaging-confirmed-queued.test.js.
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.state, 'busy');
  await first;
  assert.strictEqual(fnCalls, 1, 'fn() ne doit être appelée qu\'une seule fois malgré les deux appels concurrents');
});

test("withAction() sans bouton (btn null) fonctionne quand même (formulaires sans bouton de soumission dédié)", async () => {
  const { win, toasts } = setup();
  const result = await win.ActionFeedback.withAction(null, { confirmedMsg: '✅ OK.' }, async () => ({ ok: true, state: 'confirmed' }));
  assert.strictEqual(result.state, 'confirmed');
  assert.strictEqual(toasts[0].msg, '✅ OK.');
});

/* ── v2.9.34 (P1) : reportAtomic — interprétation centralisée du
   contrat atomique enrichi ({confirmed}|{queued}|{failed,blocked}|
   {busy}|{reason:'insufficient_stock'}) ── */

test("reportAtomic() : { confirmed } → toast succès et renvoie 'confirmed'", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic({ confirmed: true }, { confirmedMsg: '✅ Fait.' });
  assert.strictEqual(state, 'confirmed');
  assert.strictEqual(toasts[0].msg, '✅ Fait.');
  assert.strictEqual(toasts[0].type, undefined, 'un succès n\'est jamais un toast d\'erreur');
});

test("reportAtomic() : { busy } → aucun toast, renvoie 'busy' (double-appui déjà absorbé)", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic({ busy: true }, { confirmedMsg: '✅' });
  assert.strictEqual(state, 'busy');
  assert.strictEqual(toasts.length, 0);
});

test("reportAtomic() : { queued } → toast en attente et renvoie 'queued'", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic({ queued: true, operationId: 'op1' }, { queuedMsg: '📶 En file.' });
  assert.strictEqual(state, 'queued');
  assert.strictEqual(toasts[0].msg, '📶 En file.');
  assert.strictEqual(toasts[0].type, undefined);
});

test("reportAtomic() : { reason:'insufficient_stock' } → toast erreur et renvoie 'insufficient_stock'", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic({ reason: 'insufficient_stock' }, { insufficientMsg: '❌ Stock.' });
  assert.strictEqual(state, 'insufficient_stock');
  assert.strictEqual(toasts[0].msg, '❌ Stock.');
  assert.strictEqual(toasts[0].type, 'error');
});

test("reportAtomic() : { failed, blocked } → toast erreur (blockedMsg prioritaire) et renvoie 'failed'", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic(
    { failed: true, blocked: true, errorCode: 'permission-denied' },
    { blockedMsg: '❌ Refusé.', failedMsg: '❌ Générique.' });
  assert.strictEqual(state, 'failed');
  assert.strictEqual(toasts[0].msg, '❌ Refusé.');
  assert.strictEqual(toasts[0].type, 'error');
});

test("reportAtomic() : échec transitoire (failed sans blocked) → failedMsg et renvoie 'failed'", () => {
  const { win, toasts } = setup();
  const state = win.ActionFeedback.reportAtomic({ failed: true }, { failedMsg: '❌ Réessayez.' });
  assert.strictEqual(state, 'failed');
  assert.strictEqual(toasts[0].msg, '❌ Réessayez.');
  assert.strictEqual(toasts[0].type, 'error');
});

test("reportAtomic() : priorité confirmed sur les autres champs, jamais de double toast", () => {
  const { win, toasts } = setup();
  win.ActionFeedback.reportAtomic({ confirmed: true }, {});
  assert.strictEqual(toasts.length, 1);
});
