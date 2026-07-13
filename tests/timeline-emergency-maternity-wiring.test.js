/* =====================================================
   Tests — js/timeline.js buildEvents() lit bien mc_emergency_cases /
   mc_maternity_cases

   Voir tests/db-emergency-maternity-mirror.test.js pour les miroirs
   eux-mêmes.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/timeline.js'), 'utf8');

function buildEventsBody() {
  const start = src.indexOf('function buildEvents(');
  const end = src.indexOf('\n  function renderEvents', start);
  return src.slice(start, end);
}

test("buildEvents lit DB.getPatientEmergencyCases et pousse un événement de type 'emergency'", () => {
  const body = buildEventsBody();
  assert.match(body, /DB\.getPatientEmergencyCases\?\.\(patientId\)/);
  const idx = body.indexOf('getPatientEmergencyCases');
  assert.ok(body.indexOf("type:'emergency'", idx) !== -1);
});

test("buildEvents lit DB.getPatientMaternityCases et pousse un événement de type 'maternity'", () => {
  const body = buildEventsBody();
  assert.match(body, /DB\.getPatientMaternityCases\?\.\(patientId\)/);
  const idx = body.indexOf('getPatientMaternityCases');
  assert.ok(body.indexOf("type:'maternity'", idx) !== -1);
});

test('TYPE_META déclare bien emergency et maternity', () => {
  assert.match(src, /emergency:\s*\{\s*icon:'🚑'/);
  assert.match(src, /maternity:\s*\{\s*icon:'🤰'/);
});
