/* =====================================================
   Tests — règles Firestore : mc_prescriptions / pharmacien (PARTIE H)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedRx(env, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_prescriptions', id), data);
  });
}

test('mc_prescriptions : le pharmacien ciblé (pharmacyUid) peut lire son ordonnance', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRx(env, 'RX1', { patient_id: 'MC-R1', doctor_uid: 'doctor-1', pharmacyUid: 'pharma-1', status: 'sent', diagnosis: 'x', medicines: [] });
  const pharmacist = env.authenticatedContext('pharma-1', { role: 'pharmacist' }).firestore();
  await assertSucceeds(getDoc(doc(pharmacist, 'mc_prescriptions', 'RX1')));
});

test('mc_prescriptions : un pharmacien NON ciblé ne peut pas lire cette ordonnance', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRx(env, 'RX2', { patient_id: 'MC-R2', doctor_uid: 'doctor-2', pharmacyUid: 'pharma-2', status: 'sent' });
  const otherPharmacist = env.authenticatedContext('pharma-other', { role: 'pharmacist' }).firestore();
  await assertFails(getDoc(doc(otherPharmacist, 'mc_prescriptions', 'RX2')));
});

test('mc_prescriptions : le pharmacien ciblé peut mettre à jour le statut', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRx(env, 'RX3', { patient_id: 'MC-R3', doctor_uid: 'doctor-3', pharmacyUid: 'pharma-3', status: 'sent' });
  const pharmacist = env.authenticatedContext('pharma-3', { role: 'pharmacist' }).firestore();
  await assertSucceeds(updateDoc(doc(pharmacist, 'mc_prescriptions', 'RX3'), {
    status: 'received', updatedByUid: 'pharma-3', updatedByRole: 'pharmacist', updatedAt: '2026-07-11T00:00:00Z',
  }));
});

test('mc_prescriptions : le pharmacien NE PEUT PAS modifier le contenu médical (diagnosis/medicines/patient_id)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRx(env, 'RX4', { patient_id: 'MC-R4', doctor_uid: 'doctor-4', pharmacyUid: 'pharma-4', status: 'sent', diagnosis: 'grippe', medicines: [] });
  const pharmacist = env.authenticatedContext('pharma-4', { role: 'pharmacist' }).firestore();
  await assertFails(updateDoc(doc(pharmacist, 'mc_prescriptions', 'RX4'), {
    status: 'received', diagnosis: 'falsifié',
  }));
  await assertFails(updateDoc(doc(pharmacist, 'mc_prescriptions', 'RX4'), {
    status: 'received', patient_id: 'MC-AUTRE',
  }));
});

test('mc_prescriptions : le médecin auteur (role doctor) peut créer une ordonnance', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-5', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_prescriptions', 'RX5'), {
    patient_id: 'MC-R5', doctor_uid: 'doctor-5', created_by: 'doctor-5', status: 'sent',
  }));
});

test("mc_prescriptions : une infirmière (role nurse) ne peut PAS créer d'ordonnance", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const nurse = env.authenticatedContext('nurse-1', { role: 'nurse' }).firestore();
  await assertFails(setDoc(doc(nurse, 'mc_prescriptions', 'RX6'), {
    patient_id: 'MC-R6', doctor_uid: 'nurse-1', created_by: 'nurse-1', status: 'sent',
  }));
});

test("mc_prescriptions : un AUTRE médecin (non auteur, non même établissement) ne peut pas modifier l'ordonnance", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRx(env, 'RX7', { patient_id: 'MC-R7', doctor_uid: 'doctor-7', created_by: 'doctor-7', status: 'sent' });
  const otherDoctor = env.authenticatedContext('doctor-not-author', { role: 'doctor' }).firestore();
  await assertFails(updateDoc(doc(otherDoctor, 'mc_prescriptions', 'RX7'), { status: 'cancelled' }));
});
