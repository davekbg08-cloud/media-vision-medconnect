/* =====================================================
   Tests — Badge de messages non lus, shell desktop hôpital
   (audit "workflows mobile/desktop", section 10)

   Bug confirmé : aucun indicateur de messages non lus n'existait côté
   shell desktop (HospitalDesktopUI) — seul le mobile (App.buildNav)
   affichait un badge. Un agent hospitalier ne savait donc jamais,
   sans ouvrir "Messagerie" par réflexe, qu'un message l'attendait.

   HospitalDesktopUI.refreshMessagesBadge() réutilise EXACTEMENT le
   même comptage que le mobile (Network.getUnread(role), voir
   tests/network-messaging-confirmed-queued.test.js) — pas de second
   système de comptage parallèle.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(extra = {}) {
  return Object.assign({
    innerHTML: '', style: {}, textContent: '',
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
  }, extra);
}

function setup({ role = 'doctor', unreadCount = 0, currentUser = { uid: 'u1', role: 'doctor' } } = {}) {
  const contentEl = fakeElement();
  const titleEl = fakeElement();
  const badgeEl = fakeElement();
  // "hospital-desktop-root" n'est PAS préenregistré : isOpen() (qui lit
  // getElementById(ROOT_ID)) doit refléter la réalité — absent tant que
  // open()/openForSession() n'a pas vraiment monté le shell, sans quoi
  // ces deux fonctions prendraient à tort leur branche "déjà ouvert" et
  // ne calculeraient jamais le badge au montage.
  const domElements = {
    'hospital-content': contentEl,
    'hospital-topbar-title': titleEl,
    'hd-msg-badge': badgeEl,
  };

  const getUnreadCalls = [];
  const win = {
    HospitalBedsModule: { render(){} }, HospitalLabModule: { render(){} },
    MedicalAIModule: { render(){} }, HospitalSubscriptionModule: { render(){} },
    HospitalReceptionModule: { render(){} }, HospitalEmergencyModule: { render(){} },
    HospitalMaternityModule: { render(){} }, MedicalRecordDesktop: { render(){} },
    HospitalPortal: { renderConsultations(){}, renderPrescriptions(){}, openDetail(){}, openNewPatient(){} },
    Settings: { render(){} },
    PharmacyPortal: { renderInto(){} },
    HospitalMessagesModule: { render(){} },
    HospitalsRegistry: {
      getCurrentHospital: () => ({ establishmentId: 'EST1', name: 'Hôpital Test', staff: [] }),
      getHospitalById: () => ({ establishmentId: 'EST1', name: 'Hôpital Test', staff: [] }),
    },
    CloudDB: { getActiveHospital: async () => ({ establishmentId: 'EST1' }), listByHospital: async () => [] },
    ExchangeBridge: { getSubscriptionStatus: async () => ({ status: 'active' }) },
    DB: { getPatients: () => [], outboxCount: () => 0 },
    App: { toast(){} },
    Auth: { getUser: () => currentUser },
    Network: { getUnread: (r) => { getUnreadCalls.push(r); return unreadCount; } },
    addEventListener(){}, setInterval: () => 0,
  };
  win.window = win;

  const doc = {
    getElementById: (id) => domElements[id] || null,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    // appendChild enregistre l'élément monté sous son id — reproduit
    // l'effet observable réel (isOpen()/getElementById(ROOT_ID) le
    // retrouvent après open()/openForSession(), pas avant).
    body: { appendChild: (el) => { if (el?.id) domElements[el.id] = el; }, classList: { add(){}, remove(){} } },
    addEventListener(){},
  };

  const sandbox = {
    window: win,
    document: doc,
    console, setTimeout: (fn) => 0, setInterval: () => 0, clearInterval(){},
    HospitalBedsModule: win.HospitalBedsModule, HospitalLabModule: win.HospitalLabModule,
    MedicalAIModule: win.MedicalAIModule, HospitalSubscriptionModule: win.HospitalSubscriptionModule,
    HospitalReceptionModule: win.HospitalReceptionModule, HospitalEmergencyModule: win.HospitalEmergencyModule,
    HospitalMaternityModule: win.HospitalMaternityModule, HospitalPortal: win.HospitalPortal,
    Settings: win.Settings, PharmacyPortal: win.PharmacyPortal, HospitalMessagesModule: win.HospitalMessagesModule,
    HospitalsRegistry: win.HospitalsRegistry, CloudDB: win.CloudDB, ExchangeBridge: win.ExchangeBridge,
    DB: win.DB, App: win.App, Auth: win.Auth, Network: win.Network,
  };
  vm.createContext(sandbox);
  for (const f of ['js/hospital-permissions.js', 'js/hospital-capabilities.js', 'js/hospital-desktop-ui.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  sandbox.window.HospitalAuth = { getSession: () => ({ role }) };
  return { win: sandbox.window, doc, badgeEl, getUnreadCalls };
}

test('refreshMessagesBadge() affiche le compte et le style visible quand il y a des messages non lus', () => {
  const { win, badgeEl, getUnreadCalls } = setup({ unreadCount: 3, currentUser: { uid: 'u1', role: 'doctor' } });
  win.HospitalDesktopUI.refreshMessagesBadge();
  assert.strictEqual(badgeEl.textContent, '3');
  assert.strictEqual(badgeEl.style.display, 'inline-block');
  assert.deepStrictEqual(getUnreadCalls, ['doctor']);
});

test('refreshMessagesBadge() masque le badge (jamais un zéro visible) quand il n\'y a aucun message non lu', () => {
  const { win, badgeEl } = setup({ unreadCount: 0 });
  win.HospitalDesktopUI.refreshMessagesBadge();
  assert.strictEqual(badgeEl.textContent, '');
  assert.strictEqual(badgeEl.style.display, 'none');
});

test('refreshMessagesBadge() plafonne l\'affichage à "99+" au-delà de 99 non lus', () => {
  const { win, badgeEl } = setup({ unreadCount: 140 });
  win.HospitalDesktopUI.refreshMessagesBadge();
  assert.strictEqual(badgeEl.textContent, '99+');
  assert.strictEqual(badgeEl.style.display, 'inline-block');
});

test('open() calcule immédiatement le badge au montage du shell (pas seulement après une action ultérieure)', () => {
  const { win, badgeEl } = setup({ role: 'doctor', unreadCount: 2, currentUser: { uid: 'u1', role: 'doctor' } });
  win.HospitalAuth = { getSession: () => null }; // open() (pas openForSession()) : pas de session hôpital
  win.HospitalDesktopUI.open();
  assert.strictEqual(badgeEl.textContent, '2');
  assert.strictEqual(badgeEl.style.display, 'inline-block');
});

test('openForSession() calcule immédiatement le badge au montage du shell', async () => {
  const { win, badgeEl } = setup({ role: 'reception', unreadCount: 5, currentUser: { uid: 'agent-1', role: 'reception' } });
  win.HospitalAuth = {
    getSession: () => ({ role: 'reception' }),
    isSessionConsistent: async () => true,
  };
  await win.HospitalDesktopUI.openForSession({ establishmentId: 'EST1', role: 'reception', agentUid: 'agent-1' });
  assert.strictEqual(badgeEl.textContent, '5');
  assert.strictEqual(badgeEl.style.display, 'inline-block');
});

test('refreshMessagesBadge() ne lève jamais si le badge n\'est pas dans le DOM (shell fermé)', () => {
  const { win, doc } = setup({ unreadCount: 4 });
  doc.getElementById = () => null;
  assert.doesNotThrow(() => win.HospitalDesktopUI.refreshMessagesBadge());
});
