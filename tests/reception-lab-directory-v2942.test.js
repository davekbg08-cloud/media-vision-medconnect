/* =====================================================
   Tests — Réception/Labo : identité via patient_directory (chantier 2, v2.9.42, source)

   Le lookup MC-exact de la réception et du laboratoire lit patient_directory
   (identité administrative), plus jamais mc_patients (fiche clinique). La
   réconciliation de création atomique relit patient_directory. Les listeners
   cliniques sont réservés aux rôles cliniques.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const reception = read('js/hospital-reception.js');
const lab = read('js/hospital-lab.js');
const db = read('js/db.js');

test('le lookup MC-exact de la réception lit patient_directory, pas mc_patients', () => {
  const fn = reception.slice(reception.indexOf('function _lookupPatientCloud'), reception.indexOf('function _lookupPatientCloud') + 700);
  assert.match(fn, /collection\('patient_directory'\)\.doc\(mc\)/);
  assert.ok(!/collection\('mc_patients'\)\.doc\(mc\)/.test(fn), 'la réception ne doit plus lire mc_patients');
});

test('le lookup MC-exact du laboratoire lit patient_directory, pas mc_patients', () => {
  const fn = lab.slice(lab.indexOf('function _lookupPatient'), lab.indexOf('function _lookupPatient') + 700);
  assert.match(fn, /collection\('patient_directory'\)\.doc\(mc\)/);
  assert.ok(!/collection\('mc_patients'\)\.doc\(mc\)/.test(fn), 'le laboratoire ne doit plus lire mc_patients');
});

test('la réconciliation de création atomique relit patient_directory (créateur réception inclus)', () => {
  assert.match(db, /collection\('patient_directory'\)\.doc\(p\.id\)\.get\(\)/);
});

test('les listeners cliniques (mc_patients + contenu clinique) sont réservés aux rôles cliniques', () => {
  const scoped = db.slice(db.indexOf('function setupUserScopedListeners'));
  assert.match(scoped, /\['doctor', 'nurse', 'admin_hospital'\]\.includes\(user\.role\)/,
    'le bloc clinique ne doit couvrir que doctor/nurse/admin_hospital');
  assert.ok(!/\['doctor', 'nurse', 'reception', 'lab', 'admin_hospital'\]\.includes\(user\.role\)/.test(scoped),
    'reception/lab ne doivent plus figurer dans le bloc de listeners cliniques');
});
