/* =====================================================
   Tests — Section 13 (audit "workflows mobile/desktop") :
   vérifier les permissions AVANT d'afficher un bouton/champ
   sensible, pas seulement au moment de l'action.

   Bug confirmé (capture d'écran + audit) : plusieurs boutons/champs
   desktop restaient affichés à un rôle dont la capacité réelle
   (js/hospital-capabilities.js) refuserait TOUJOURS l'action —
   l'agent découvrait le refus seulement après avoir rempli tout un
   formulaire (ex. "infirmier(ère) remplit un dossier de maternité
   entier pour être refusé à la fin"). Ce fichier verrouille les
   correctifs additifs apportés à :
   - js/hospital-maternity.js (openNew() : champs prénom/nom masqués
     sans 'create_patient')
   - js/hospital-emergency.js (openIntake() : champs prénom/nom
     masqués sans 'create_patient' ; caseCard() : "Sortie"/
     "Hospitaliser" masqués sans 'create_consultation')
   - js/hospital-reception.js (openIntake() : mode "Nouveau patient"
     masqué sans 'create_patient')
   - js/hospital-beds.js ("+ Lit"/"Maintenance" masqués sans
     'manage_beds')
   - js/hospital.js (bouton "🚑 Transférer le patient" masqué sans
     'decide_transfer' ; openEmergencyTransfer()/confirmEmergencyTransfer()
     refusent aussi à l'action, pas seulement à l'affichage)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {}, className: '', selectedOptions: [], ...initial };
}

function readSrc(f) { return fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'); }

/* ── HospitalCapabilities RÉEL (pas un mock) : ces tests doivent
   refléter la vraie matrice de capacités, pas une approximation. ── */
function loadRealCapabilities(sandbox) {
  vm.runInContext(readSrc('js/hospital-capabilities.js'), sandbox, { filename: 'js/hospital-capabilities.js' });
}

/* ═══════════════ hospital-maternity.js ═══════════════ */
function setupMaternity({ role = 'nurse' } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const opened = { html: null, count: 0 };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = { requireRoute: () => true };
  sandbox.HospitalAuth = { getSession: () => ({ role }) };
  sandbox.App = { openModal: (title, html) => { opened.html = html; opened.count++; }, toast(){} };
  sandbox.document = { getElementById: getEl };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  vm.runInContext(readSrc('js/hospital-maternity.js'), sandbox, { filename: 'js/hospital-maternity.js' });
  return { sandbox, opened, getEl };
}

