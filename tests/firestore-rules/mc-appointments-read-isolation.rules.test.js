/* =====================================================
   Tests — règles Firestore : lecture de mc_appointments

   Correctif (audit sécurité) : contrairement à mc_consultations/
   mc_lab_results/mc_prescriptions, mc_appointments n'avait ni
   l'isolation par établissement (belongsToSameEstablishment) ni la
   passerelle d'abonnement (subscriptionReadGateOk) — un membre de
   l'établissement ne voyait pas les rendez-vous de ses collègues, et
   un rendez-vous créé côté desktop restait visible au médecin/
   infirmier(ère) sur mobile même abonnement expiré. Ajout ADDITIF du
   même principe déjà appliqué aux collections sœurs.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

async function seedExpiredSubscription(env, hospitalId) {
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'subscriptions', hospitalId), { status: 'expired' });
  });
}

async function seedMember(env, hospitalId, uid, role) {
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, role, status: 'active' });
  });
}

test("mc_appointments : un médecin affilié à l'établissement peut lire le rendez-vous d'un(e) collègue", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-APR-1', 'doctor-apr-1', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_appointments', 'APR-1'), {
      aid: 'APR-1', patient_id: 'MC-APR-1', establishmentId: 'HOSP-APR-1', doctor: 'Dr. Autre',
    });
  });
  const doctor = env.authenticatedContext('doctor-apr-1', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_appointments', 'APR-1')));
});

test("mc_appointments : un médecin NON affilié à l'établissement ne peut pas lire ce rendez-vous (isolation inter-établissements)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'doctor-apr-outsider', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_appointments', 'APR-2'), {
      aid: 'APR-2', patient_id: 'MC-APR-2', establishmentId: 'HOSP-B', doctor: 'Dr. Autre',
    });
  });
  const doctor = env.authenticatedContext('doctor-apr-outsider', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'mc_appointments', 'APR-2')));
});

test("mc_appointments : médecin lisant un rendez-vous créé côté DESKTOP est refusé si l'abonnement de l'établissement est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-APR-3');
  await seedMember(env, 'HOSP-APR-3', 'doctor-apr-3', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_appointments', 'APR-3'), {
      aid: 'APR-3', patient_id: 'MC-APR-3', establishmentId: 'HOSP-APR-3', sourceDevice: 'desktop',
    });
  });
  const doctor = env.authenticatedContext('doctor-apr-3', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'mc_appointments', 'APR-3')));
});

test("mc_appointments : médecin lisant un rendez-vous créé côté MOBILE reste ACCEPTÉ même abonnement expiré (mobile jamais coupé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-APR-4');
  await seedMember(env, 'HOSP-APR-4', 'doctor-apr-4', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_appointments', 'APR-4'), {
      aid: 'APR-4', patient_id: 'MC-APR-4', establishmentId: 'HOSP-APR-4', sourceDevice: 'mobile',
    });
  });
  const doctor = env.authenticatedContext('doctor-apr-4', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_appointments', 'APR-4')));
});

test("mc_appointments : le patient concerné lit toujours son propre rendez-vous, même créé côté desktop et abonnement expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-APR-5');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_appointments', 'APR-5'), {
      aid: 'APR-5', patient_id: 'MC-APR-5', patient_uid: 'patient-apr-5',
      establishmentId: 'HOSP-APR-5', sourceDevice: 'desktop',
    });
  });
  const patient = env.authenticatedContext('patient-apr-5', { role: 'patient' }).firestore();
  await assertSucceeds(getDoc(doc(patient, 'mc_appointments', 'APR-5')));
});
