/* =====================================================
   Tests — HospitalReportingModule (chantier E)
   Reporting d'établissement 100 % client : agrégats corrects,
   accès réservé à l'administration, export, câblage.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadIntoWindow } = require('./helper');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const reportingSrc = read('js/hospital-reporting.js');

// Charge le module dans un sandbox où CloudDB est MOCKÉ (bare global),
// pour tester computeStats() sur des données contrôlées.
function loadWithCloudDB(byCollection) {
  const sandbox = {
    console,
    CloudDB: {
      async listByHospital(collection) { return byCollection[collection] || []; },
      async getActiveHospital() { return { establishmentId: 'H1', name: 'Hôpital Test' }; },
    },
    Math, Date, Promise, JSON, Object, Array, String, Number, URL,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(reportingSrc, sandbox, { filename: 'js/hospital-reporting.js' });
  return sandbox.HospitalReportingModule;
}

const TODAY = new Date().toISOString().slice(0, 10);

test('computeStats agrège lits/admissions/labo/consultations/urgences correctement', async () => {
  const R = loadWithCloudDB({
    beds: [
      { status: 'occupied' }, { status: 'occupied' }, { status: 'free' },
      { status: 'maintenance' }, { status: 'admitted' },
    ], // 5 lits : 3 occupés (occupied×2 + admitted), 1 libre, 1 maintenance
    admissions: [
      { status: 'waiting' }, { status: 'pre_admission' },
      { status: 'admitted' }, { status: 'hospitalized' },
      { status: 'discharged' }, { status: 'waiting', arrivedAt: TODAY + 'T08:00:00Z' },
    ],
    labRequests: [{ status: 'completed' }, { status: 'pending' }, { status: 'in_progress' }],
    mc_consultations: [{ date: TODAY }, { date: '2020-01-01' }, { date: TODAY }],
    emergencyCases: [{ status: 'waiting' }, { status: 'in_care' }, { status: 'closed' }],
  });
  const s = await R.computeStats('H1');

  assert.strictEqual(s.beds.total, 5);
  assert.strictEqual(s.beds.occupied, 3);
  assert.strictEqual(s.beds.maintenance, 1);
  assert.strictEqual(s.beds.free, 1);
  assert.strictEqual(s.beds.occupancyPct, 60); // 3/5

  assert.strictEqual(s.admissions.waiting, 2);
  assert.strictEqual(s.admissions.preAdmission, 1);
  assert.strictEqual(s.admissions.active, 2); // admitted + hospitalized
  assert.strictEqual(s.admissions.discharged, 1);
  assert.strictEqual(s.admissions.today, 1);

  assert.strictEqual(s.lab.total, 3);
  assert.strictEqual(s.lab.pending, 2); // tout sauf completed
  assert.strictEqual(s.lab.completed, 1);

  assert.strictEqual(s.consultations.total, 3);
  assert.strictEqual(s.consultations.today, 2);

  assert.strictEqual(s.emergencies.active, 2); // waiting + in_care
});

test('computeStats dégrade proprement à 0 quand tout est vide (aucune collection)', async () => {
  const R = loadWithCloudDB({});
  const s = await R.computeStats('H1');
  assert.strictEqual(s.beds.total, 0);
  assert.strictEqual(s.beds.occupancyPct, 0);
  assert.strictEqual(s.admissions.total, 0);
  assert.strictEqual(s.emergencies.active, 0);
});

test('toRows produit une ligne [libellé, valeur] par indicateur', async () => {
  const R = loadWithCloudDB({});
  const s = await R.computeStats('H1');
  const rows = R.toRows(s);
  assert.ok(Array.isArray(rows) && rows.length >= 12);
  assert.ok(rows.every(r => Array.isArray(r) && r.length === 2));
  assert.ok(rows.some(([k]) => /occupation/i.test(k)));
});

/* ── Accès réservé à l'administration ─────────────── */
test('la route reporting est réservée à admin / admin_hospital', () => {
  const win = loadIntoWindow(['js/hospital-permissions.js']);
  const P = win.HospitalPermissions;
  assert.strictEqual(P.canAccess('admin', 'reporting'), true);
  assert.strictEqual(P.canAccess('admin_hospital', 'reporting'), true);
  for (const role of ['doctor', 'nurse', 'reception', 'lab', 'pharmacist']) {
    assert.strictEqual(P.canAccess(role, 'reporting'), false, `${role} ne doit pas accéder au reporting`);
  }
});

test('le menu desktop admin_hospital contient l\'entrée Reporting', () => {
  const win = loadIntoWindow(['js/hospital-permissions.js']);
  const keys = win.HospitalPermissions.visibleMenuFor('admin_hospital').map(m => m.key);
  assert.ok(keys.includes('reporting'));
  // Un rôle clinique ne la voit pas.
  const nurseKeys = win.HospitalPermissions.visibleMenuFor('nurse').map(m => m.key);
  assert.ok(!nurseKeys.includes('reporting'));
});

/* ── Export & câblage (analyse de source) ─────────── */
test('le module gère l\'export CSV (Blob + téléchargement) et l\'impression', () => {
  assert.match(reportingSrc, /function exportCsv\(\)/);
  assert.match(reportingSrc, /new Blob\(/);
  assert.match(reportingSrc, /text\/csv/);
  assert.match(reportingSrc, /function printReport\(\)/);
  assert.match(reportingSrc, /window\.print/);
});

test('render revérifie l\'autorisation (requireRoute) — pas un simple masquage', () => {
  assert.match(reportingSrc, /HospitalPermissions\.requireRoute\('reporting'\)/);
});

test('câblage : desktop-ui route native + index.html + service worker', () => {
  assert.match(read('js/hospital-desktop-ui.js'), /reporting:\s*\(c\) => window\.HospitalReportingModule\?\.render\?\.\(c\)/);
  assert.match(read('index.html'), /src="js\/hospital-reporting\.js"/);
  assert.match(read('sw.js'), /'\.\/js\/hospital-reporting\.js'/);
});
