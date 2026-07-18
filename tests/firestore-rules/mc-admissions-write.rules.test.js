/* =====================================================
   Tests — règles Firestore : écriture de mc_admissions (miroir
   patient de la collection desktop admissions)

   Découvert en auditant le dépôt (synchronisation dossier patient) :
   le filtre "🏥 Hospitalisation" du dossier patient (js/timeline.js)
   existait déjà côté interface mais n'était jamais alimenté — la
   collection desktop `admissions` (patientMc) n'était jamais lue par
   le patient. mc_admissions est le miroir, même principe que
   mc_lab_results.

   Mise à jour (audit sécurité) : "allow write" n'appliquait AUCUNE
   isolation par établissement — un médecin/infirmier/réceptionniste/
   admin_hospital réellement affilié à l'hôpital A pouvait créer,
   modifier ou supprimer une admission de l'hôpital B. Les écritures
   autorisées exigent désormais une affiliation active (hospitalMembers)
   à l'établissement de la fiche ; les tests ci-dessous sont mis à jour
   pour fournir ce contexte, comme pour mc_lab_results.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

async function seedMember(env, hospitalId, uid) {
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, status: 'active' });
  });
}

test('mc_admissions : un médecin affilié peut écrire une admission de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ADM-1', 'doctor-adm-1');
  const doctor = env.authenticatedContext('doctor-adm-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_admissions', 'ADM-1'), {
    aid: 'ADM-1', patient_id: 'MC-ADM-1', bedId: 'B1', reason: 'Observation', status: 'admitted',
    establishmentId: 'HOSP-ADM-1',
  }));
});

test('mc_admissions : un rôle reception affilié peut écrire une admission de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ADM-2', 'reception-adm-1');
  const reception = env.authenticatedContext('reception-adm-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_admissions', 'ADM-2'), {
    aid: 'ADM-2', patient_id: 'MC-ADM-2', bedId: 'B2', reason: 'Urgence', status: 'admitted',
    establishmentId: 'HOSP-ADM-2',
  }));
});

test('mc_admissions : un rôle admin_hospital affilié peut écrire une admission de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ADM-3', 'admin-hosp-adm-1');
  const adminHospital = env.authenticatedContext('admin-hosp-adm-1', { role: 'admin_hospital' }).firestore();
  await assertSucceeds(setDoc(doc(adminHospital, 'mc_admissions', 'ADM-3'), {
    aid: 'ADM-3', patient_id: 'MC-ADM-3', bedId: 'B3', reason: 'Suivi', status: 'admitted',
    establishmentId: 'HOSP-ADM-3',
  }));
});

test("mc_admissions : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ADM-4', 'pharma-adm-1');
  const pharmacist = env.authenticatedContext('pharma-adm-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_admissions', 'ADM-4'), {
    aid: 'ADM-4', patient_id: 'MC-ADM-4', bedId: 'B4', reason: 'Test', status: 'admitted',
    establishmentId: 'HOSP-ADM-4',
  }));
});

test("mc_admissions : un médecin NON affilié à l'établissement de la fiche ne peut pas écrire (isolation inter-établissements)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  // doctor-outsider-1 est affilié à HOSP-A, pas à HOSP-B (établissement de la fiche).
  await seedMember(env, 'HOSP-A', 'doctor-outsider-1');
  const doctor = env.authenticatedContext('doctor-outsider-1', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_admissions', 'ADM-5'), {
    aid: 'ADM-5', patient_id: 'MC-ADM-5', bedId: 'B5', reason: 'Test', status: 'admitted',
    establishmentId: 'HOSP-B',
  }));
});
