/* =====================================================
   Tests — refonte du formulaire Réception (audit "workflows
   mobile/desktop", section 4)

   Bug confirmé par test réel (capture d'écran) : le champ "Numéro MC
   du patient" acceptait n'importe quel texte (ex. "DK"), et la
   section "Nouveau patient (si non trouvé)" était repliée sous un
   <details>/<summary> peu visible — un agent tapant un identifiant
   invalide se heurtait à un message d'erreur final ("renseignez
   prénom et nom") sans jamais voir où saisir ces champs.

   Corrigé par un choix explicite et toujours visible (Patient
   existant / Nouveau patient), une validation immédiate du format
   MC-xxx, et une bascule automatique vers "Nouveau patient" quand la
   recherche ne trouve rien.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {}, className: '', selectedOptions: [], ...initial };
}

function makeFirestoreMock(seedData = {}) {
  const store = {};
  for (const [col, docs] of Object.entries(seedData)) store[col] = new Map(Object.entries(docs));
  function ensureCol(col) { if (!store[col]) store[col] = new Map(); return store[col]; }
  function collection(name) {
    const col = ensureCol(name);
    return {
      doc(id) {
        return {
          async get() { const d = col.get(String(id)); return { exists: !!d, data: () => d, id }; },
        };
      },
    };
  }
  return { collection };
}

function setup({ mcPatients = {} } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const toasts = [];
  const opened = { title: null, html: null, count: 0, closed: 0 };
  const created = [];

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  sandbox.HospitalPermissions = { requireRoute: () => true };
  sandbox.HospitalCapabilities = { guardHospitalAction: () => true };
  sandbox.App = {
    toast: (msg, type) => toasts.push({ msg, type }),
    openModal: (title, html) => { opened.title = title; opened.html = html; opened.count++; },
    closeModal: () => { opened.closed++; },
  };
  sandbox.HospitalDesktopUI = { navigate: () => {} };
  sandbox.HospitalsRegistry = { getHospitalById: () => ({ establishmentId: 'EST-1', staff: [] }) };
  sandbox.HospitalPortal = { currentEstablishmentFields: () => ({ establishmentId: 'EST-1' }) };
  sandbox.Auth = { getUser: () => ({ uid: 'user-1' }) };
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = makeFirestoreMock({ mc_patients: mcPatients });
  sandbox.DB = {
    getPatients: () => [],
    savePatients: () => {},
    makeId: (p) => `${p}-ID`,
    addPatientAndConfirmAtomic: async (input) => ({
      patient: { id: 'MC-2026-CD-NEWPAT', firstname: input.firstname, lastname: input.lastname },
      confirmed: true,
    }),
  };
  sandbox.CloudDB = {
    getActiveHospitalId: async () => 'EST-1',
    listByHospital: async () => [],
    requireWritableSubscription: async () => true,
    createDoc: async (col, data, id) => { created.push([col, id, data]); return { id, ...data }; },
    createNotification: async () => {},
    createAuditLog: async () => {},
  };
  sandbox.document = { getElementById: getEl, querySelector: () => null };

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-reception.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/hospital-reception.js' });
  return { sandbox, toasts, opened, getEl, created };
}

test('openIntake() affiche un choix explicite Patient existant / Nouveau patient, jamais un <details> replié', async () => {
  const { sandbox, opened } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  assert.match(opened.html, /🔎 Patient existant/);
  assert.match(opened.html, /🆕 Nouveau patient/);
  assert.doesNotMatch(opened.html, /<details/, "l'ancien <details>/<summary> replié ne doit plus exister");
});

test('openIntake() : le panneau "Nouveau patient" est masqué par défaut (mode existant actif)', async () => {
  const { sandbox, opened } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  const newPanelMatch = opened.html.match(/id="rc-panel-new"[^>]*style="([^"]*)"/);
  assert.ok(newPanelMatch, 'le panneau rc-panel-new doit exister');
  assert.match(newPanelMatch[1], /display:\s*none/);
});

test('openIntake() : le champ numéro MC est absent du panneau "Nouveau patient" (généré automatiquement)', async () => {
  const { sandbox, opened } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  const newPanelStart = opened.html.indexOf('id="rc-panel-new"');
  const newPanelEnd = opened.html.indexOf('</div>', opened.html.indexOf('id="rc-reason"'));
  const newPanelHtml = opened.html.slice(newPanelStart, newPanelStart + 800);
  assert.doesNotMatch(newPanelHtml, /rc-mc/, 'le panneau Nouveau patient ne doit jamais afficher le champ numéro MC');
});

test('setMode("new") bascule l\'affichage : panneau nouveau visible, panneau existant masqué', async () => {
  const { sandbox, getEl } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  sandbox.HospitalReceptionModule.setMode('new');
  assert.strictEqual(getEl('rc-panel-new').style.display, '');
  assert.strictEqual(getEl('rc-panel-existing').style.display, 'none');
  assert.match(getEl('rc-mode-new').className, /btn-primary/);
  assert.match(getEl('rc-mode-existing').className, /btn-ghost/);
});

test('setMode("existing") restaure le panneau existant', async () => {
  const { sandbox, getEl } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  sandbox.HospitalReceptionModule.setMode('new');
  sandbox.HospitalReceptionModule.setMode('existing');
  assert.strictEqual(getEl('rc-panel-existing').style.display, '');
  assert.strictEqual(getEl('rc-panel-new').style.display, 'none');
});

/* ── Validation immédiate du format MC-xxx (points 9-10) ────────── */

