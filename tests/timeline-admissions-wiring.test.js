/* =====================================================
   Tests — js/timeline.js buildEvents() lit bien mc_admissions

   Découvert en auditant le dépôt : le filtre "🏥 Hospitalisation"
   (TYPE_META.admission) existait dans l'interface depuis le début
   mais buildEvents() ne lisait jamais aucune source de données pour
   ce type — filtre purement décoratif, jamais alimenté. Corrigé en
   lisant DB.getPatientAdmissions(patientId) (voir
   tests/db-admissions-mirror.test.js pour le miroir lui-même).
   buildEvents() dépend de DB (module global) — verrouillé par lecture
   de source, pattern déjà établi pour cette zone du code.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/timeline.js'), 'utf8');

function buildEventsBody() {
  const start = src.indexOf('function buildEvents(');
  assert.ok(start !== -1, 'buildEvents doit exister');
  const end = src.indexOf('\n  function renderEvents', start);
  assert.ok(end !== -1, 'fin de buildEvents introuvable');
  return src.slice(start, end);
}

test("buildEvents lit DB.getPatientAdmissions et pousse un événement de type 'admission'", () => {
  const body = buildEventsBody();
  assert.match(body, /DB\.getPatientAdmissions\?\.\(patientId\)/, 'buildEvents doit lire les admissions du patient');
  const admissionsIdx = body.indexOf('getPatientAdmissions');
  const pushIdx = body.indexOf("type:'admission'", admissionsIdx);
  assert.ok(pushIdx !== -1, "un événement type:'admission' doit être poussé à partir des admissions lues");
});

test("TYPE_META.admission reste défini (le filtre existait déjà, désormais alimenté)", () => {
  assert.match(src, /admission:\s*\{\s*icon:'🏥',\s*label:'Hospitalisation'/);
});
