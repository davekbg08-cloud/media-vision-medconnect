/* =====================================================
   Tests — règles Firestore : création de mc_appointments

   Découvert en auditant le dépôt (même famille que mc_patients et
   establishments/hospitals) : mc_appointments n'avait QUE
   `allow write: if isAdmin()` — DB.addAppointment() (js/db.js), appelé
   par un médecin/infirmier/patient normal via js/appointments.js
   save(), ne pouvait donc jamais faire aboutir la création d'un
   rendez-vous. Miroir de la collection sœur /appointments (déjà
   correcte).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedExpiredSubscription(env, hospitalId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'subscriptions', hospitalId), { status: 'expired' });
  });
}

test('mc_appointments : un médecin peut créer un rendez-vous', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-apt-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_appointments', 'APT-1'), {
    aid: 'APT-1', patient_id: 'MC-APT-1', doctor: 'Dr. Test', date: '2026-08-01', time: '09:00',
    reason: 'Contrôle', status: 'pending', establishmentId: 'HOSP-APT',
  }));
});

test('mc_appointments : un infirmier peut créer un rendez-vous', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const nurse = env.authenticatedContext('nurse-apt-1', { role: 'nurse' }).firestore();
  await assertSucceeds(setDoc(doc(nurse, 'mc_appointments', 'APT-2'), {
    aid: 'APT-2', patient_id: 'MC-APT-2', doctor: 'Dr. Test', date: '2026-08-02', time: '10:00',
    reason: 'Contrôle', status: 'pending', establishmentId: 'HOSP-APT',
  }));
});

test('mc_appointments : un patient peut créer son propre rendez-vous (ownsPatientData)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const patient = env.authenticatedContext('patient-apt-1', { role: 'patient' }).firestore();
  await assertSucceeds(setDoc(doc(patient, 'mc_appointments', 'APT-3'), {
    aid: 'APT-3', patient_id: 'MC-APT-3', patient_uid: 'patient-apt-1', doctor: 'Dr. Test',
    date: '2026-08-03', time: '11:00', reason: 'Contrôle', status: 'pending',
  }));
});

test("mc_appointments : un rôle sans lien (ex. pharmacien) ne peut pas créer de rendez-vous pour un tiers", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharmacist = env.authenticatedContext('pharma-apt-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_appointments', 'APT-4'), {
    aid: 'APT-4', patient_id: 'MC-APT-4', doctor: 'Dr. Test', date: '2026-08-04', time: '12:00',
    reason: 'Contrôle', status: 'pending',
  }));
});

// La clause hospitalCanWriteFromDevice existait déjà ici (voir tests
// ci-dessus) mais restait un no-op tant que DB.addAppointment()
// (js/db.js) ne posait jamais sourceDevice — correctif appliqué en
// parallèle de ces tests.
test("mc_appointments : création refusée pour un desktop dont l'abonnement hôpital est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-APT-DEV-1');
  const doctor = env.authenticatedContext('doctor-apt-dev-1', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_appointments', 'APT-DEV-1'), {
    aid: 'APT-DEV-1', patient_id: 'MC-APT-DEV-1', doctor: 'Dr. Test', date: '2026-08-05', time: '09:00',
    reason: 'Contrôle', status: 'pending', establishmentId: 'HOSP-APT-DEV-1', sourceDevice: 'desktop',
  }));
});

test("mc_appointments : création acceptée pour un mobile même si l'abonnement hôpital est expiré (le soin courant n'est jamais coupé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-APT-DEV-2');
  const doctor = env.authenticatedContext('doctor-apt-dev-2', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_appointments', 'APT-DEV-2'), {
    aid: 'APT-DEV-2', patient_id: 'MC-APT-DEV-2', doctor: 'Dr. Test', date: '2026-08-06', time: '10:00',
    reason: 'Contrôle', status: 'pending', establishmentId: 'HOSP-APT-DEV-2', sourceDevice: 'mobile',
  }));
});
