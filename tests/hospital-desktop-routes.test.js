/* =====================================================
   Tests — Routes du shell desktop & compatibilité conteneurs
   (chantier fix/desktop-session-routing-packaging)

   Couvre les points ROUTES 8-16 et CONTAINERS 17-19 de l'audit :
   8.  Chaque entrée de HospitalPermissions.visibleMenuFor(role) possède
       un renderer desktop utilisable (NATIVE_ROUTES).
   9-13. Paramètres/Consultations/Ordonnances/Médecins affiliés/Pharmacie
       s'affichent dans #hospital-content (container reçu, pas
       document.getElementById('main-content')).
   14. Le shell desktop ne disparaît pas pendant ces navigations (pas de
       close() en dehors du cas APP_SECTIONS, vide par défaut désormais).
   15. Une route inconnue affiche une erreur visible au lieu d'échouer
       silencieusement, en gardant le shell visible.
   16. Les contrôles de capacités (HospitalCapabilities.can) restent
       actifs — la rédaction d'ordonnance reste réservée au médecin.
   17-19. Settings/PharmacyPortal fonctionnent avec n'importe quel
       container (desktop #hospital-content OU mobile #main-content),
       sans dépendre d'un id figé.
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

/* Sandbox chargeant le VRAI hospital-desktop-ui.js + hospital-permissions.js
   + hospital-capabilities.js, avec les modules "feuilles" (HospitalPortal,
   Settings, PharmacyPortal, HospitalBedsModule...) simulés par de simples
   marqueurs — l'objectif est de vérifier le ROUTAGE, pas de retester le
   contenu de chaque module (déjà couvert par leurs propres tests). */
