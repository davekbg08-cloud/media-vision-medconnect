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

/* ── Chantier "reception/affiliation sans régression" — section 4 ──
   Bug confirmé : la matrice client (js/hospital-capabilities.js)
   autorise déjà la réception à créer un patient, mais aucune clause
   create ne couvrait ce rôle — receptionPatientCreateOk() couvre
   désormais ce cas, limité à des champs administratifs. */
async function seedReceptionMember(env, uid, hospitalId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalMembers', `${hospitalId}_${uid}`),
      { hospitalId, uid, status: 'active' });
  });
}

test('mc_patients : la réception peut créer une fiche (champs administratifs) pour son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-1', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_patients', 'MC-RC-1'), {
    id: 'MC-RC-1', firstname: 'Jean', lastname: 'Réception', dob: '1990-01-01',
    gender: 'M', phone: '0102030405', establishmentId: 'HOSP-RC',
    created_by: 'reception-1', created_by_role: 'reception', created_at: '2026-01-01',
  }));
});

test("mc_patients : la réception NE PEUT PAS poser un champ clinique (allergies) à la création", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-2', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-2', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'mc_patients', 'MC-RC-2'), {
    id: 'MC-RC-2', firstname: 'Jean', lastname: 'Réception', establishmentId: 'HOSP-RC',
    created_by: 'reception-2', allergies: 'Pénicilline',
  }));
});

test("mc_patients : la réception NE PEUT PAS créer de fiche pour un AUTRE établissement (non-membre)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-3', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-3', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'mc_patients', 'MC-RC-3'), {
    id: 'MC-RC-3', firstname: 'Jean', lastname: 'Réception', establishmentId: 'HOSP-OTHER',
    created_by: 'reception-3',
  }));
});

test('medical_records : la réception peut créer le document racine patient_record', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-4', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-4', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'medical_records', 'MC-RC-4'), {
    recordId: 'MC-RC-4', patientId: 'MC-RC-4', establishmentId: 'HOSP-RC',
    type: 'patient_record', status: 'active', created_by: 'reception-4',
  }));
});

test("medical_records : la réception NE PEUT PAS créer un document de type clinique (consultation)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-5', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-5', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'medical_records', 'MC-RC-5'), {
    recordId: 'MC-RC-5', patientId: 'MC-RC-5', establishmentId: 'HOSP-RC',
    type: 'consultation', created_by: 'reception-5',
  }));
});

/* ── Correctif (audit "workflows mobile/desktop", section 6) ───────
   Bug confirmé : la clause reception ne vérifiait QUE type ==
   'patient_record' et l'appartenance — aucun champ n'était interdit.
   Un document patient_record portant EN PLUS un champ clinique était
   donc accepté tant que le type restait correct. keys().hasOnly()
   ferme cette faille. */
test("medical_records : la réception NE PEUT PAS glisser un champ clinique (diagnosis) même avec type == patient_record", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-6', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-6', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'medical_records', 'MC-RC-6'), {
    recordId: 'MC-RC-6', patientId: 'MC-RC-6', establishmentId: 'HOSP-RC',
    type: 'patient_record', status: 'active', created_by: 'reception-6',
    diagnosis: 'Fabriqué par la réception',
  }));
});

test("medical_records : la réception NE PEUT PAS poser un created_by différent de son propre uid (anti-usurpation)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedReceptionMember(env, 'reception-7', 'HOSP-RC');
  const reception = env.authenticatedContext('reception-7', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'medical_records', 'MC-RC-7'), {
    recordId: 'MC-RC-7', patientId: 'MC-RC-7', establishmentId: 'HOSP-RC',
    type: 'patient_record', status: 'active', created_by: 'quelquun-dautre',
  }));
});
