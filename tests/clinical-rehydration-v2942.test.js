/* =====================================================
   Tests — Généralisation des listeners cliniques (chantier 1, v2.9.42, source)

   setupUserScopedListeners recharge désormais TOUT l'historique clinique
   par requêtes filtrées query-safe : établissement + created_by pour les
   membres, patient_id pour le patient. Plus de listener mc_prescriptions
   non filtré. Comportement des règles validé séparément à l'émulateur
   (tests/firestore-rules/clinical-history-rehydration-v2942.rules.test.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const db = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
const scoped = db.slice(db.indexOf('function setupUserScopedListeners'));

test('la liste des collections cliniques couvre consultations/ordonnances/rdv/labo/admissions/urgences/maternité/vaccinations', () => {
  for (const c of ['mc_consultations', 'mc_prescriptions', 'mc_appointments', 'mc_lab_results', 'mc_admissions', 'mc_emergency_cases', 'mc_maternity_cases', 'mc_vaccinations']) {
    assert.ok(scoped.includes(`'${c}'`), `${c} doit figurer dans CLINICAL_COLLECTIONS`);
  }
});

test('membre : rechargement par establishmentId ET created_by', () => {
  assert.match(scoped, /\.where\('establishmentId', '==', id\)/);
  assert.match(scoped, /\.where\('created_by', '==', user\.uid\)/);
  assert.match(scoped, /_memberEstablishmentIds\(user\.uid\)/);
});

test('patient : rechargement de son historique par patient_id', () => {
  assert.match(scoped, /user\.role === 'patient'/);
  assert.match(scoped, /\.where\('patient_id', '==', ficheId\)/);
  assert.match(scoped, /mc_my_patient_id/);
});

test('plus de listener mc_prescriptions NON filtré (collection entière) pour doctor/nurse', () => {
  // L'ancien `scoped(firebaseDB.collection('mc_prescriptions'), 'mc_prescriptions', 'pid')`
  // sans .where(...) est retiré ; il ne reste que des requêtes filtrées.
  assert.ok(!/collection\('mc_prescriptions'\),\s*\n?\s*'mc_prescriptions'/.test(db),
    'aucune écoute mc_prescriptions collection-entière ne doit subsister');
});

test('le pharmacien garde son écoute ciblée par pharmacyUid', () => {
  assert.match(scoped, /collection\('mc_prescriptions'\)\.where\('pharmacyUid', '==', user\.uid\)/);
});
