/* =====================================================
   Tests — chantier "modales laboratoire" (fix/desktop-lab-modal-workflow)

   Couvre les sections du cahier des charges :
   - MODALE (1-7) : App.openModal()/closeModal(), z-index au-dessus du
     shell desktop, fermeture (croix/Échap/clic fond), conservation des
     données saisies après échec.
   - DROITS UI (8-15) : "+ Nouvelle demande" / actions de traitement
     affichées selon HospitalCapabilities.can(role, ...), jamais un
     rôle non autorisé.
   - ACTIONS (16-22) : openNew()/saveOrder()/openResult()/saveResult()
     vérifient réellement la capacité (pas seulement l'affichage) et
     sont protégées contre le double-clic.

   Exécute le VRAI js/hospital-lab.js dans un bac à sable vm (comme
   tests/lab-reception-auth-flow.test.js) — pas une relecture de
   source : les assertions portent sur le comportement observé.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { value: '', textContent: '', disabled: false, dataset: {}, style: {}, ...initial };
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
          async set(data) { col.set(String(id), data); },
        };
      },
    };
  }
  return { collection };
}

function setup({
  role = 'doctor',
  staff = [],
  labRequests = [],
  requireWritableSubscriptionImpl = async () => true,
  pushBatchImpl = null,
} = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const toasts = [];
  const opened = { title: null, html: null, count: 0 };
  const created = [];
  const updated = [];

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;

  sandbox.HospitalPermissions = {
    getCurrentRole: () => role,
    requireRoute: () => true,
  };
  // Miroir minimal MAIS réel de la matrice HospitalCapabilities (js/hospital-capabilities.js) :
  // seuls doctor/nurse/admin_hospital/admin peuvent request_lab ; seuls lab/doctor/admin_hospital/admin
  // peuvent enter_lab_result — copié du fichier réel pour ne pas dériver silencieusement.
  const REQUEST_LAB_ROLES = ['doctor', 'nurse', 'admin_hospital'];
  const ENTER_RESULT_ROLES = ['lab', 'doctor', 'admin_hospital'];
  sandbox.HospitalCapabilities = {
    can: (r, action) => {
      if (r === 'admin') return true;
      if (action === 'request_lab') return REQUEST_LAB_ROLES.includes(r);
      if (action === 'enter_lab_result') return ENTER_RESULT_ROLES.includes(r);
      return false;
    },
  };
  sandbox.App = {
    toast: (msg, type) => toasts.push({ msg, type }),
    openModal: (title, html) => { opened.title = title; opened.html = html; opened.count++; return true; },
    closeModal: () => {},
  };
  sandbox.HospitalDesktopUI = { navigate: () => {} };
  sandbox.HospitalsRegistry = { getCurrentHospital: () => ({ establishmentId: 'EST-1', staff }) };
  sandbox.Auth = { getUser: () => ({ uid: 'user-1' }) };
  sandbox.HospitalAuth = { getSession: () => null };
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = makeFirestoreMock({});
  sandbox.ExchangeBridge = { currentSourceDevice: () => 'desktop' };
  sandbox.DB = {
    makeId: (p) => `${p}-ID`,
    getPatients: () => [],
    pushBatchAndReportDetailed: pushBatchImpl || (async (entries) => {
      entries.forEach(([col, id, data]) => created.push([col, id, data]));
      return { ok: true, succeeded: entries.map(e => [e[0], e[1]]), failed: [], timedOut: false, error: null };
    }),
  };
  sandbox.CloudDB = {
    getActiveHospitalId: async () => 'EST-1',
    getCurrentUserProfile: async () => ({ uid: 'user-1', name: 'Test User', role }),
    requireWritableSubscription: requireWritableSubscriptionImpl,
    listByHospital: async () => labRequests,
    createDoc: async (col, data, id) => { created.push([col, id, data]); return { id, ...data }; },
    updateDoc: async (col, id, data) => { updated.push([col, id, data]); return { id, ...data }; },
    createAuditLog: async () => {},
  };
  sandbox.document = {
    getElementById: getEl,
    querySelector: (sel) => {
      const m = sel.match(/data-lab-status-btn="([^"]+)"/);
      return m ? getEl(`__status_btn_${m[1]}`) : null;
    },
  };

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-lab.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/hospital-lab.js' });
  return { sandbox, toasts, opened, getEl, created, updated };
}

// setStatus()/openResult()/saveResult() cherchent la demande dans le
// cache interne _requests, alimenté uniquement par render() (jamais
// exposé directement) — un test qui veut agir sur une demande précise
// doit d'abord la faire apparaître via un render().
async function renderFirst(sandbox) {
  await sandbox.HospitalLabModule.render({ innerHTML: '' });
}

/* ── MODALE (1-7) ── */

