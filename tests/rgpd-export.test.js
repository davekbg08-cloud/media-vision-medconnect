/* =====================================================
   Tests — Export « Mes données » (RGPD art. 15 et 20)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/patient.js'), 'utf8');

function loadPortal(db) {
  const ctx = { window: {}, console, DB: db, App: { toast() {} }, I18n: { t: (k) => k }, t: (k) => k };
  vm.createContext(ctx);
  vm.runInContext(`${src}\nthis.__portal = typeof PatientPortal !== 'undefined' ? PatientPortal : window.PatientPortal;`, ctx);
  return ctx.__portal;
}

const DBSTUB = {
  getPatientById: (id) => ({ id, firstname: 'Amani', lastname: 'K', pin: '1234', pinHash: 'x', access_code: 'AB12', blood_type: 'O+' }),
  getPatientConsultations: () => [{ date: '2026-09-01', diagnosis: 'Paludisme', doctor_token: 'secret' }],
  getPatientPrescriptions: () => [{ id: 'rx1' }],
  getPatientLabResults: () => [],
  getPatientVaccinations: () => [],
  getPatientAppointments: () => [],
  getPatientAdmissions: () => [],
};

test("l'export contient le dossier complet dans un format lisible par machine", () => {
  const portal = loadPortal(DBSTUB);
  const data = portal.buildMyDataExport('MC-1');
  assert.strictEqual(data.format, 'medconnect-patient-export');
  assert.strictEqual(data.patient.firstname, 'Amani');
  assert.strictEqual(data.patient.blood_type, 'O+');
  assert.strictEqual(data.consultations[0].diagnosis, 'Paludisme');
  assert.strictEqual(data.prescriptions.length, 1);
});

test("aucun secret n'est exporté (PIN, empreinte, code d'accès, jeton)", () => {
  const portal = loadPortal(DBSTUB);
  const json = JSON.stringify(portal.buildMyDataExport('MC-1'));
  for (const secret of ['1234', 'pinHash', 'AB12', 'doctor_token']) {
    assert.ok(!json.includes(secret), `${secret} ne doit pas apparaître`);
  }
});

test('le bouton « Mes données » est proposé sur la carte santé', () => {
  assert.match(src, /PatientPortal\.exportMyData\('\$\{p\.id\}'\)/);
});
