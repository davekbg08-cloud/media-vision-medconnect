/* =====================================================
   Tests — règles Firestore : écriture de mc_emergency_cases /
   mc_maternity_cases (miroirs patient des collections desktop
   emergencyCases/maternityCases)

   Découvert en auditant le dépôt (synchronisation dossier patient) :
   un passage aux urgences ou un dossier de grossesse saisi côté
   desktop n'était jamais visible au patient — emergencyCases/
   maternityCases (patientMc) ne sont lues que par leur propre module
   desktop. Même principe de miroir que mc_lab_results/mc_admissions.

   Mise à jour (audit sécurité) : "allow write" n'appliquait AUCUNE
   isolation par établissement — même défaut que mc_admissions. Les
   écritures autorisées exigent désormais une affiliation active
   (hospitalMembers) à l'établissement de la fiche ; les tests
   ci-dessous sont mis à jour pour fournir ce contexte.
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

test('mc_emergency_cases : un médecin affilié peut écrire un passage aux urgences de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ER-1', 'doctor-er-1');
  const doctor = env.authenticatedContext('doctor-er-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_emergency_cases', 'ER-1'), {
    eid: 'ER-1', patient_id: 'MC-ER-1', complaint: 'Douleur thoracique', status: 'waiting',
    establishmentId: 'HOSP-ER-1',
  }));
});

test("mc_emergency_cases : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-ER-2', 'pharma-er-1');
  const pharmacist = env.authenticatedContext('pharma-er-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_emergency_cases', 'ER-2'), {
    eid: 'ER-2', patient_id: 'MC-ER-2', complaint: 'Test', status: 'waiting',
    establishmentId: 'HOSP-ER-2',
  }));
});

test("mc_emergency_cases : un médecin NON affilié à l'établissement de la fiche ne peut pas écrire (isolation inter-établissements)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'doctor-er-outsider');
  const doctor = env.authenticatedContext('doctor-er-outsider', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_emergency_cases', 'ER-3'), {
    eid: 'ER-3', patient_id: 'MC-ER-3', complaint: 'Test', status: 'waiting',
    establishmentId: 'HOSP-B',
  }));
});

test('mc_maternity_cases : un rôle reception affilié peut créer un dossier de grossesse de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-MAT-1', 'reception-mat-1');
  const reception = env.authenticatedContext('reception-mat-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_maternity_cases', 'MAT-1'), {
    mid: 'MAT-1', patient_id: 'MC-MAT-1', lmpDate: '2026-01-01', status: 'prenatal',
    establishmentId: 'HOSP-MAT-1',
  }));
});

test("mc_maternity_cases : un rôle sans lien (ex. pharmacien) ne peut pas écrire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-MAT-2', 'pharma-mat-1');
  const pharmacist = env.authenticatedContext('pharma-mat-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_maternity_cases', 'MAT-2'), {
    mid: 'MAT-2', patient_id: 'MC-MAT-2', lmpDate: '2026-01-01', status: 'prenatal',
    establishmentId: 'HOSP-MAT-2',
  }));
});

test("mc_maternity_cases : un rôle reception NON affilié à l'établissement de la fiche ne peut pas écrire (isolation inter-établissements)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'reception-mat-outsider');
  const reception = env.authenticatedContext('reception-mat-outsider', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'mc_maternity_cases', 'MAT-3'), {
    mid: 'MAT-3', patient_id: 'MC-MAT-3', lmpDate: '2026-01-01', status: 'prenatal',
    establishmentId: 'HOSP-B',
  }));
});
