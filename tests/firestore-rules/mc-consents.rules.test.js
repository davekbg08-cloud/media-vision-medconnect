/* =====================================================
   Tests — règles Firestore : mc_consents (PARTIE D)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedPatientAccount(env, patientId, authUid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', `PAT_${patientId}`), {
      uid: `PAT_${patientId}`, role: 'patient', status: 'approved', authUid,
    });
  });
}

async function seedConsent(env, cid, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_consents', cid), { cid, ...data });
  });
}

test('mc_consents : le médecin demandeur peut créer sa propre demande (statut pending)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C1', 'patient-auth-1');
  const doctor = env.authenticatedContext('doctor-1').firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_consents', 'CON1'), {
    cid: 'CON1', patient_id: 'MC-C1', doctor_id: 'doctor-1', status: 'pending',
  }));
});

test("mc_consents : impossible de créer une demande au nom d'un autre médecin", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C2', 'patient-auth-2');
  const doctor = env.authenticatedContext('doctor-2').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_consents', 'CON2'), {
    cid: 'CON2', patient_id: 'MC-C2', doctor_id: 'un-autre-medecin', status: 'pending',
  }));
});

test('mc_consents : impossible de créer directement un consentement déjà "approved"', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C3', 'patient-auth-3');
  const doctor = env.authenticatedContext('doctor-3').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_consents', 'CON3'), {
    cid: 'CON3', patient_id: 'MC-C3', doctor_id: 'doctor-3', status: 'approved',
  }));
});

test('mc_consents : un tiers ne peut pas lire un consentement qui ne le concerne pas', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C4', 'patient-auth-4');
  await seedConsent(env, 'CON4', { patient_id: 'MC-C4', doctor_id: 'doctor-4', status: 'pending' });
  const tiers = env.authenticatedContext('un-tiers-quelconque').firestore();
  await assertFails(getDoc(doc(tiers, 'mc_consents', 'CON4')));
});

test('mc_consents : le patient concerné peut lire son propre consentement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C5', 'patient-auth-5');
  await seedConsent(env, 'CON5', { patient_id: 'MC-C5', doctor_id: 'doctor-5', status: 'pending' });
  const patient = env.authenticatedContext('patient-auth-5').firestore();
  await assertSucceeds(getDoc(doc(patient, 'mc_consents', 'CON5')));
});

test('mc_consents : le patient concerné peut approuver (status uniquement)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C6', 'patient-auth-6');
  await seedConsent(env, 'CON6', { patient_id: 'MC-C6', doctor_id: 'doctor-6', status: 'pending' });
  const patient = env.authenticatedContext('patient-auth-6').firestore();
  await assertSucceeds(updateDoc(doc(patient, 'mc_consents', 'CON6'), {
    status: 'approved', decided_at: '2026-07-11', expires_at: '2026-08-10',
  }));
});

test("mc_consents : un AUTRE patient ne peut pas approuver le consentement de quelqu'un d'autre", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C7', 'patient-auth-7');
  await seedPatientAccount(env, 'MC-C7B', 'un-autre-patient');
  await seedConsent(env, 'CON7', { patient_id: 'MC-C7', doctor_id: 'doctor-7', status: 'pending' });
  const otherPatient = env.authenticatedContext('un-autre-patient').firestore();
  await assertFails(updateDoc(doc(otherPatient, 'mc_consents', 'CON7'), { status: 'approved' }));
});

test('mc_consents : le médecin demandeur ne peut PAS approuver sa propre demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C8', 'patient-auth-8');
  await seedConsent(env, 'CON8', { patient_id: 'MC-C8', doctor_id: 'doctor-8', status: 'pending' });
  const doctor = env.authenticatedContext('doctor-8').firestore();
  await assertFails(updateDoc(doc(doctor, 'mc_consents', 'CON8'), { status: 'approved' }));
});

test('mc_consents : le médecin demandeur PEUT révoquer sa propre demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C9', 'patient-auth-9');
  await seedConsent(env, 'CON9', { patient_id: 'MC-C9', doctor_id: 'doctor-9', status: 'approved' });
  const doctor = env.authenticatedContext('doctor-9').firestore();
  await assertSucceeds(updateDoc(doc(doctor, 'mc_consents', 'CON9'), { status: 'revoked', decided_at: '2026-07-11' }));
});

test("mc_consents : un utilisateur quelconque ne peut pas fabriquer une approbation pour un consentement dont il n'est ni le patient ni le médecin", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPatientAccount(env, 'MC-C10', 'patient-auth-10');
  await seedConsent(env, 'CON10', { patient_id: 'MC-C10', doctor_id: 'doctor-10', status: 'pending' });
  const randomUser = env.authenticatedContext('random-doctor-not-involved').firestore();
  await assertFails(updateDoc(doc(randomUser, 'mc_consents', 'CON10'), { status: 'approved' }));
});