function setup({ role = 'doctor', hospitalStaff = [] } = {}) {
  const rootEl = fakeElement();
  const contentEl = fakeElement();
  const titleEl = fakeElement();
  const domElements = {
    'hospital-desktop-root': rootEl,
    'hospital-content': contentEl,
    'hospital-topbar-title': titleEl,
  };

  const renderCalls = [];
  function makeLeaf(name) {
    return { render: (c) => { renderCalls.push({ name, container: c }); if (c) c.innerHTML = `${name}_OK`; } };
  }
  function makeLeafInto(name) {
    return { renderInto: (c, section) => { renderCalls.push({ name, container: c, section }); if (c) c.innerHTML = `${name}_OK:${section}`; } };
  }

  const win = {
    HospitalPermissions: undefined, // chargé réellement ci-dessous
    HospitalCapabilities: undefined, // chargé réellement ci-dessous
    HospitalBedsModule: makeLeaf('beds'),
    HospitalLabModule: makeLeaf('lab'),
    MedicalAIModule: makeLeaf('ai'),
    HospitalSubscriptionModule: makeLeaf('subscription'),
    HospitalReceptionModule: makeLeaf('reception'),
    HospitalEmergencyModule: makeLeaf('emergency'),
    HospitalMaternityModule: makeLeaf('maternity'),
    MedicalRecordDesktop: makeLeaf('records'),
    HospitalPortal: {
      renderConsultations: (c) => { renderCalls.push({ name: 'consultations', container: c }); c.innerHTML = 'consultations_OK'; },
      renderPrescriptions: (c) => { renderCalls.push({ name: 'prescriptions', container: c }); c.innerHTML = 'prescriptions_OK'; },
      openDetail: () => {},
      openNewPatient: () => { renderCalls.push({ name: 'openNewPatient' }); },
    },
    Settings: { render: (c) => { renderCalls.push({ name: 'settings', container: c }); c.innerHTML = 'settings_OK'; } },
    PharmacyPortal: makeLeafInto('pharmacy'),
    HospitalsRegistry: {
      getCurrentHospital: () => ({ establishmentId: 'EST1', name: 'Hôpital Test', staff: hospitalStaff }),
      getHospitalById: () => ({ establishmentId: 'EST1', name: 'Hôpital Test', staff: hospitalStaff }),
      getPatientsForEstablishment: () => [],
      getPendingAffiliations: () => [],
    },
    CloudDB: {
      getActiveHospital: async () => ({ establishmentId: 'EST1', name: 'Hôpital Test', staff: hospitalStaff }),
      listByHospital: async () => [],
    },
    ExchangeBridge: { getSubscriptionStatus: async () => ({ status: 'active' }) },
    DB: { getPatients: () => [] },
    App: { toast(){} },
    addEventListener(){}, setInterval: () => 0,
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: {
      getElementById: (id) => domElements[id] || null,
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
      body: { appendChild(){}, classList: { add(){}, remove(){} } },
      addEventListener(){},
    },
    console, setTimeout: (fn) => 0, setInterval: () => 0, clearInterval(){},
    // Plusieurs fonctions du module référencent ces modules en globales
    // NUES (ex. "CloudDB.getActiveHospital()", pas "window.CloudDB...") —
    // comme dans un vrai navigateur où window EST le global. Il faut donc
    // les exposer aussi au niveau racine du sandbox, pas seulement sur window.
    HospitalBedsModule: win.HospitalBedsModule,
    HospitalLabModule: win.HospitalLabModule,
    MedicalAIModule: win.MedicalAIModule,
    HospitalSubscriptionModule: win.HospitalSubscriptionModule,
    HospitalReceptionModule: win.HospitalReceptionModule,
    HospitalEmergencyModule: win.HospitalEmergencyModule,
    HospitalMaternityModule: win.HospitalMaternityModule,
    HospitalPortal: win.HospitalPortal,
    Settings: win.Settings,
    PharmacyPortal: win.PharmacyPortal,
    HospitalsRegistry: win.HospitalsRegistry,
    CloudDB: win.CloudDB,
    ExchangeBridge: win.ExchangeBridge,
    DB: win.DB,
    App: win.App,
  };
  vm.createContext(sandbox);
  for (const f of ['js/hospital-permissions.js', 'js/hospital-capabilities.js', 'js/hospital-desktop-ui.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  // getCurrentRole() lit HospitalAuth.getSession() en priorité, sinon
  // Auth.getUser().role — on simule directement une session hôpital.
  sandbox.window.HospitalAuth = { getSession: () => ({ role }) };
  return { win: sandbox.window, contentEl, renderCalls };
}

const DESKTOP_ROLES = ['admin_hospital', 'doctor', 'nurse', 'pharmacist', 'lab', 'reception'];

/* ── 8. Chaque entrée de menu, pour chaque rôle, a un renderer ───── */
test('pour chaque rôle desktop, chaque entrée de HospitalPermissions.visibleMenuFor() est navigable sans route manquante', async () => {
  for (const role of DESKTOP_ROLES) {
    const { win, contentEl } = setup({ role });
    const menu = win.HospitalPermissions.visibleMenuFor(role);
    assert.ok(menu.length > 0, `le rôle ${role} doit avoir au moins une entrée de menu`);
    for (const entry of menu) {
      await win.HospitalDesktopUI.navigate(entry.key);
      assert.doesNotMatch(
        contentEl.innerHTML, /Section .* indisponible/,
        `route "${entry.key}" (rôle ${role}) ne doit pas afficher "indisponible" — un renderer natif doit exister`
      );
    }
  }
});

/* ── 9-13. Paramètres/Consultations/Ordonnances/Médecins affiliés/
   Pharmacie s'affichent dans le container reçu (#hospital-content). ── */
for (const [route, expectSubstr] of [
  ['settings', 'settings_OK'],
  ['consultations', 'consultations_OK'],
  ['prescriptions', 'prescriptions_OK'],
  ['doctors', 'Médecins affiliés'],
  ['pharmacy', 'pharmacy_OK'],
]) {
  test(`la route "${route}" est rendue nativement dans #hospital-content`, async () => {
    const { win, contentEl } = setup({ role: 'admin_hospital' });
    await win.HospitalDesktopUI.navigate(route);
    assert.match(contentEl.innerHTML, new RegExp(expectSubstr), `#hospital-content devrait contenir "${expectSubstr}" après navigate('${route}')`);
  });
}

/* ── 14. Le shell reste ouvert (isOpen() vrai) après ces navigations ── */
test('le shell desktop reste ouvert (isOpen()) après navigation vers settings/consultations/prescriptions/doctors/pharmacy', async () => {
  const { win } = setup({ role: 'admin_hospital' });
  for (const route of ['settings', 'consultations', 'prescriptions', 'doctors', 'pharmacy']) {
    await win.HospitalDesktopUI.navigate(route);
    assert.strictEqual(win.HospitalDesktopUI.isOpen(), true, `le shell doit rester ouvert après navigate('${route}')`);
  }
});

/* ── 15. Route inconnue : erreur visible, shell toujours visible ─── */
test('une route inconnue affiche une erreur visible dans #hospital-content au lieu d\'échouer silencieusement', async () => {
  const { win, contentEl } = setup({ role: 'admin_hospital' });
  contentEl.innerHTML = 'CONTENU_PRECEDENT';
  await win.HospitalDesktopUI.navigate('route_qui_nexiste_pas');
  assert.match(contentEl.innerHTML, /indisponible/i);
  assert.strictEqual(win.HospitalDesktopUI.isOpen(), true, 'le shell doit rester visible même pour une route inconnue');
});

/* ── 16. Le pharmacien voit le menu Ordonnances mais ne reçoit jamais
   la capacité de prescrire (réservée au médecin). ────────────────── */
test('HospitalCapabilities : le pharmacien peut voir les ordonnances (menu) mais ne peut jamais prescrire', () => {
  const { win } = setup({ role: 'pharmacist' });
  const menu = win.HospitalPermissions.visibleMenuFor('pharmacist');
  assert.ok(menu.some(m => m.key === 'prescriptions'), 'le pharmacien doit voir le menu Ordonnances');
  assert.strictEqual(win.HospitalCapabilities.can('pharmacist', 'prescribe'), false, 'le pharmacien ne doit jamais avoir la capacité prescribe');
  assert.strictEqual(win.HospitalCapabilities.can('doctor', 'prescribe'), true, 'le médecin doit conserver la capacité prescribe');
});

test('HospitalPermissions : le menu Ordonnances est visible pour admin/admin_hospital/doctor/nurse/pharmacist, pas pour lab/reception', () => {
  const { win } = setup();
  const allowed = ['admin', 'admin_hospital', 'doctor', 'nurse', 'pharmacist'];
  const denied = ['lab', 'reception'];
  for (const role of allowed) {
    assert.ok(win.HospitalPermissions.visibleMenuFor(role).some(m => m.key === 'prescriptions'), `${role} devrait voir Ordonnances`);
  }
  for (const role of denied) {
    assert.ok(!win.HospitalPermissions.visibleMenuFor(role).some(m => m.key === 'prescriptions'), `${role} ne devrait pas voir Ordonnances`);
  }
});

/* ── Écran "Médecins affiliés" : personnel de l'établissement ACTIF
   uniquement, jamais le registre global de tous les établissements. ── */
test('la route "doctors" affiche le personnel de l\'établissement actif, pas un registre global', async () => {
  const { win, contentEl } = setup({
    role: 'admin_hospital',
    hospitalStaff: [{ uid: 'u1', name: 'Dr Alice', role: 'doctor', professionalNumber: 'DOC1', status: 'active' }],
  });
  await win.HospitalDesktopUI.navigate('doctors');
  assert.match(contentEl.innerHTML, /Dr Alice/);
  assert.match(contentEl.innerHTML, /Hôpital Test/);
});

test('la route "doctors" ne propose les actions de retrait/validation qu\'à admin/admin_hospital', async () => {
  const staff = [{ uid: 'u1', name: 'Dr Alice', role: 'doctor', professionalNumber: 'DOC1', status: 'active' }];
  const { win: winDoctor, contentEl: contentDoctor } = setup({ role: 'doctor', hospitalStaff: staff });
  await winDoctor.HospitalDesktopUI.navigate('doctors');
  assert.doesNotMatch(contentDoctor.innerHTML, /Retirer l'affiliation/, 'un simple médecin ne doit pas voir les actions administratives');

  const { win: winAdmin, contentEl: contentAdmin } = setup({ role: 'admin_hospital', hospitalStaff: staff });
  await winAdmin.HospitalDesktopUI.navigate('doctors');
  assert.match(contentAdmin.innerHTML, /Retirer l'affiliation/, 'admin_hospital doit voir les actions administratives');
});

/* ── Correctif (audit "workflows mobile/desktop", section 3) ───────
   Bug confirmé : la route "patients" (Patients — dossiers par année)
   n'affichait AUCUN bouton "Nouveau patient", alors que
   HospitalPortal.openNewPatient()/saveNewPatient() existent déjà et
   que le rôle doctor/admin_hospital possède bien la capacité
   create_patient. Corrigé en ajoutant le bouton, gardé par
   HospitalCapabilities.can(role,'create_patient') — jamais affiché à
   un rôle qui ne peut pas créer de patient (ex. nurse, lab, sur cette
   route). */
test('la route "patients" affiche "+ Nouveau patient" pour un rôle avec la capacité create_patient (doctor, admin_hospital)', async () => {
  for (const role of ['doctor', 'admin_hospital']) {
    const { win, contentEl } = setup({ role });
    await win.HospitalDesktopUI.navigate('patients');
    assert.match(contentEl.innerHTML, /\+ Nouveau patient/, `le rôle ${role} doit voir le bouton Nouveau patient`);
    assert.match(contentEl.innerHTML, /HospitalPortal\.openNewPatient/, `le bouton doit appeler HospitalPortal.openNewPatient (rôle ${role})`);
  }
});

test('la route "patients" n\'affiche PAS "+ Nouveau patient" pour un rôle sans la capacité create_patient (nurse)', async () => {
  const { win, contentEl } = setup({ role: 'nurse' });
  await win.HospitalDesktopUI.navigate('patients');
  assert.doesNotMatch(contentEl.innerHTML, /\+ Nouveau patient/, "l'infirmier ne doit pas voir le bouton Nouveau patient sur cette route");
});

test('le tableau de bord (dashboard) propose aussi "+ Nouveau patient" en accès rapide pour un rôle avec create_patient', async () => {
  const { win, contentEl } = setup({ role: 'doctor' });
  await win.HospitalDesktopUI.navigate('dashboard');
  assert.match(contentEl.innerHTML, /\+ Nouveau patient/, 'le tableau de bord médecin doit proposer Nouveau patient en accès rapide');
});

test('le tableau de bord (dashboard) ne propose PAS "+ Nouveau patient" pour un rôle sans create_patient (lab)', async () => {
  const { win, contentEl } = setup({ role: 'lab' });
  await win.HospitalDesktopUI.navigate('dashboard');
  assert.doesNotMatch(contentEl.innerHTML, /\+ Nouveau patient/, 'le laborantin ne doit jamais voir Nouveau patient au tableau de bord');
});

/* ── 17-19. Settings/PharmacyPortal : compatibilité container ────── */
test('Settings.refresh() ré-affiche dans le DERNIER container utilisé (desktop #hospital-content OU mobile #main-content)', () => {
  const settingsCode = fs.readFileSync(path.resolve(__dirname, '..', 'js/settings.js'), 'utf8');
  const win = {
    Auth: { getUser: () => ({ role: 'doctor', name: 'Dr Test' }), getRoleIcon: () => '👨‍⚕️' },
    DB: { getSettings: () => ({}) },
    Currency: { current: () => 'USD', get: () => ({ symbol: '$', name: 'Dollar' }), renderSelector: () => '' },
    I18n: { renderSelector: () => '' },
    App: {},
  };
  win.window = win;
  const desktopContainer = { innerHTML: '' };
  const mobileContainer = { innerHTML: '' };
  const sandbox = {
    window: win,
    document: {
      body: {
        contains: (el) => el === desktopContainer || el === mobileContainer,
        classList: { contains: () => false },
      },
    },
    console,
    Auth: win.Auth, DB: win.DB, Currency: win.Currency, I18n: win.I18n, App: win.App,
  };
  vm.createContext(sandbox);
  vm.runInContext(settingsCode, sandbox, { filename: 'js/settings.js' });

  sandbox.window.Settings.render(desktopContainer);
  assert.match(desktopContainer.innerHTML, /Paramètres/);
  sandbox.window.Settings.refresh();
  assert.match(desktopContainer.innerHTML, /Paramètres/, 'refresh() doit re-render dans le container desktop mémorisé');

  sandbox.window.Settings.render(mobileContainer);
  sandbox.window.Settings.refresh();
  assert.match(mobileContainer.innerHTML, /Paramètres/, 'refresh() doit re-render dans le container mobile mémorisé après un second render()');
});

test('PharmacyPortal.renderInto(container, section) rend dans le container reçu, jamais dans un id figé', () => {
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/pharmacy.js'), 'utf8');
  const win = {
    I18n: { t: (k) => k },
    DB: { getStats: () => ({ totalSales: 0, todaySales: 0 }), getMedicines: () => [], getMessages: () => [] },
    App: { navigateTo(){} },
    // Correctif (audit sécurité) : renderInto() vérifie désormais
    // HospitalPermissions.requireRoute('pharmacy') au premier rendu —
    // ce test porte sur le container reçu, pas sur les permissions
    // (déjà couvertes ailleurs dans ce fichier), d'où ce stub minimal.
    HospitalPermissions: { requireRoute: () => true },
  };
  win.window = win;
  const container = { innerHTML: '' };
  const sandbox = {
    window: win, document: { body: { contains: (el) => el === container } }, console,
    I18n: win.I18n, DB: win.DB, App: win.App, HospitalPermissions: win.HospitalPermissions,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'js/pharmacy.js' });

  sandbox.window.PharmacyPortal.renderInto(container, 'dashboard');
  assert.notStrictEqual(container.innerHTML, '', 'renderInto doit écrire dans le container reçu');
});
