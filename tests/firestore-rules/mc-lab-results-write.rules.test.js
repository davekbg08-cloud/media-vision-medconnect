/* =====================================================
   Tests — règles Firestore : écriture de mc_lab_results par les rôles
   lab/admin_hospital

   Découvert en auditant le dépôt (synchronisation résultats labo
   desktop → patient) : hospital-lab.js saveResult() est accessible
   aux rôles lab/admin_hospital (canEnterLabResult(), déjà utilisée
   par la collection sœur labResults), mais mc_lab_results.write ne
   couvrait que doctor/nurse — rejetant systématiquement le miroir
   nécessaire pour que le patient voie ses résultats
   (js/lab.js renderForPatient, filtré sur patient_id).

   Mise à jour (chantier "modales laboratoire") : l'ancienne règle
   "allow write" n'appliquait AUCUNE isolation par établissement — un
   laborantin de N'IMPORTE QUEL hôpital pouvait écrire pour N'IMPORTE
   QUEL AUTRE établissement. Les écritures autorisées exigent
   désormais une affiliation active (hospitalMembers) à l'établissement
   de la fiche ET created_by == l'auteur réel ; les tests ci-dessous
   sont mis à jour pour fournir ce contexte.
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

test('mc_lab_results : un rôle lab affilié peut écrire un résultat pour son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-1', 'lab-1');
  const lab = env.authenticatedContext('lab-1', { role: 'lab' }).firestore();
  await assertSucceeds(setDoc(doc(lab, 'mc_lab_results', 'LABR-1'), {
    lid: 'LABR-1', patient_id: 'MC-LABR-1', type: 'Glycémie', value: '0.9',
    establishmentId: 'HOSP-LABR-1', created_by: 'lab-1',
  }));
});

test('mc_lab_results : un rôle admin_hospital affilié peut écrire un résultat', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-2', 'admin-hosp-1');
  const adminHospital = env.authenticatedContext('admin-hosp-1', { role: 'admin_hospital' }).firestore();
  await assertSucceeds(setDoc(doc(adminHospital, 'mc_lab_results', 'LABR-2'), {
    lid: 'LABR-2', patient_id: 'MC-LABR-2', type: 'Glycémie', value: '1.1',
    establishmentId: 'HOSP-LABR-2', created_by: 'admin-hosp-1',
  }));
});

test('mc_lab_results : un médecin affilié peut toujours écrire un résultat (non-régression)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-3', 'doctor-labr-1');
  const doctor = env.authenticatedContext('doctor-labr-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_lab_results', 'LABR-3'), {
    lid: 'LABR-3', patient_id: 'MC-LABR-3', type: 'Glycémie', value: '1.0',
    establishmentId: 'HOSP-LABR-3', created_by: 'doctor-labr-1',
  }));
});

test("mc_lab_results : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-4', 'pharma-labr-1');
  const pharmacist = env.authenticatedContext('pharma-labr-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_lab_results', 'LABR-4'), {
    lid: 'LABR-4', patient_id: 'MC-LABR-4', type: 'Glycémie', value: '1.0',
    establishmentId: 'HOSP-LABR-4', created_by: 'pharma-labr-1',
  }));
});

test("mc_lab_results : un laborantin NON affilié à l'établissement de la fiche ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  // lab-outsider-1 est affilié à HOSP-A, pas à HOSP-B (établissement de la fiche).
  await seedMember(env, 'HOSP-A', 'lab-outsider-1');
  const lab = env.authenticatedContext('lab-outsider-1', { role: 'lab' }).firestore();
  await assertFails(setDoc(doc(lab, 'mc_lab_results', 'LABR-5'), {
    lid: 'LABR-5', patient_id: 'MC-LABR-5', type: 'Glycémie', value: '1.0',
    establishmentId: 'HOSP-B', created_by: 'lab-outsider-1',
  }));
});

test('mc_lab_results : created_by doit être l\'auteur réel (pas un autre uid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-6', 'lab-6');
  const lab = env.authenticatedContext('lab-6', { role: 'lab' }).firestore();
  await assertFails(setDoc(doc(lab, 'mc_lab_results', 'LABR-6'), {
    lid: 'LABR-6', patient_id: 'MC-LABR-6', type: 'Glycémie', value: '1.0',
    establishmentId: 'HOSP-LABR-6', created_by: 'quelquun-dautre',
  }));
});

test("mc_lab_results : un résultat déjà émis ne peut plus être modifié par un laborantin (même affilié)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-LABR-7', 'lab-7');
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_lab_results', 'LABR-7'), {
      lid: 'LABR-7', patient_id: 'MC-LABR-7', type: 'Glycémie', value: '1.0',
      establishmentId: 'HOSP-LABR-7', created_by: 'lab-7',
    });
  });
  const lab = env.authenticatedContext('lab-7', { role: 'lab' }).firestore();
  await assertFails(setDoc(doc(lab, 'mc_lab_results', 'LABR-7'), {
    lid: 'LABR-7', patient_id: 'MC-LABR-7', type: 'Glycémie', value: '9.9',
    establishmentId: 'HOSP-LABR-7', created_by: 'lab-7',
  }));
});