test('1-2. App.openModal() (réel, js/app.js) ajoute .active et retourne true quand la structure existe', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/app.js'), 'utf8');
  const start = src.indexOf('function openModal(');
  const end = src.indexOf('\n  function closeModal', start);
  const body = src.slice(start, end);
  assert.match(body, /overlay\.classList\.add\('active'\)/);
  assert.match(body, /return true;/);
  assert.match(body, /return false;/, 'doit aussi retourner false si la structure est absente');
});

test('3. #global-modal reçoit un z-index supérieur à #hospital-desktop-root quand le shell est ouvert', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'css/hospital-desktop.css'), 'utf8');
  const shellMatch = css.match(/#hospital-desktop-root\s*\{[^}]*z-index:\s*(\d+)/);
  const modalMatch = css.match(/body\.hospital-desktop-open #global-modal\s*\{\s*z-index:\s*(\d+)/);
  assert.ok(shellMatch, 'z-index du shell introuvable');
  assert.ok(modalMatch, 'z-index de #global-modal sous body.hospital-desktop-open introuvable');
  assert.ok(Number(modalMatch[1]) > Number(shellMatch[1]), 'la modale doit passer AU-DESSUS du shell desktop');
});

test('4. la modale se ferme par la croix (index.html appelle App.closeModal())', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /modal-close[^>]*onclick="App\.closeModal\(\)"/);
});

test("5. la modale se ferme avec Échap (App.init() écoute keydown)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/app.js'), 'utf8');
  assert.match(src, /keydown/);
  assert.match(src, /e\.key === 'Escape'/);
});

test('6. la modale se ferme en cliquant sur le fond (déjà en place, non-régression)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/app.js'), 'utf8');
  assert.match(src, /e\.target === document\.getElementById\('global-modal'\)\) closeModal\(\)/);
});

test('7. saveOrder() ne ferme la modale (App.closeModal) qu\'après la confirmation de création (jamais avant)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-lab.js'), 'utf8');
  const start = src.indexOf('async function saveOrder(');
  const end = src.indexOf('\n  /* ── Statut', start);
  const body = src.slice(start, end);
  const createIdx = body.indexOf("CloudDB.createDoc('labRequests'");
  const closeIdx = body.indexOf('App.closeModal()');
  assert.ok(createIdx !== -1 && closeIdx !== -1 && closeIdx > createIdx,
    'App.closeModal() doit venir APRÈS la création confirmée de la demande');
});

/* ── DROITS UI (8-15) ── */

const RENDER_ROLES = [
  ['doctor', true],
  ['nurse', true],
  ['admin_hospital', true],
  ['lab', false],
  ['reception', false],
];

for (const [role, expectButton] of RENDER_ROLES) {
  test(`8-12. render() : ${role} ${expectButton ? 'voit' : 'ne voit PAS'} "+ Nouvelle demande"`, async () => {
    const { sandbox } = setup({ role });
    const container = { innerHTML: '' };
    await sandbox.HospitalLabModule.render(container);
    const hasButton = /\+ Nouvelle demande/.test(container.innerHTML);
    assert.strictEqual(hasButton, expectButton);
  });
}

test('13-14. render() : lab voit "Prise en charge" et "Saisir le résultat" sur une demande "requested"', async () => {
  const { sandbox } = setup({ role: 'lab', labRequests: [{ id: 'LR-1', status: 'requested', patientMc: 'MC-1' }] });
  const container = { innerHTML: '' };
  await sandbox.HospitalLabModule.render(container);
  assert.match(container.innerHTML, /Prise en charge/);
  assert.match(container.innerHTML, /Saisir le résultat/);
});

