/* =====================================================
   Tests — règles Firestore : création de mc_patients par le personnel

   Découverte en répondant à une question client sur le code d'accès :
   mc_patients n'avait qu'une clause `allow write: if isAdmin();` —
   aucune clause de création pour le personnel non-admin
   (docteur/infirmier), contrairement à la collection sœur `patients`
   (firestore.rules, match /patients/{patientId}) qui, elle, autorise
   déjà `currentRoleIs('doctor') || currentRoleIs('nurse')` (gated par
   hospitalCanWrite). Ce fichier verrouille le comportement attendu
   après correctif : le personnel non-admin d'un établissement en
   règle doit pouvoir créer un document mc_patients.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_patients : un(e) infirmier/médecin non-admin peut créer une fiche pour son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const nurse = env.authenticatedContext('nurse-creator-x', { role: 'nurse' }).firestore();
  await assertSucceeds(setDoc(doc(nurse, 'mc_patients', 'MC-CREATE-1'), {
    id: 'MC-CREATE-1', firstname: 'Jean', lastname: 'K', establishmentId: 'HOSP-X',
    created_by: 'nurse-creator-x', created_by_role: 'nurse',
  }));
});

test('mc_patients : un médecin non-admin peut créer une fiche pour son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-creator-x', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_patients', 'MC-CREATE-2'), {
    id: 'MC-CREATE-2', firstname: 'Marie', lastname: 'D', establishmentId: 'HOSP-X',
    created_by: 'doctor-creator-x', created_by_role: 'doctor',
  }));
});

test("mc_patients : un rôle sans lien (ex. pharmacien) ne peut pas créer de fiche patient", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharmacist = env.authenticatedContext('pharma-x', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_patients', 'MC-CREATE-3'), {
    id: 'MC-CREATE-3', establishmentId: 'HOSP-X', created_by: 'pharma-x',
  }));
});

test("mc_patients : la création reste bloquée pour un établissement à l'abonnement expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'subscriptions', 'HOSP-EXPIRED'), { status: 'expired' });
  });
  const nurse = env.authenticatedContext('nurse-expired', { role: 'nurse' }).firestore();
  await assertFails(setDoc(doc(nurse, 'mc_patients', 'MC-CREATE-4'), {
    id: 'MC-CREATE-4', establishmentId: 'HOSP-EXPIRED', created_by: 'nurse-expired',
  }));
});

// Correctif (audit sécurité) : la clause create accédait en notation
// pointée directe à request.resource.data.establishmentId/hospital_id
// — un document sans AUCUN des deux champs (flux mobile générique,
// js/patient.js saveNew(), hors contexte hôpital desktop) levait une
// erreur d'évaluation Firestore ("Property X is undefined") plutôt que
// d'être simplement refusé/accepté selon la règle métier, faisant
// systématiquement échouer la création. Remplacé par resolveHospitalId()
// (.get() sûr) : sans hospitalId du tout, l'abonnement par défaut reste
// "actif" (comportement rétro-compatible documenté), donc la création
// doit désormais réussir au lieu de crasher.
test('mc_patients : la création ne lève plus d\'erreur et réussit quand ni establishmentId ni hospital_id ne sont fournis (hors contexte hôpital)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-no-hosp', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_patients', 'MC-CREATE-5'), {
    id: 'MC-CREATE-5', firstname: 'Sans', lastname: 'Hopital', created_by: 'doctor-no-hosp',
  }));
});
