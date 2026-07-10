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

test('la 1ère consultation d\'un médecin marque la fiche completed avec traçabilité', () => {
  assert.match(src, /medical_completion_status === 'pending'/,
    'doit détecter une fiche en attente');
  assert.match(src, /medical_completion_status: 'completed'/,
    'doit passer la fiche à completed');
  assert.match(src, /completed_by_doctor_uid/);
  assert.match(src, /completed_by_doctor_name/);
  assert.match(src, /completed_at/);
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

test('la traçabilité created_by est conservée (non écrasée par la complétion)', () => {
  // À la complétion, on ne touche pas created_by / nurse_uid.
  const idxComplete = src.indexOf("medical_completion_status: 'completed'");
  const around = src.slice(idxComplete - 50, idxComplete + 300);
  assert.ok(!/created_by:/.test(around),
    'la complétion ne doit pas réécrire created_by');
});