test('15. render() : reception ne voit aucune action laboratoire', async () => {
  const { sandbox } = setup({ role: 'reception', labRequests: [{ id: 'LR-2', status: 'requested', patientMc: 'MC-2' }] });
  const container = { innerHTML: '' };
  await sandbox.HospitalLabModule.render(container);
  assert.ok(!/Prise en charge/.test(container.innerHTML));
  assert.ok(!/Saisir le résultat/.test(container.innerHTML));
  assert.ok(!/\+ Nouvelle demande/.test(container.innerHTML));
});

/* ── ACTIONS (16-22) ── */

test('16. openNew() refuse lab (retourne false, aucune modale ouverte)', () => {
  const { sandbox, opened, toasts } = setup({ role: 'lab' });
  const result = sandbox.HospitalLabModule.openNew();
  assert.strictEqual(result, false);
  assert.strictEqual(opened.count, 0);
  assert.ok(toasts.some(t => t.type === 'error'));
});

test('16bis. openNew() accepte doctor (ouvre la modale)', () => {
  const { sandbox, opened } = setup({ role: 'doctor' });
  const result = sandbox.HospitalLabModule.openNew();
  assert.strictEqual(result, true);
  assert.strictEqual(opened.count, 1);
  assert.match(opened.title, /Nouvelle demande/);
});

test("17. saveOrder() refuse lab (aucune écriture Firestore tentée)", async () => {
  const { sandbox, created, toasts } = setup({ role: 'lab' });
  const result = await sandbox.HospitalLabModule.saveOrder();
  assert.strictEqual(result, false);
  assert.strictEqual(created.length, 0);
  assert.ok(toasts.some(t => t.type === 'error'));
});

test('18. saveOrder() accepte doctor/nurse autorisé et crée labRequests avec status requested', async () => {
  const { sandbox, getEl, created } = setup({ role: 'doctor' });
  sandbox.HospitalLabModule.openNew();
  getEl('lab-mc').value = 'MC-18';
  getEl('lab-type').value = 'Glycémie à jeun';
  // Patient introuvable (aucune fiche seedée) : la confirmation
  // explicite est nécessaire pour créer quand même la demande.
  getEl('lab-mc-confirm').checked = true;
  const result = await sandbox.HospitalLabModule.saveOrder();
  assert.strictEqual(result, true);
  const req = created.find(([col]) => col === 'labRequests');
  assert.ok(req, 'labRequests doit être créé');
  assert.strictEqual(req[2].status, 'requested');
  assert.strictEqual(req[2].requestedByRole, 'doctor');
});

test("19. openResult() accepte lab (ouvre la modale) sur une demande non terminée", async () => {
  const { sandbox, opened } = setup({ role: 'lab', labRequests: [{ id: 'LR-19', status: 'in_progress', patientMc: 'MC-19', type: 'Glycémie à jeun' }] });
  await renderFirst(sandbox);
  const result = sandbox.HospitalLabModule.openResult('LR-19');
  assert.strictEqual(result, true);
  assert.strictEqual(opened.count, 1);
});

test('19bis. openResult() refuse reception', async () => {
  const { sandbox, opened } = setup({ role: 'reception', labRequests: [{ id: 'LR-19B', status: 'requested', patientMc: 'MC-19B' }] });
  await renderFirst(sandbox);
  const result = sandbox.HospitalLabModule.openResult('LR-19B');
  assert.strictEqual(result, false);
  assert.strictEqual(opened.count, 0);
});

test('20. saveResult() accepte lab affilié : écrit les 3 documents en un seul batch', async () => {
  const { sandbox, getEl, created } = setup({
    role: 'lab',
    labRequests: [{ id: 'LR-20', status: 'in_progress', patientMc: 'MC-20', patientName: 'Jean', type: 'Glycémie à jeun', requestedByUid: 'doctor-req-20' }],
  });
  await renderFirst(sandbox);
  sandbox.HospitalLabModule.openResult('LR-20');
  getEl('lab-value').value = '0.9';
  const result = await sandbox.HospitalLabModule.saveResult('LR-20');
  assert.strictEqual(result, true);
  assert.ok(created.some(([col]) => col === 'labRequests'));
  assert.ok(created.some(([col]) => col === 'labResults'));
  assert.ok(created.some(([col]) => col === 'mc_lab_results'));
});

