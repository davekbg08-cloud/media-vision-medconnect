/* =====================================================
   Tests — règles Firestore : écriture de mc_admissions (miroir
   patient de la collection desktop admissions)

   Découvert en auditant le dépôt (synchronisation dossier patient) :
   le filtre "🏥 Hospitalisation" du dossier patient (js/timeline.js)
   existait déjà côté interface mais n'était jamais alimenté — la
   collection desktop `admissions` (patientMc) n'était jamais lue par
   le patient. mc_admissions est le miroir, même principe que
   mc_lab_results.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_admissions : un médecin peut écrire une admission', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-adm-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_admissions', 'ADM-1'), {
    aid: 'ADM-1', patient_id: 'MC-ADM-1', bedId: 'B1', reason: 'Observation', status: 'admitted',
  }));
});

test('mc_admissions : un rôle reception peut écrire une admission', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const reception = env.authenticatedContext('reception-adm-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_admissions', 'ADM-2'), {
    aid: 'ADM-2', patient_id: 'MC-ADM-2', bedId: 'B2', reason: 'Urgence', status: 'admitted',
  }));
});

test('mc_admissions : un rôle admin_hospital peut écrire une admission', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const adminHospital = env.authenticatedContext('admin-hosp-adm-1', { role: 'admin_hospital' }).firestore();
  await assertSucceeds(setDoc(doc(adminHospital, 'mc_admissions', 'ADM-3'), {
    aid: 'ADM-3', patient_id: 'MC-ADM-3', bedId: 'B3', reason: 'Suivi', status: 'admitted',
  }));
});

test("mc_admissions : un rôle sans lien (ex. pharmacien) ne peut pas écrire", () => {
  return (async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const pharmacist = env.authenticatedContext('pharma-adm-1', { role: 'pharmacist' }).firestore();
    await assertFails(setDoc(doc(pharmacist, 'mc_admissions', 'ADM-4'), {
      aid: 'ADM-4', patient_id: 'MC-ADM-4', bedId: 'B4', reason: 'Test', status: 'admitted',
    }));
  })();
});
