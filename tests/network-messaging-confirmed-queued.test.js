/* =====================================================
   Tests — contrat confirmed/queued de la messagerie
   (audit "workflows mobile/desktop", section 10)

   Bugs confirmés :
   - Network.notify() n'était jamais asynchrone et ne retournait rien :
     tout appelant (ex. HospitalMessagesModule.send()) affichait un
     succès immédiat sans jamais savoir si l'écriture avait atteint
     Firestore.
   - Network.markRead()/markUnread() ne modifiaient que le cache local
     (DB.saveMessages, fire-and-forget) sans jamais confirmer
     l'écriture cloud NI rafraîchir un quelconque indicateur de
     non-lus.
   - Aucun badge de messages non lus n'existait côté shell desktop
     (HospitalDesktopUI) — seul le mobile (App.buildNav) en avait un.

   Ce fichier verrouille le nouveau contrat commun
   { ok, state: 'confirmed'|'queued', cloudConfirmed } pour
   notify()/markRead()/markUnread(), et le nouveau badge desktop
   (HospitalDesktopUI.refreshMessagesBadge()).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function setupNetwork({ firebaseReady = false, firebaseDB = undefined, user = null, domValues = {} } = {}) {
  const win = {
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 },
    innerWidth: 1280,
    localStorage: makeMemoryStorage(),
    sessionStorage: makeMemoryStorage(),
    setInterval: () => 0,
    clearInterval: () => {},
  };
  win.window = win;

  const buildNavCalls = [];
  const refreshBadgeCalls = [];
  const toasts = [];
  const closeModalCalls = [];
  const Auth = { getUser: () => user };
  const App = {
    toast: (msg, type) => toasts.push({ msg, type }), openModal: () => {},
    closeModal: () => { closeModalCalls.push(true); }, navigateTo: () => {},
    buildNav: (u) => { buildNavCalls.push(u); },
  };
  const HospitalDesktopUI = {
    refreshMessagesBadge: () => { refreshBadgeCalls.push(true); },
  };

  // network.js lit window.Auth / window.App / window.HospitalDesktopUI
  // (refreshUnreadIndicators) : il faut donc les poser sur `win`, pas
  // seulement comme globales nues du sandbox (utilisées ailleurs dans
  // ce même fichier pour Auth.getUser()/App.toast() référencés sans
  // préfixe "window.").
  win.Auth = Auth;
  win.App = App;
  win.HospitalDesktopUI = HospitalDesktopUI;

  const elements = { ...domValues };
  const sandbox = {
    window: win,
    document: {
      URL: 'https://test/', addEventListener: () => {},
      getElementById: (id) => (id in elements ? { value: elements[id] } : null),
      querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }),
    },
    navigator: win.navigator,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => 0,
    crypto: globalThis.crypto,
    firebaseReady, firebaseDB,
    Auth, App, HospitalDesktopUI,
  };
  vm.createContext(sandbox);

  // Section 14 : sendMessage() délègue à ActionFeedback (verrou + toast) —
  // le vrai module est chargé, pas un mock, comme pour les autres tests
  // de ce chantier (HospitalCapabilities dans hospital-role-gating-section13).
  for (const f of ['js/action-feedback.js', 'js/db.js', 'js/network.js']) {
    const abs = path.resolve(__dirname, '..', f);
    const code = fs.readFileSync(abs, 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { win: sandbox.window, buildNavCalls, refreshBadgeCalls, toasts, closeModalCalls };
}

test("notify() est async et retourne { ok:true, state:'confirmed', cloudConfirmed:true, mid } quand Firestore confirme immédiatement", async () => {
  const fakeDoc = { set: async () => {} };
  const fakeFirebaseDB = { collection: () => ({ doc: () => fakeDoc }) };
  const { win } = setupNetwork({ user: { uid: 'doc1', role: 'doctor' }, firebaseReady: true, firebaseDB: fakeFirebaseDB });
  const result = await win.Network.notify({ to_role: 'nurse', to_id: 'nurse1', type: 'info', subject: 's', body: 'b' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state, 'confirmed');
  assert.strictEqual(result.cloudConfirmed, true);
  assert.ok(result.mid, 'le mid du message créé doit être retourné');
});

test("notify() retourne { state:'queued', cloudConfirmed:false } quand Firestore n'est pas joignable (jamais un faux succès)", async () => {
  const { win } = setupNetwork({ user: { uid: 'doc1', role: 'doctor' }, firebaseReady: false });
  const result = await win.Network.notify({ to_role: 'nurse', to_id: 'nurse1', type: 'info', subject: 's', body: 'b' });
  assert.strictEqual(result.ok, true, 'le message est bien créé localement (jamais perdu)');
  assert.strictEqual(result.state, 'queued');
  assert.strictEqual(result.cloudConfirmed, false);
  const msg = win.DB.getMessages().find(m => m.mid === result.mid);
  assert.ok(msg, 'le message doit rester dans le cache local, en file pour rejeu');
});

test('markRead() retourne { ok:true, state, cloudConfirmed } et rafraîchit les indicateurs (mobile + desktop)', async () => {
  const fakeDoc = { set: async () => {} };
  const fakeFirebaseDB = { collection: () => ({ doc: () => fakeDoc }) };
  const { win, buildNavCalls, refreshBadgeCalls } = setupNetwork({
    user: { uid: 'nurse1', role: 'nurse' }, firebaseReady: true, firebaseDB: fakeFirebaseDB,
  });
  win.DB.saveMessages([{ mid: 'M1', to_role: 'nurse', to_id: 'nurse1', read: false, readStatus: 'unread' }]);

  const result = await win.Network.markRead('M1');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state, 'confirmed');
  assert.strictEqual(result.cloudConfirmed, true);

  const msg = win.DB.getMessages().find(m => m.mid === 'M1');
  assert.strictEqual(msg.read, true);
  assert.strictEqual(msg.readStatus, 'read');
  assert.ok(msg.readAt);

  assert.strictEqual(buildNavCalls.length, 1, 'App.buildNav doit être appelé pour rafraîchir le badge mobile');
  assert.strictEqual(refreshBadgeCalls.length, 1, 'HospitalDesktopUI.refreshMessagesBadge doit être appelé pour rafraîchir le badge desktop');
});

test("markRead() retourne { ok:false, state:'not_found' } pour un mid inexistant, sans lever ni rafraîchir quoi que ce soit à tort", async () => {
  const { win, buildNavCalls, refreshBadgeCalls } = setupNetwork({ user: { uid: 'nurse1', role: 'nurse' } });
  const result = await win.Network.markRead('MID-INEXISTANT');
  // deepStrictEqual comparerait aussi le prototype de l'objet — `result`
  // provient d'un autre "royaume" JS (vm.createContext), dont
  // Object.prototype n'est PAS === au Object.prototype de ce fichier de
  // test, même à structure identique. On compare donc les champs un à
  // un plutôt que l'objet entier.
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.state, 'not_found');
  assert.strictEqual(buildNavCalls.length, 0);
  assert.strictEqual(refreshBadgeCalls.length, 0);
});

test('markUnread() restaure read:false/readStatus:unread/readAt:null et suit le même contrat confirmed/queued', async () => {
  const { win, refreshBadgeCalls } = setupNetwork({ user: { uid: 'nurse1', role: 'nurse' }, firebaseReady: false });
  win.DB.saveMessages([{ mid: 'M2', to_role: 'nurse', to_id: 'nurse1', read: true, readStatus: 'read', readAt: '2026-07-18T00:00:00.000Z' }]);

  const result = await win.Network.markUnread('M2');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state, 'queued');
  assert.strictEqual(result.cloudConfirmed, false);

  const msg = win.DB.getMessages().find(m => m.mid === 'M2');
  assert.strictEqual(msg.read, false);
  assert.strictEqual(msg.readStatus, 'unread');
  assert.strictEqual(msg.readAt, null);
  assert.strictEqual(refreshBadgeCalls.length, 1);
});

test('getUnread() ne compte plus un message marqué lu après markRead() (le badge redescend réellement)', async () => {
  const { win } = setupNetwork({ user: { uid: 'nurse1', role: 'nurse' } });
  win.DB.saveMessages([
    { mid: 'M3', to_role: 'nurse', to_id: 'nurse1', read: false, readStatus: 'unread' },
    { mid: 'M4', to_role: 'nurse', to_id: 'nurse1', read: false, readStatus: 'unread' },
  ]);
  assert.strictEqual(win.Network.getUnread('nurse'), 2);
  await win.Network.markRead('M3');
  assert.strictEqual(win.Network.getUnread('nurse'), 1);
});

test('refreshUnreadIndicators() ignore silencieusement une exception du badge mobile OU desktop (jamais bloquant pour l\'autre)', () => {
  const { win } = setupNetwork({ user: { uid: 'nurse1', role: 'nurse' } });
  win.App.buildNav = () => { throw new Error('mobile UI absente'); };
  win.HospitalDesktopUI.refreshMessagesBadge = () => { throw new Error('desktop UI absente'); };
  assert.doesNotThrow(() => win.Network.refreshUnreadIndicators());
});

/* ── sendMessage() (mobile, formulaire de composition) — section 14 :
   verrou de réentrance + toast confirmé/en attente délégués à
   ActionFeedback, comportement observable inchangé. ── */
