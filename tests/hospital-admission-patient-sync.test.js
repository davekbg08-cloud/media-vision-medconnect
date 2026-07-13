/* =====================================================
   Tests — hospital-beds.js/hospital-reception.js écrivent bien le
   miroir mc_admissions (patient_id mappé depuis le numéro MC)

   Voir tests/db-admissions-mirror.test.js pour le miroir lui-même et
   tests/timeline-admissions-wiring.test.js pour le câblage côté
   interface patient.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const bedsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-beds.js'), 'utf8');
const receptionSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-reception.js'), 'utf8');

test('hospital-beds.js saveAdmission() écrit le miroir mc_admissions APRÈS la création de admissions', () => {
  const start = bedsSrc.indexOf('async function saveAdmission(');
  assert.ok(start !== -1);
  const end = bedsSrc.indexOf('\n  async function discharge', start);
  const body = bedsSrc.slice(start, end);
  const admissionsIdx = body.indexOf("CloudDB.createDoc('admissions'");
  assert.ok(admissionsIdx !== -1, 'admissions doit toujours être créé');
  const mirrorIdx = body.indexOf('DB.addAdmissionRecord(');
  assert.ok(mirrorIdx !== -1, 'le miroir mc_admissions doit être écrit');
  assert.ok(admissionsIdx < mirrorIdx, 'le miroir doit être écrit après admissions');
  assert.match(body.slice(mirrorIdx, body.indexOf(');', mirrorIdx)), /patient_id:\s*mc/,
    'patient_id doit être mappé depuis le numéro MC saisi');
});

test('hospital-reception.js écrit aussi le miroir mc_admissions pour une admission créée depuis ce flux', () => {
  const mirrorIdx = receptionSrc.indexOf('DB.addAdmissionRecord(');
  assert.ok(mirrorIdx !== -1, 'le miroir mc_admissions doit être écrit');
  const admissionsIdx = receptionSrc.indexOf("CloudDB.createDoc('admissions'");
  assert.ok(admissionsIdx !== -1 && admissionsIdx < mirrorIdx, 'le miroir doit être écrit après admissions');
});
