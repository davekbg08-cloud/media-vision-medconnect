/* =====================================================
   Tests — Historique médical append-only, côté interface (chantier 3, v2.9.42)

   Les boutons de suppression (patient, consultation) sont retirés des
   interfaces ordinaires, et les fonctions correspondantes ne suppriment
   plus rien (défense en profondeur ; l'enforcement réel est côté règles,
   voir tests/firestore-rules/immutable-history-v2942.rules.test.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const hospital = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital.js'), 'utf8');

test('le bouton 🗑️ de suppression patient est retiré de la liste', () => {
  assert.ok(!/HospitalPortal\.deletePatient\('\$\{p\.id\}'\)/.test(hospital),
    'plus de bouton onclick=deletePatient dans la liste patients');
});

test('le bouton 🗑️ de suppression de consultation est retiré', () => {
  assert.ok(!/HospitalPortal\.delConsult\(/.test(hospital),
    'plus de bouton onclick=delConsult');
});

test('deletePatient ne supprime plus rien (fonction neutralisée)', () => {
  const fn = hospital.slice(hospital.indexOf('function deletePatient'), hospital.indexOf('function deletePatient') + 400);
  assert.ok(!/DB\.deletePatient\(/.test(fn), 'deletePatient ne doit plus appeler DB.deletePatient');
  assert.match(fn, /non autoris[ée]/i);
});

test('delConsult ne supprime plus rien (fonction neutralisée)', () => {
  const fn = hospital.slice(hospital.indexOf('function delConsult'), hospital.indexOf('function delConsult') + 400);
  assert.ok(!/DB\.deleteConsultation\(/.test(fn), 'delConsult ne doit plus appeler DB.deleteConsultation');
  assert.match(fn, /correction/i);
});
