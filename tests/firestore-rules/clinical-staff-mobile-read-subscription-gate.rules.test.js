/* =====================================================
   Tests — règles Firestore : lecture du dossier médical par le
   personnel clinique, gatée par abonnement pour le contenu créé côté
   desktop (retour utilisateur : "les ordonnances créées sur desktop ne
   doivent être visibles côté médecin/infirmier que si l'abonnement est
   actif ; le contenu créé côté mobile reste toujours visible, sans
   changer la logique existante")

   ⚠️ Limite technique documentée dans firestore.rules
   (clinicalStaffCanReadDesktopContent) : les règles ne distinguent pas
   une lecture mobile d'une lecture desktop pour un même compte
   Firebase — seul sourceDevice, déclaré sur le document à sa création,
   est disponible. Le médecin/infirmier(ère) auteur direct est donc
   logiquement soumis à la même règle. Le patient n'est JAMAIS concerné
   (ownsPatientData reste inconditionnel) ; ni les autres rôles (lab,
   pharmacien, admin_hospital, admin) qui lisent ces collections pour
   d'autres raisons.
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

/* ── mc_prescriptions ── */

test("mc_prescriptions : médecin lisant une ordonnance créée côté DESKTOP est refusé si l'abonnement de l'établissement est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RXR-1');
  await seedMember(env, 'HOSP-RXR-1', 'doctor-rxr-1', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-1'), {
      pid: 'RXR-1', patient_id: 'MC-RXR-1', establishmentId: 'HOSP-RXR-1', sourceDevice: 'desktop', medicines: [],
    });
  });
  const doctor = env.authenticatedContext('doctor-rxr-1', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'mc_prescriptions', 'RXR-1')));
});

test("mc_prescriptions : infirmier(ère) lisant une ordonnance créée côté DESKTOP est refusé si l'abonnement est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RXR-2');
  await seedMember(env, 'HOSP-RXR-2', 'nurse-rxr-2', 'nurse');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-2'), {
      pid: 'RXR-2', patient_id: 'MC-RXR-2', establishmentId: 'HOSP-RXR-2', sourceDevice: 'desktop', medicines: [],
    });
  });
  const nurse = env.authenticatedContext('nurse-rxr-2', { role: 'nurse' }).firestore();
  await assertFails(getDoc(doc(nurse, 'mc_prescriptions', 'RXR-2')));
});

test("mc_prescriptions : médecin lisant une ordonnance créée côté DESKTOP réussit si l'abonnement est actif", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-RXR-3', 'doctor-rxr-3', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-3'), {
      pid: 'RXR-3', patient_id: 'MC-RXR-3', establishmentId: 'HOSP-RXR-3', sourceDevice: 'desktop', medicines: [],
    });
  });
  const doctor = env.authenticatedContext('doctor-rxr-3', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_prescriptions', 'RXR-3')));
});

test("mc_prescriptions : médecin lisant une ordonnance créée côté MOBILE reste autorisé même si l'abonnement est expiré (jamais coupé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RXR-4');
  await seedMember(env, 'HOSP-RXR-4', 'doctor-rxr-4', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-4'), {
      pid: 'RXR-4', patient_id: 'MC-RXR-4', establishmentId: 'HOSP-RXR-4', sourceDevice: 'mobile', medicines: [],
    });
  });
  const doctor = env.authenticatedContext('doctor-rxr-4', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_prescriptions', 'RXR-4')));
});

test("mc_prescriptions : le PATIENT concerné reste toujours autorisé à lire son ordonnance desktop, abonnement expiré ou non", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RXR-5');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-5'), {
      pid: 'RXR-5', patient_id: 'MC-RXR-5', establishmentId: 'HOSP-RXR-5', sourceDevice: 'desktop',
      medicines: [], uid: 'patient-rxr-5',
    });
  });
  const patient = env.authenticatedContext('patient-rxr-5').firestore();
  await assertSucceeds(getDoc(doc(patient, 'mc_prescriptions', 'RXR-5')));
});

test("mc_prescriptions : le pharmacien ciblé reste toujours autorisé à lire l'ordonnance desktop, abonnement expiré ou non", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RXR-6');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_prescriptions', 'RXR-6'), {
      pid: 'RXR-6', patient_id: 'MC-RXR-6', establishmentId: 'HOSP-RXR-6', sourceDevice: 'desktop',
      medicines: [], pharmacyUid: 'pharma-rxr-6',
    });
  });
  const pharmacist = env.authenticatedContext('pharma-rxr-6', { role: 'pharmacist' }).firestore();
  await assertSucceeds(getDoc(doc(pharmacist, 'mc_prescriptions', 'RXR-6')));
});

/* ── mc_consultations ── */

test("mc_consultations : médecin lisant une consultation créée côté DESKTOP est refusé si l'abonnement est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-CR-1');
  await seedMember(env, 'HOSP-CR-1', 'doctor-cr-1', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_consultations', 'CR-1'), {
      cid: 'CR-1', patient_id: 'MC-CR-1', establishmentId: 'HOSP-CR-1', sourceDevice: 'desktop',
    });
  });
  const doctor = env.authenticatedContext('doctor-cr-1', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'mc_consultations', 'CR-1')));
});

test("mc_consultations : médecin lisant une consultation créée côté MOBILE reste autorisé même abonnement expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-CR-2');
  await seedMember(env, 'HOSP-CR-2', 'doctor-cr-2', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_consultations', 'CR-2'), {
      cid: 'CR-2', patient_id: 'MC-CR-2', establishmentId: 'HOSP-CR-2', sourceDevice: 'mobile',
    });
  });
  const doctor = env.authenticatedContext('doctor-cr-2', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_consultations', 'CR-2')));
});

/* ── mc_lab_results ── */

test("mc_lab_results : médecin lisant un résultat créé côté DESKTOP est refusé si l'abonnement est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-LR-1');
  await seedMember(env, 'HOSP-LR-1', 'doctor-lr-1', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_lab_results', 'LR-1'), {
      patient_id: 'MC-LR-1', establishmentId: 'HOSP-LR-1', sourceDevice: 'desktop', created_by: 'lab-lr-1',
    });
  });
  const doctor = env.authenticatedContext('doctor-lr-1', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'mc_lab_results', 'LR-1')));
});

test("mc_lab_results : le laborantin affilié reste toujours autorisé à lire, abonnement expiré ou non", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-LR-2');
  await seedMember(env, 'HOSP-LR-2', 'lab-lr-2', 'lab');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_lab_results', 'LR-2'), {
      patient_id: 'MC-LR-2', establishmentId: 'HOSP-LR-2', sourceDevice: 'desktop', created_by: 'lab-lr-2',
    });
  });
  const lab = env.authenticatedContext('lab-lr-2', { role: 'lab' }).firestore();
  await assertSucceeds(getDoc(doc(lab, 'mc_lab_results', 'LR-2')));
});

test("mc_lab_results : médecin lisant un résultat créé côté MOBILE reste autorisé même abonnement expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-LR-3');
  await seedMember(env, 'HOSP-LR-3', 'doctor-lr-3', 'doctor');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_lab_results', 'LR-3'), {
      patient_id: 'MC-LR-3', establishmentId: 'HOSP-LR-3', sourceDevice: 'mobile', created_by: 'doctor-lr-3',
    });
  });
  const doctor = env.authenticatedContext('doctor-lr-3', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_lab_results', 'LR-3')));
});
