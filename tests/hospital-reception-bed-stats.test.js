/* =====================================================
   Tests — Statistiques des lits sur la page Réception
   (audit "workflows mobile/desktop", section 11)

   Bug confirmé : la page Réception affichait les arrivées et les
   pré-admissions, mais jamais lits totaux/libres/occupés/hors service/
   taux d'occupation — alors que js/hospital-reception.js lit déjà
   'beds' pour l'écran d'arrivée (openIntake). En cas d'échec de
   chargement des lits, un faux zéro ne doit jamais laisser croire que
   l'hôpital n'a aucun lit.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(initial = {}) {
  return { value: '', textContent: '', innerHTML: '', disabled: false, dataset: {}, style: {}, className: '', selectedOptions: [], ...initial };
}

function setup({ visits = [], beds = [], bedsShouldFail = false } = {}) {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.HospitalPermissions = { requireRoute: () => true };
  sandbox.HospitalCapabilities = { guardHospitalAction: () => true };
  sandbox.App = { toast(){}, openModal(){}, closeModal(){} };
  sandbox.HospitalDesktopUI = { navigate: () => {} };
  sandbox.HospitalsRegistry = { getHospitalById: () => ({ establishmentId: 'EST-1', staff: [] }) };
  sandbox.HospitalPortal = { currentEstablishmentFields: () => ({ establishmentId: 'EST-1' }) };
  sandbox.Auth = { getUser: () => ({ uid: 'user-1' }) };
  sandbox.firebaseReady = true;
  sandbox.firebaseDB = { collection: () => ({ doc: () => ({ async get() { return { exists: false }; } }) }) };
  sandbox.DB = { getPatients: () => [], savePatients(){}, makeId: (p) => `${p}-ID` };
  sandbox.CloudDB = {
    getActiveHospitalId: async () => 'EST-1',
    listByHospital: async (col) => {
      if (col === 'receptionVisits') return visits;
      if (col === 'beds') { if (bedsShouldFail) throw new Error('Firestore indisponible'); return beds; }
      return [];
    },
  };
  sandbox.document = { getElementById: getEl, querySelector: () => null };

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-reception.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/hospital-reception.js' });
  return { sandbox };
}

test('la page Réception affiche les lits totaux/libres/occupés/hors service et le taux d\'occupation', async () => {
  const { sandbox } = setup({
    beds: [
      { id: 'B1', status: 'free' }, { id: 'B2', status: 'free' },
      { id: 'B3', status: 'occupied' }, { id: 'B4', status: 'occupied' }, { id: 'B5', status: 'occupied' },
      { id: 'B6', status: 'maintenance' },
    ],
  });
  const container = { innerHTML: '' };
  await sandbox.HospitalReceptionModule.render(container);
  assert.match(container.innerHTML, /<h3>6<\/h3><p>Lits totaux/);
  assert.match(container.innerHTML, /<h3>2<\/h3><p>🟢 Libres/);
  assert.match(container.innerHTML, /<h3>3<\/h3><p>🔴 Occupés/);
  assert.match(container.innerHTML, /<h3>1<\/h3><p>🟡 Hors service/);
  // Taux d'occupation = occupés / lits UTILISABLES (hors service exclu) = 3/5 = 60%
  assert.match(container.innerHTML, /<h3>60%<\/h3><p>Taux d'occupation/);
  assert.match(container.innerHTML, /Dernière mise à jour/);
});

test("le taux d'occupation exclut les lits hors service du dénominateur", async () => {
  const { sandbox } = setup({
    beds: [
      { id: 'B1', status: 'occupied' }, { id: 'B2', status: 'maintenance' }, { id: 'B3', status: 'maintenance' },
    ],
  });
  const container = { innerHTML: '' };
  await sandbox.HospitalReceptionModule.render(container);
  // 1 lit utilisable (3 - 2 hors service), 1 occupé => 100%, pas 33%.
  assert.match(container.innerHTML, /<h3>100%<\/h3><p>Taux d'occupation/);
});

test('un échec de chargement des lits affiche une indisponibilité explicite, jamais un faux zéro', async () => {
  const { sandbox } = setup({ bedsShouldFail: true });
  const container = { innerHTML: '' };
  await sandbox.HospitalReceptionModule.render(container);
  assert.match(container.innerHTML, /Données des lits indisponibles/);
  assert.doesNotMatch(container.innerHTML, /<h3>0<\/h3><p>Lits totaux/, 'un échec ne doit jamais afficher "0 lits" comme si l\'hôpital n\'en avait aucun');
});

test('un établissement sans aucun lit affiche bien 0 partout (distinct d\'un échec de chargement)', async () => {
  const { sandbox } = setup({ beds: [] });
  const container = { innerHTML: '' };
  await sandbox.HospitalReceptionModule.render(container);
  assert.match(container.innerHTML, /<h3>0<\/h3><p>Lits totaux/);
  assert.doesNotMatch(container.innerHTML, /Données des lits indisponibles/);
});