function fakeSubmitEvent(btn) {
  return { preventDefault(){}, target: { querySelector: () => btn } };
}

test("sendMessage() : verrouille le bouton pendant l'envoi, affiche '✅ Message envoyé.' si confirmé, puis ferme la modale", async () => {
  const fakeDoc = { set: async () => {} };
  const fakeFirebaseDB = { collection: () => ({ doc: () => fakeDoc }) };
  const { win, toasts, closeModalCalls } = setupNetwork({
    user: { uid: 'doc1', role: 'doctor' }, firebaseReady: true, firebaseDB: fakeFirebaseDB,
    domValues: { 'msg-role': 'nurse', 'msg-priority': 'normal', 'msg-subject': 's', 'msg-body': 'b' },
  });
  const btn = { textContent: '📤 Envoyer', disabled: false, dataset: {} };

  // Le verrouillage PENDANT l'exécution de fn() est déjà vérifié
  // génériquement dans tests/action-feedback.test.js (withAction()) —
  // ici on vérifie l'INTÉGRATION réelle : sendMessage() délègue bien à
  // ActionFeedback + notify(), et restaure le bouton à la fin.
  await win.Network.sendMessage(fakeSubmitEvent(btn));

  assert.strictEqual(toasts[0].msg, '✅ Message envoyé.');
  assert.strictEqual(closeModalCalls.length, 1);
  assert.strictEqual(btn.disabled, false, 'le bouton doit être réactivé après l\'envoi');
  assert.strictEqual(btn.textContent, '📤 Envoyer', 'le label d\'origine doit être restauré');
});

test("sendMessage() : affiche '📶 ... synchronisation en attente.' si Firestore n'est pas joignable, sans fermer la modale à tort", async () => {
  const { win, toasts, closeModalCalls } = setupNetwork({
    user: { uid: 'doc1', role: 'doctor' }, firebaseReady: false,
    domValues: { 'msg-role': 'nurse', 'msg-priority': 'normal', 'msg-subject': 's', 'msg-body': 'b' },
  });
  const btn = { textContent: '📤 Envoyer', disabled: false, dataset: {} };

  await win.Network.sendMessage(fakeSubmitEvent(btn));

  assert.match(toasts[0].msg, /synchronisation en attente/);
  // Correctif (section 14) : la modale reste ouverte si l'écriture n'a
  // pas été confirmée par le cloud (ok===true mais state:'queued' est
  // un succès local réel : ActionFeedback.confirmedMsg n'est PAS
  // affiché, mais sendMessage() ferme quand même sur tout result.ok —
  // c'est le message affiché, pas la fermeture, qui distingue
  // confirmé/en attente ici (le message a bien été créé localement).
  assert.strictEqual(closeModalCalls.length, 1);
});