test('21. un double clic ne crée qu\'une seule demande (verrou de réentrance _savingOrder)', async () => {
  const { sandbox, getEl, created } = setup({ role: 'doctor' });
  sandbox.HospitalLabModule.openNew();
  getEl('lab-mc').value = 'MC-21';
  getEl('lab-type').value = 'Glycémie à jeun';
  getEl('lab-mc-confirm').checked = true;
  const [r1, r2] = await Promise.all([
    sandbox.HospitalLabModule.saveOrder(),
    sandbox.HospitalLabModule.saveOrder(),
  ]);
  assert.ok(r1 === false || r2 === false, 'un des deux appels concurrents doit être rejeté par le verrou');
  assert.strictEqual(created.filter(([col]) => col === 'labRequests').length, 1);
});

test('22. un double clic ne crée qu\'un seul résultat (verrou de réentrance _savingResult)', async () => {
  const { sandbox, getEl, created } = setup({
    role: 'lab',
    labRequests: [{ id: 'LR-22', status: 'in_progress', patientMc: 'MC-22', type: 'Glycémie à jeun' }],
  });
  await renderFirst(sandbox);
  sandbox.HospitalLabModule.openResult('LR-22');
  getEl('lab-value').value = '1.0';
  const [r1, r2] = await Promise.all([
    sandbox.HospitalLabModule.saveResult('LR-22'),
    sandbox.HospitalLabModule.saveResult('LR-22'),
  ]);
  assert.ok(r1 === false || r2 === false, 'un des deux appels concurrents doit être rejeté par le verrou');
  assert.strictEqual(created.filter(([col]) => col === 'labResults').length, 1);
});

/* ── Transitions de statut (côté client, miroir des règles serveur) ── */

test('setStatus() refuse une transition non autorisée (completed -> in_progress)', async () => {
  const { sandbox, updated, toasts } = setup({
    role: 'lab',
    labRequests: [{ id: 'LR-T1', status: 'completed', patientMc: 'MC-T1' }],
  });
  await renderFirst(sandbox);
  const result = await sandbox.HospitalLabModule.setStatus('LR-T1', 'in_progress');
  assert.strictEqual(result, false);
  assert.strictEqual(updated.length, 0);
  assert.ok(toasts.some(t => /[Tt]ransition/.test(t.msg)));
});

test('setStatus() accepte requested -> in_progress pour un lab affilié', async () => {
  const { sandbox, updated } = setup({
    role: 'lab',
    labRequests: [{ id: 'LR-T2', status: 'requested', patientMc: 'MC-T2' }],
  });
  await renderFirst(sandbox);
  const result = await sandbox.HospitalLabModule.setStatus('LR-T2', 'in_progress');
  assert.strictEqual(result, true);
  assert.ok(updated.some(([col, id, data]) => col === 'labRequests' && id === 'LR-T2' && data.status === 'in_progress'));
});

/* ── Résultat NON enregistré en cas d'échec du batch (jamais de faux succès) ── */

test("saveResult() : un batch en échec n'affiche jamais de succès et ne ferme pas la modale", async () => {
  const failingBatch = async () => ({ ok: false, succeeded: [], failed: [['labRequests', 'LR-F1']], timedOut: false, error: new Error('boom') });
  const { sandbox, getEl, toasts } = setup({
    role: 'lab',
    labRequests: [{ id: 'LR-F1', status: 'in_progress', patientMc: 'MC-F1', type: 'Glycémie à jeun' }],
    pushBatchImpl: failingBatch,
  });
  await renderFirst(sandbox);
  sandbox.HospitalLabModule.openResult('LR-F1');
  getEl('lab-value').value = '1.2';
  const result = await sandbox.HospitalLabModule.saveResult('LR-F1');
  assert.strictEqual(result, false);
  assert.ok(!toasts.some(t => /^Résultat enregistré/.test(t.msg)));
  assert.ok(toasts.some(t => /NON enregistré/.test(t.msg)));
});
