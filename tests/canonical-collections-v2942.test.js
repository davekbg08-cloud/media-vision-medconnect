/* =====================================================
   Tests — Collections canoniques : arrêt des doubles-écritures (chantier 1, v2.9.42)

   Les collections miroir 'patients' / 'prescriptions' / 'appointments'
   (jamais relues nulle part) ne sont plus alimentées : mc_patients /
   mc_prescriptions / mc_appointments sont les sources uniques. Réduit de
   moitié les écritures de ces objets (coût) et supprime tout risque de
   seconde source contradictoire. Vérifié au niveau source (aucune écriture
   legacy résiduelle dans db.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const db = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');

test('plus aucune écriture fire-and-forget vers les miroirs morts', () => {
  assert.ok(!/_push\('patients'/.test(db), "'patients' (miroir) ne doit plus être écrit");
  assert.ok(!/_push\('prescriptions'/.test(db), "'prescriptions' (miroir) ne doit plus être écrit");
  assert.ok(!/_push\('appointments'/.test(db), "'appointments' (miroir) ne doit plus être écrit");
});

test('plus aucune écriture batch vers les miroirs morts', () => {
  assert.ok(!/\['patients',/.test(db), "'patients' ne doit plus figurer dans un batch");
  assert.ok(!/\['prescriptions',/.test(db), "'prescriptions' ne doit plus figurer dans un batch");
  assert.ok(!/\['appointments',/.test(db), "'appointments' ne doit plus figurer dans un batch");
});

test('les sources canoniques restent bien écrites', () => {
  assert.match(db, /_push\('mc_patients'/);
  assert.match(db, /_push\('mc_prescriptions'/);
  assert.match(db, /_push\('mc_appointments'/);
  assert.match(db, /\['mc_patients',/);
});
