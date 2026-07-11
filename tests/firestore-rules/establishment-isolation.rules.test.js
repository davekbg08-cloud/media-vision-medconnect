/* =====================================================
   Tests — règles Firestore : isolation par établissement (PARTIE E)

   Cas central de la clarification client : un médecin/infirmier membre
   de l'établissement CRÉATEUR d'une fiche accède SANS consentement
   (mc_consents n'intervient jamais ici) ; un médecin d'un AUTRE
   établissement, sans affiliation, est refusé.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedMember(env, hospitalId, uid, status = 'active') {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, status });
  });
}

async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, collection, id), data);
  });
}

test('mc_patients : médecin membre du même établissement, NON auteur, lit la fiche SANS mc_consents', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'doctor-member-1');
  await seedDoc(env, 'mc_patients', 'MC-E1', { id: 'MC-E1', establishmentId: 'HOSP-A', created_by: 'nurse-creator-1' });
  // Aucun document mc_consents créé — l'accès ne doit PAS en dépendre.
  const doctor = env.authenticatedContext('doctor-member-1').firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_patients', 'MC-E1')));
});

test("mc_patients : médecin d'un AUTRE établissement (aucune affiliation) est refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-B', 'doctor-outsider-1');
  await seedDoc(env, 'mc_patients', 'MC-E2', { id: 'MC-E2', establishmentId: 'HOSP-A', created_by: 'nurse-creator-2' });
  const outsider = env.authenticatedContext('doctor-outsider-1').firestore();
  await assertFails(getDoc(doc(outsider, 'mc_patients', 'MC-E2')));
});

test('mc_patients : membre retiré (status "removed") perd son accès établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'doctor-removed-1', 'removed');
  await seedDoc(env, 'mc_patients', 'MC-E3', { id: 'MC-E3', establishmentId: 'HOSP-A', created_by: 'nurse-creator-3' });
  const removedDoctor = env.authenticatedContext('doctor-removed-1').firestore();
  await assertFails(getDoc(doc(removedDoctor, 'mc_patients', 'MC-E3')));
});

test('mc_consultations : infirmier membre du même établissement lit sans être auteur', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'nurse-member-1');
  await seedDoc(env, 'mc_consultations', 'CONS1', { patient_id: 'MC-E4', establishmentId: 'HOSP-A', doctor_uid: 'doctor-author-1' });
  const nurse = env.authenticatedContext('nurse-member-1').firestore();
  await assertSucceeds(getDoc(doc(nurse, 'mc_consultations', 'CONS1')));
});

test("mc_consultations : personnel d'un autre établissement refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-B', 'nurse-outsider-1');
  await seedDoc(env, 'mc_consultations', 'CONS2', { patient_id: 'MC-E5', establishmentId: 'HOSP-A', doctor_uid: 'doctor-author-2' });
  const outsider = env.authenticatedContext('nurse-outsider-1').firestore();
  await assertFails(getDoc(doc(outsider, 'mc_consultations', 'CONS2')));
});

test('labRequests : membre du même établissement lit sans être auteur', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'lab-member-1');
  await seedDoc(env, 'labRequests', 'LR1', { patient_id: 'MC-E6', establishmentId: 'HOSP-A' });
  const member = env.authenticatedContext('lab-member-1').firestore();
  await assertSucceeds(getDoc(doc(member, 'labRequests', 'LR1')));
});

test("labRequests : personnel d'un autre établissement refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-B', 'lab-outsider-1');
  await seedDoc(env, 'labRequests', 'LR2', { patient_id: 'MC-E7', establishmentId: 'HOSP-A' });
  const outsider = env.authenticatedContext('lab-outsider-1').firestore();
  await assertFails(getDoc(doc(outsider, 'labRequests', 'LR2')));
});

test('admissions : membre du même établissement lit sans être auteur', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'nurse-member-2');
  await seedDoc(env, 'admissions', 'ADM1', { patient_id: 'MC-E8', establishmentId: 'HOSP-A' });
  const member = env.authenticatedContext('nurse-member-2').firestore();
  await assertSucceeds(getDoc(doc(member, 'admissions', 'ADM1')));
});

test("admissions : personnel d'un autre établissement refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-B', 'nurse-outsider-2');
  await seedDoc(env, 'admissions', 'ADM2', { patient_id: 'MC-E9', establishmentId: 'HOSP-A' });
  const outsider = env.authenticatedContext('nurse-outsider-2').firestore();
  await assertFails(getDoc(doc(outsider, 'admissions', 'ADM2')));
});

test("hospitalMembers : un utilisateur ne peut écrire QUE son propre document (auto-guérison)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('self-heal-uid-1').firestore();
  await assertSucceeds(setDoc(doc(user, 'hospitalMembers', 'HOSP-A_self-heal-uid-1'), {
    hospitalId: 'HOSP-A', uid: 'self-heal-uid-1', status: 'active',
  }));
});

test("hospitalMembers : un utilisateur ne peut PAS écrire le document d'appartenance d'un autre (anti-usurpation)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-uid').firestore();
  await assertFails(setDoc(doc(attacker, 'hospitalMembers', 'HOSP-A_victim-uid'), {
    hospitalId: 'HOSP-A', uid: 'victim-uid', status: 'active',
  }));
});