test('lookupPatient() : un texte qui n\'a pas la forme MC-xxx (ex. "DK") affiche un message de format clair, sans lancer de recherche', async () => {
  const { sandbox, getEl } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'DK';
  await sandbox.HospitalReceptionModule.lookupPatient();
  const box = getEl('rc-found');
  assert.match(box.innerHTML, /numéro patient MedConnect/);
  assert.match(box.innerHTML, /Nouveau patient/);
  assert.doesNotMatch(box.innerHTML, /Recherche en cours/);
});

test('lookupPatient() : un numéro MC bien formaté mais introuvable propose de créer un nouveau patient', async () => {
  const { sandbox, getEl } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'MC-2026-CD-ABSENT1';
  await sandbox.HospitalReceptionModule.lookupPatient();
  const box = getEl('rc-found');
  assert.match(box.innerHTML, /Patient introuvable/);
  assert.match(box.innerHTML, /Créer un nouveau patient/);
  assert.match(box.innerHTML, /setMode\('new'\)/);
});

test('lookupPatient() : un numéro MC trouvé affiche le nom en lecture seule', async () => {
  const { sandbox, getEl } = setup({
    mcPatients: { 'MC-2026-CD-FOUND1': { id: 'MC-2026-CD-FOUND1', firstname: 'Jean', lastname: 'Kalala' } },
  });
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'MC-2026-CD-FOUND1';
  await sandbox.HospitalReceptionModule.lookupPatient();
  assert.match(getEl('rc-found').innerHTML, /Jean/);
  assert.match(getEl('rc-found').innerHTML, /Kalala/);
});

/* ── saveIntake() : le mode explicite gouverne le comportement ───── */

test('saveIntake() en mode "existing" avec un texte invalide (ex. "DK") refuse clairement, sans créer de receptionVisit', async () => {
  const { sandbox, getEl, toasts, created } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'DK';
  await sandbox.HospitalReceptionModule.saveIntake();
  assert.ok(toasts.some(t => /numéro patient MedConnect valide/.test(t.msg)), 'un message de format clair doit être affiché');
  assert.strictEqual(created.length, 0, 'aucune visite ne doit être créée');
});

test('saveIntake() en mode "existing" avec un numéro MC introuvable refuse et ne crée rien', async () => {
  const { sandbox, getEl, toasts, created } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'MC-2026-CD-ABSENT2';
  await sandbox.HospitalReceptionModule.saveIntake();
  assert.ok(toasts.some(t => /introuvable/.test(t.msg)));
  assert.strictEqual(created.length, 0);
});

test('saveIntake() en mode "new" sans prénom/nom refuse et conserve les valeurs (modale non fermée)', async () => {
  const { sandbox, opened, toasts, created } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  sandbox.HospitalReceptionModule.setMode('new');
  await sandbox.HospitalReceptionModule.saveIntake();
  assert.ok(toasts.some(t => /Prénom et nom sont obligatoires/.test(t.msg)));
  assert.strictEqual(created.length, 0);
  assert.strictEqual(opened.closed, 0, 'la modale ne doit pas se fermer après une erreur');
});

test('saveIntake() en mode "new" avec prénom/nom crée la fiche puis la visite (parcours complet)', async () => {
  const { sandbox, getEl, opened, created } = setup();
  await sandbox.HospitalReceptionModule.openIntake();
  sandbox.HospitalReceptionModule.setMode('new');
  getEl('rc-fn').value = 'Marie';
  getEl('rc-ln').value = 'Tshisekedi';
  getEl('rc-reason').value = 'Consultation';
  getEl('rc-doctor').value = '';
  getEl('rc-bed').value = '';
  await sandbox.HospitalReceptionModule.saveIntake();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0][0], 'receptionVisits');
  assert.match(created[0][2].patientName, /Marie Tshisekedi/);
  assert.strictEqual(opened.closed, 1, 'la modale doit se fermer après confirmation');
});

test('saveIntake() en mode "existing" avec un patient trouvé crée directement la visite (aucune double création de fiche)', async () => {
  const { sandbox, getEl, created } = setup({
    mcPatients: { 'MC-2026-CD-EXIST1': { id: 'MC-2026-CD-EXIST1', firstname: 'Paul', lastname: 'Mukendi' } },
  });
  await sandbox.HospitalReceptionModule.openIntake();
  getEl('rc-mc').value = 'MC-2026-CD-EXIST1';
  getEl('rc-reason').value = 'Consultation';
  getEl('rc-doctor').value = '';
  getEl('rc-bed').value = '';
  await sandbox.HospitalReceptionModule.saveIntake();
  assert.strictEqual(created.length, 1, 'seule la visite doit être créée, pas une nouvelle fiche patient');
  assert.strictEqual(created[0][0], 'receptionVisits');
  assert.match(created[0][2].patientName, /Paul Mukendi/);
});
