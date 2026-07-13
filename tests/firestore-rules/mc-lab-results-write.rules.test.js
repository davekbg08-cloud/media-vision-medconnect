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
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_lab_results : un rôle lab peut écrire un résultat', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const lab = env.authenticatedContext('lab-1', { role: 'lab' }).firestore();
  await assertSucceeds(setDoc(doc(lab, 'mc_lab_results', 'LABR-1'), {
    lid: 'LABR-1', patient_id: 'MC-LABR-1', type: 'Glycémie', value: '0.9',
  }));
});

test('mc_lab_results : un rôle admin_hospital peut écrire un résultat', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const adminHospital = env.authenticatedContext('admin-hosp-1', { role: 'admin_hospital' }).firestore();
  await assertSucceeds(setDoc(doc(adminHospital, 'mc_lab_results', 'LABR-2'), {
    lid: 'LABR-2', patient_id: 'MC-LABR-2', type: 'Glycémie', value: '1.1',
  }));
});

test('mc_lab_results : un médecin peut toujours écrire un résultat (non-régression)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-labr-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_lab_results', 'LABR-3'), {
    lid: 'LABR-3', patient_id: 'MC-LABR-3', type: 'Glycémie', value: '1.0',
  }));
});

test("mc_lab_results : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharmacist = env.authenticatedContext('pharma-labr-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_lab_results', 'LABR-4'), {
    lid: 'LABR-4', patient_id: 'MC-LABR-4', type: 'Glycémie', value: '1.0',
  }));
});