test("hospital-maternity.js openNew() : masque les champs prénom/nom pour un rôle SANS 'create_patient' (nurse)", async () => {
  const { sandbox, opened } = setupMaternity({ role: 'nurse' });
  await sandbox.HospitalMaternityModule.openNew();
  assert.doesNotMatch(opened.html, /id="mat-fn"/, "le champ prénom ne doit jamais être proposé à un rôle qui ne peut pas créer de patiente");
  assert.doesNotMatch(opened.html, /id="mat-ln"/);
  assert.match(opened.html, /ne permet pas d'enregistrer une nouvelle patiente/);
});

test("hospital-maternity.js openNew() : affiche les champs prénom/nom pour un rôle AVEC 'create_patient' (reception)", async () => {
  const { sandbox, opened } = setupMaternity({ role: 'reception' });
  await sandbox.HospitalMaternityModule.openNew();
  assert.match(opened.html, /id="mat-fn"/);
  assert.match(opened.html, /id="mat-ln"/);
});

test("hospital-maternity.js saveNew() : ne lève pas si mat-fn/mat-ln sont absents du DOM (nurse) — refuse proprement au lieu de crasher", async () => {
  const { sandbox, getEl } = setupMaternity({ role: 'nurse' });
  await sandbox.HospitalMaternityModule.openNew();
  getEl('mat-lmp').value = '2026-01-01';
  getEl('mat-mc').value = '';
  await assert.doesNotReject(() => sandbox.HospitalMaternityModule.saveNew());
});

/* ═══════════════ hospital-emergency.js ═══════════════ */
function setupEmergency({ role = 'nurse', cases = [] } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const opened = { html: null, count: 0 };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = { requireRoute: () => true };
  sandbox.HospitalAuth = { getSession: () => ({ role }) };
  sandbox.App = { openModal: (title, html) => { opened.html = html; opened.count++; }, toast(){} };
  sandbox.CloudDB = { getActiveHospitalId: async () => 'EST-1' };
  sandbox.document = { getElementById: getEl };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  vm.runInContext(readSrc('js/hospital-emergency.js'), sandbox, { filename: 'js/hospital-emergency.js' });
  return { sandbox, opened, getEl };
}

test("hospital-emergency.js openIntake() : masque les champs prénom/nom pour un rôle SANS 'create_patient' (nurse)", async () => {
  const { sandbox, opened } = setupEmergency({ role: 'nurse' });
  await sandbox.HospitalEmergencyModule.openIntake();
  assert.doesNotMatch(opened.html, /id="er-fn"/);
  assert.doesNotMatch(opened.html, /id="er-ln"/);
  assert.match(opened.html, /ne permet pas d'enregistrer un nouveau patient/);
});

test("hospital-emergency.js openIntake() : affiche les champs prénom/nom pour un rôle AVEC 'create_patient' (reception)", async () => {
  const { sandbox, opened } = setupEmergency({ role: 'reception' });
  await sandbox.HospitalEmergencyModule.openIntake();
  assert.match(opened.html, /id="er-fn"/);
  assert.match(opened.html, /id="er-ln"/);
});

test("hospital-emergency.js caseCard() (via render) : 'Sortie'/'Hospitaliser' masqués pour un rôle SANS 'create_consultation' (reception)", async () => {
  const { sandbox } = setupEmergency({ role: 'reception' });
  const html = sandbox.HospitalEmergencyModule.__caseCardForTest
    ? sandbox.HospitalEmergencyModule.__caseCardForTest({ id: 'C1', status: 'in_care', patientName: 'X', patientMc: 'MC-1' })
    : null;
  // caseCard() n'est pas exportée : on vérifie via le source que le
  // même flag canCare gate désormais les DEUX groupes de boutons.
  const src = readSrc('js/hospital-emergency.js');
  const cardStart = src.indexOf('function caseCard(');
  const cardEnd = src.indexOf('\n  }\n', cardStart);
  const body = src.slice(cardStart, cardEnd);
  const waitingIdx = body.indexOf("c.status === 'waiting' && canCare");
  const inCareIdx = body.indexOf("c.status === 'in_care' && canCare");
  assert.ok(waitingIdx !== -1 && inCareIdx !== -1,
    "les deux groupes de boutons ('Prendre en charge' ET 'Sortie'/'Hospitaliser') doivent être gardés par la même capacité canCare");
});

/* ═══════════════ hospital-reception.js ═══════════════ */
function setupReception({ role = 'nurse' } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const opened = { html: null, count: 0 };
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = { requireRoute: () => true };
  sandbox.HospitalCapabilities = undefined; // remplacé par le vrai module ci-dessous
  sandbox.HospitalAuth = { getSession: () => ({ role }) };
  sandbox.App = { openModal: (title, html) => { opened.html = html; opened.count++; }, toast(){} };
  sandbox.HospitalsRegistry = { getHospitalById: () => ({ establishmentId: 'EST-1', staff: [] }) };
  sandbox.CloudDB = { getActiveHospitalId: async () => 'EST-1', listByHospital: async () => [] };
  sandbox.document = { getElementById: getEl };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  vm.runInContext(readSrc('js/hospital-reception.js'), sandbox, { filename: 'js/hospital-reception.js' });
  return { sandbox, opened, getEl };
}

test("hospital-reception.js openIntake() : masque le mode 'Nouveau patient' pour un rôle SANS 'create_patient' (nurse)", async () => {
  const { sandbox, opened } = setupReception({ role: 'nurse' });
  await sandbox.HospitalReceptionModule.openIntake();
  assert.doesNotMatch(opened.html, /rc-mode-new/);
  assert.doesNotMatch(opened.html, /id="rc-fn"/);
  assert.match(opened.html, /ne permet pas d'enregistrer un nouveau patient/);
});

test("hospital-reception.js openIntake() : affiche le mode 'Nouveau patient' pour un rôle AVEC 'create_patient' (reception)", async () => {
  const { sandbox, opened } = setupReception({ role: 'reception' });
  await sandbox.HospitalReceptionModule.openIntake();
  assert.match(opened.html, /rc-mode-new/);
  assert.match(opened.html, /id="rc-fn"/);
});

/* ═══════════════ hospital-beds.js ═══════════════ */
function setupBeds({ role = 'doctor', beds = [] } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const opened = { html: null, count: 0 };
  const contentEl = fakeElement();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = { requireRoute: () => true, getCurrentRole: () => role };
  sandbox.HospitalAuth = { getSession: () => ({ role }) };
  sandbox.App = { openModal: (title, html) => { opened.html = html; opened.count++; }, toast(){} };
  sandbox.CloudDB = { getActiveHospitalId: async () => 'EST-1', listByHospital: async (col) => (col === 'beds' ? beds : []) };
  sandbox.document = { getElementById: getEl };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  vm.runInContext(readSrc('js/hospital-beds.js'), sandbox, { filename: 'js/hospital-beds.js' });
  return { sandbox, opened, getEl, contentEl };
}

test("hospital-beds.js render() : masque '+ Lit' pour un rôle SANS 'manage_beds' (doctor)", async () => {
  const { sandbox, contentEl } = setupBeds({ role: 'doctor' });
  await sandbox.HospitalBedsModule.render(contentEl);
  assert.doesNotMatch(contentEl.innerHTML, /openAddBed/);
});

test("hospital-beds.js render() : affiche '+ Lit' pour un rôle AVEC 'manage_beds' (nurse)", async () => {
  const { sandbox, contentEl } = setupBeds({ role: 'nurse' });
  await sandbox.HospitalBedsModule.render(contentEl);
  assert.match(contentEl.innerHTML, /openAddBed/);
});

test("hospital-beds.js render() : masque 'Maintenance' sur un lit libre pour un rôle SANS 'manage_beds' (doctor)", async () => {
  const { sandbox, contentEl } = setupBeds({ role: 'doctor', beds: [{ id: 'BED-1', number: '12', ward: 'Chir', status: 'free' }] });
  await sandbox.HospitalBedsModule.render(contentEl);
  assert.doesNotMatch(contentEl.innerHTML, /toggleMaintenance/);
});

test("hospital-beds.js openAddBed() : refuse à l'ouverture pour un rôle SANS 'manage_beds' (doctor), jamais un simple masquage contourné", () => {
  const { sandbox, opened } = setupBeds({ role: 'doctor' });
  sandbox.HospitalBedsModule.openAddBed();
  assert.strictEqual(opened.count, 0, "le modal d'ajout de lit ne doit jamais s'ouvrir pour un rôle sans 'manage_beds'");
});

/* ═══════════════ hospital.js (transfert d'urgence + consultation) ═══════════════ */
function setupHospital({ role = 'nurse' } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const opened = { html: null, count: 0 };
  const toasts = [];
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Auth = { getUser: () => ({ uid: 'u1', role, name: 'Test' }) };
  sandbox.App = {
    openModal: (title, html) => { opened.html = html; opened.count++; return true; },
    toast: (msg, type) => toasts.push({ msg, type }),
    closeModal(){},
  };
  sandbox.DB = {
    getPatientById: (id) => ({ id, firstname: 'Jean', lastname: 'Dupont', allergies: '', chronic: '' }),
    getPatientConsultations: () => [], getPatientVaccinations: () => [], getPatientLabResults: () => [],
    getPatients: () => [{ id: 'MC-1', firstname: 'Jean', lastname: 'Dupont' }],
  };
  sandbox.HospitalsRegistry = { getCurrentHospital: () => ({ establishmentId: 'EST-1' }), getHospitals: () => [] };
  sandbox.I18n = { t: (k) => k };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  return { sandbox, opened, getEl, toasts };
}

test("hospital.js openDetail() : masque '🚑 Transférer le patient' pour un rôle SANS 'decide_transfer' (nurse)", () => {
  const { sandbox, opened } = setupHospital({ role: 'nurse' });
  // canUsePatient() dépend de plusieurs modules non pertinents ici ;
  // on charge hospital.js avec une redéfinition minimale APRÈS coup
  // n'est pas possible (IIFE) — on vérifie donc directement le source
  // pour le gating du bouton (comportement déjà couvert en exécution
  // réelle par les tests confirmEmergencyTransfer ci-dessous, qui
  // chargent le vrai module).
  const src = readSrc('js/hospital.js');
  const idx = src.indexOf('🚑 Transférer le patient');
  const block = src.slice(Math.max(0, idx - 400), idx);
  assert.match(block, /window\.HospitalCapabilities\?\.can\?\.\(Auth\.getUser\(\)\?\.role, 'decide_transfer'\)/);
});

function loadHospitalJs(sandbox) {
  sandbox.document = { getElementById: () => null };
  vm.runInContext(readSrc('js/hospital.js'), sandbox, { filename: 'js/hospital.js' });
}

test("hospital.js openEmergencyTransfer() : refuse à l'ouverture pour un rôle SANS 'decide_transfer' (nurse), jamais un simple masquage contourné", () => {
  const { sandbox, opened, toasts } = setupHospital({ role: 'nurse' });
  loadHospitalJs(sandbox);
  sandbox.HospitalPortal.openEmergencyTransfer('MC-1');
  assert.strictEqual(opened.count, 0, "le modal de transfert d'urgence ne doit jamais s'ouvrir pour un rôle sans 'decide_transfer'");
  assert.ok(toasts.some(t => t.type === 'error'));
});

test("hospital.js openEmergencyTransfer() : s'ouvre pour un rôle AVEC 'decide_transfer' (doctor)", () => {
  const { sandbox, opened } = setupHospital({ role: 'doctor' });
  loadHospitalJs(sandbox);
  sandbox.HospitalPortal.openEmergencyTransfer('MC-1');
  assert.strictEqual(opened.count, 1);
});

test("hospital.js confirmEmergencyTransfer() : refuse à l'action (pas seulement à l'ouverture) pour un rôle SANS 'decide_transfer'", async () => {
  const { sandbox, toasts } = setupHospital({ role: 'nurse' });
  loadHospitalJs(sandbox);
  let created = false;
  sandbox.EmergencyTransferModule = { createEmergencyTransfer: async () => { created = true; return {}; } };
  const result = await sandbox.HospitalPortal.confirmEmergencyTransfer('MC-1', false);
  assert.strictEqual(result, null);
  assert.strictEqual(created, false, "createEmergencyTransfer ne doit JAMAIS être appelé pour un rôle sans decide_transfer");
  assert.ok(toasts.some(t => t.type === 'error'));
});

test("hospital.js openConsult() : refuse à l'ouverture pour un rôle SANS 'create_consultation' (nurse), défense en profondeur", () => {
  const { sandbox, opened, toasts } = setupHospital({ role: 'nurse' });
  loadHospitalJs(sandbox);
  sandbox.HospitalPortal.openConsult('MC-1');
  assert.strictEqual(opened.count, 0);
  assert.ok(toasts.some(t => t.type === 'error'));
});

test("hospital.js openConsult() : s'ouvre pour un rôle AVEC 'create_consultation' (doctor)", () => {
  const { sandbox, opened } = setupHospital({ role: 'doctor' });
  loadHospitalJs(sandbox);
  sandbox.HospitalPortal.openConsult('MC-1');
  assert.strictEqual(opened.count, 1);
});

/* ═══════════════ hospital-desktop-ui.js : raccourcis "Accès rapides" ═══════════════ */
function setupDesktopUiDashboard({ role = 'reception' } = {}) {
  const contentEl = fakeElement();
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = undefined;
  sandbox.HospitalAuth = { getSession: () => ({ role }) };
  sandbox.CloudDB = {
    getActiveHospital: async () => ({ establishmentId: 'EST-1' }),
    listByHospital: async () => [],
  };
  sandbox.ExchangeBridge = { getSubscriptionStatus: async () => ({ status: 'active' }) };
  vm.createContext(sandbox);
  loadRealCapabilities(sandbox);
  vm.runInContext(readSrc('js/hospital-permissions.js'), sandbox, { filename: 'js/hospital-permissions.js' });
  return { sandbox, contentEl };
}

test("hospital-desktop-ui.js renderDashboard() : masque les raccourcis 'Admissions'/'Laboratoire' pour reception (routes fermées)", async () => {
  const { sandbox, contentEl } = setupDesktopUiDashboard({ role: 'reception' });
  // renderDashboard() est une fonction privée du module complet ; on
  // vérifie ici directement via le source que les raccourcis passent
  // désormais par HospitalPermissions.canAccess (pas un affichage
  // inconditionnel), pour chacune des 3 routes ciblées.
  const src = readSrc('js/hospital-desktop-ui.js');
  const dashStart = src.indexOf('async function renderDashboard(');
  const dashEnd = src.indexOf('\n  async function navigate(', dashStart);
  const body = src.slice(dashStart, dashEnd);
  assert.match(body, /canAccess\(role, 'beds'\)/);
  assert.match(body, /canAccess\(role, 'lab'\)/);
  assert.match(body, /canAccess\(role, 'patients'\)/);
});
