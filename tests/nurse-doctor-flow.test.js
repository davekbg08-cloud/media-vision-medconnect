/* =====================================================
   Tests — Parcours infirmière → médecin (fiches patient)
   Vérifie la logique métier :
   - une fiche créée par une infirmière porte les bonnes
     métadonnées (rôle, statut, complétion pending) ;
   - la 1ère consultation d'un médecin marque la fiche
     completed avec traçabilité ;
   - l'UI masque les actions ordonnance/consultation pour
     les rôles sans la capacité (défense en profondeur).
   Tests structurels (analyse du source js/hospital.js),
   car ces fonctions dépendent du DOM.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital.js'), 'utf8');

test('une fiche créée par une infirmière porte les métadonnées de traçabilité', () => {
  // Bloc saveNewPatient : branche isNurse avec les champs attendus.
  assert.match(src, /created_by_role: 'nurse'/);
  assert.match(src, /nurse_uid: user\.uid/);
  assert.match(src, /nurse_name: user\.name/);
  assert.match(src, /status: 'awaiting_doctor'/);
  assert.match(src, /medical_completion_status: 'pending'/);
});

test('une fiche créée par un médecin est directement complétée côté médical', () => {
  // La branche non-infirmière met completed pour un doctor.
  assert.match(src, /\(user\.role === 'doctor'\) \? 'completed' : 'pending'/);
});

test('la 1ère consultation d\'un médecin DÉLÈGUE la complétion à la fonction dédiée (v2.9.36, jamais updatePatient)', () => {
  // hospital.js détecte une fiche infirmière en attente puis délègue à la
  // fonction dédiée — il ne réécrit plus les champs de complétion en ligne
  // ni via DB.updatePatient (voir tests/db-nurse-patient-completion.test.js
  // et tests/firestore-rules/nurse-patient-completion.rules.test.js).
  assert.match(src, /created_by_role === 'nurse'/, 'détecte une fiche créée par une infirmière');
  assert.match(src, /medical_completion_status === 'pending'/, 'détecte une fiche en attente');
  assert.match(src, /status === 'awaiting_doctor'/, 'exige le statut awaiting_doctor');
  assert.match(src, /DB\.completeNurseCreatedPatientAfterConsultation/, 'délègue à la fonction dédiée');
  // Plus aucun appel réel à DB.updatePatient dans hospital.js (seulement
  // mentionné en commentaire pour expliquer le correctif).
  assert.ok(!/DB\.updatePatient\(/.test(src), 'ne complète plus via DB.updatePatient()');

  // La transition et sa traçabilité vivent désormais dans js/db.js.
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  assert.match(dbSrc, /medical_completion_status: 'completed'/);
  assert.match(dbSrc, /completed_by_doctor_uid/);
  assert.match(dbSrc, /completed_by_doctor_name/);
  assert.match(dbSrc, /completed_at/);
});

test('le badge « À compléter par le médecin » s\'affiche pour les fiches pending', () => {
  assert.match(src, /medical_completion_status === 'pending'/);
  assert.match(src, /À compléter par le médecin/);
});

test('l\'UI masque la consultation pour un rôle sans create_consultation', () => {
  // Les boutons consultation sont conditionnés à la capacité.
  assert.match(src, /can\?\.\(Auth\.getUser\(\)\?\.role, 'create_consultation'\)/);
});

test('l\'UI masque l\'envoi pharmacie pour un rôle sans prescribe', () => {
  assert.match(src, /can\?\.\(Auth\.getUser\(\)\?\.role, 'prescribe'\)/);
});

test('l\'envoi d\'ordonnance à la pharmacie est gardé côté action (pas seulement UI)', () => {
  // openPrescriptionTarget et confirmPrescriptionTarget refusent si le
  // rôle n'a pas la capacité prescribe.
  const guardCount = (src.match(/guardHospitalAction\?\.\('prescribe'\)/g) || []).length;
  assert.ok(guardCount >= 2, 'les deux étapes d\'envoi doivent être gardées');
});

test('la traçabilité created_by/nurse_uid est conservée (écriture PARTIELLE de complétion, js/db.js)', () => {
  // La complétion (js/db.js) écrit un patch limité aux seuls champs de
  // complétion — il ne contient jamais created_by ni nurse_uid, donc le
  // merge préserve la traçabilité infirmière.
  const dbSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  const idx = dbSrc.indexOf("medical_completion_status: 'completed'");
  assert.ok(idx !== -1, 'la transition existe dans db.js');
  // Le patch de complétion (bloc autour de cette ligne) ne réécrit ni
  // created_by ni nurse_uid.
  const patchBlock = dbSrc.slice(idx - 120, idx + 320);
  assert.ok(!/created_by:/.test(patchBlock), 'le patch ne réécrit pas created_by');
  assert.ok(!/nurse_uid:/.test(patchBlock), 'le patch ne réécrit pas nurse_uid');
});
