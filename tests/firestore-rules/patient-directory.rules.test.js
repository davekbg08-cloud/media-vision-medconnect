/* =====================================================
   Tests — règles Firestore : patient_directory
   (audit "workflows mobile/desktop", section 7)

   patient_directory est un miroir NON CLINIQUE de mc_patients destiné
   à réception/laboratoire (identité administrative seulement).
   Vérifie : lecture réservée à clinique/réception/lab (jamais
   pharmacist ni un tiers non affilié), et création restreinte aux
   champs non cliniques (keys().hasOnly()).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedMember(env, hospitalId, uid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, status: 'active' });
  });
}

async function seedRole(env, uid, role) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), { uid, role, status: 'approved' });
  });
}

async function seedDirectoryEntry(env, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'patient_directory', id), data);
  });
}

test('patient_directory : un membre reception de l\'établissement peut lire', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD', 'reception-pd-1');
  await seedRole(env, 'reception-pd-1', 'reception');
  await seedDirectoryEntry(env, 'MC-PD-1', { patientId: 'MC-PD-1', firstname: 'Jean', lastname: 'K', establishmentId: 'HOSP-PD' });
  const reception = env.authenticatedContext('reception-pd-1').firestore();
  await assertSucceeds(getDoc(doc(reception, 'patient_directory', 'MC-PD-1')));
});

test('patient_directory : un membre lab de l\'établissement peut lire', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD', 'lab-pd-1');
  await seedRole(env, 'lab-pd-1', 'lab');
  await seedDirectoryEntry(env, 'MC-PD-2', { patientId: 'MC-PD-2', firstname: 'Marie', lastname: 'T', establishmentId: 'HOSP-PD' });
  const lab = env.authenticatedContext('lab-pd-1').firestore();
  await assertSucceeds(getDoc(doc(lab, 'patient_directory', 'MC-PD-2')));
});

test('patient_directory : un médecin membre de l\'établissement peut lire', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD', 'doctor-pd-1');
  await seedRole(env, 'doctor-pd-1', 'doctor');
  await seedDirectoryEntry(env, 'MC-PD-3', { patientId: 'MC-PD-3', firstname: 'Paul', lastname: 'M', establishmentId: 'HOSP-PD' });
  const doctor = env.authenticatedContext('doctor-pd-1').firestore();
  await assertSucceeds(getDoc(doc(doctor, 'patient_directory', 'MC-PD-3')));
});

test("patient_directory : un membre pharmacist de l'établissement est refusé (aucune capacité sur l'annuaire patient)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD', 'pharmacist-pd-1');
  await seedRole(env, 'pharmacist-pd-1', 'pharmacist');
  await seedDirectoryEntry(env, 'MC-PD-4', { patientId: 'MC-PD-4', firstname: 'Grace', lastname: 'I', establishmentId: 'HOSP-PD' });
  const pharmacist = env.authenticatedContext('pharmacist-pd-1').firestore();
  await assertFails(getDoc(doc(pharmacist, 'patient_directory', 'MC-PD-4')));
});

test("patient_directory : un tiers non affilié à l'établissement est refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-OTHER', 'tiers-pd-1');
  await seedRole(env, 'tiers-pd-1', 'reception');
  await seedDirectoryEntry(env, 'MC-PD-5', { patientId: 'MC-PD-5', firstname: 'X', lastname: 'Y', establishmentId: 'HOSP-PD' });
  const tiers = env.authenticatedContext('tiers-pd-1').firestore();
  await assertFails(getDoc(doc(tiers, 'patient_directory', 'MC-PD-5')));
});

test('patient_directory : la réception peut créer une entrée avec uniquement des champs non cliniques', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD2', 'reception-pd-2');
  await seedRole(env, 'reception-pd-2', 'reception');
  const reception = env.authenticatedContext('reception-pd-2').firestore();
  await assertSucceeds(setDoc(doc(reception, 'patient_directory', 'MC-PD-6'), {
    patientId: 'MC-PD-6', firstname: 'Alice', lastname: 'K',
    establishmentId: 'HOSP-PD2', administrativeStatus: 'active',
  }));
});

test("patient_directory : la réception NE PEUT PAS glisser un champ clinique à la création (hasOnly)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD3', 'reception-pd-3');
  await seedRole(env, 'reception-pd-3', 'reception');
  const reception = env.authenticatedContext('reception-pd-3').firestore();
  await assertFails(setDoc(doc(reception, 'patient_directory', 'MC-PD-7'), {
    patientId: 'MC-PD-7', firstname: 'Bob', lastname: 'L',
    establishmentId: 'HOSP-PD3', administrativeStatus: 'active',
    allergies: 'Pénicilline',
  }));
});

test("patient_directory : un laborantin ne peut pas créer d'entrée (aucune capacité create côté client)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-PD4', 'lab-pd-2');
  await seedRole(env, 'lab-pd-2', 'lab');
  const lab = env.authenticatedContext('lab-pd-2').firestore();
  await assertFails(setDoc(doc(lab, 'patient_directory', 'MC-PD-8'), {
    patientId: 'MC-PD-8', firstname: 'Carla', lastname: 'N', establishmentId: 'HOSP-PD4',
  }));
});
