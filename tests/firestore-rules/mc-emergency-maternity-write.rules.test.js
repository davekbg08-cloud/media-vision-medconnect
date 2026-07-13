/* =====================================================
   Tests — règles Firestore : écriture de mc_emergency_cases /
   mc_maternity_cases (miroirs patient des collections desktop
   emergencyCases/maternityCases)

   Découvert en auditant le dépôt (synchronisation dossier patient) :
   un passage aux urgences ou un dossier de grossesse saisi côté
   desktop n'était jamais visible au patient — emergencyCases/
   maternityCases (patientMc) ne sont lues que par leur propre module
   desktop. Même principe de miroir que mc_lab_results/mc_admissions.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_emergency_cases : un médecin peut écrire un passage aux urgences', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-er-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_emergency_cases', 'ER-1'), {
    eid: 'ER-1', patient_id: 'MC-ER-1', complaint: 'Douleur thoracique', status: 'waiting',
  }));
});

test("mc_emergency_cases : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharmacist = env.authenticatedContext('pharma-er-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_emergency_cases', 'ER-2'), {
    eid: 'ER-2', patient_id: 'MC-ER-2', complaint: 'Test', status: 'waiting',
  }));
});

test('mc_maternity_cases : un rôle reception peut créer un dossier de grossesse', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const reception = env.authenticatedContext('reception-mat-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_maternity_cases', 'MAT-1'), {
    mid: 'MAT-1', patient_id: 'MC-MAT-1', lmpDate: '2026-01-01', status: 'prenatal',
  }));
});

test("mc_maternity_cases : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharmacist = env.authenticatedContext('pharma-mat-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_maternity_cases', 'MAT-2'), {
    mid: 'MAT-2', patient_id: 'MC-MAT-2', lmpDate: '2026-01-01', status: 'prenatal',
  }));
});
