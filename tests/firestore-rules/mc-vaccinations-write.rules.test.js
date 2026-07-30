/* =====================================================
   Tests — règles Firestore : écriture de mc_vaccinations
   (chantier « vaccination » — confidentialité + rattachement patient)

   Avant ce chantier, « allow write: if doctor|nurse » laissait N'IMPORTE
   quel soignant de N'IMPORTE quel établissement créer/écraser une
   vaccination — y compris ORPHELINE (sans patient) et pour un autre
   hôpital. La création exige désormais : rôle clinique, un patient_id NON
   vide, l'appartenance active à l'établissement de la fiche, et
   created_by == l'auteur réel.
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

test('mc_vaccinations : un médecin affilié peut créer une vaccination rattachée à un patient de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-1', 'doctor-vax-1');
  const doctor = env.authenticatedContext('doctor-vax-1', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_vaccinations', 'VAX-1'), {
    vid: 'VAX-1', patient_id: 'MC-VAX-1', vaccine: 'BCG', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-1', created_by: 'doctor-vax-1',
  }));
});

test('mc_vaccinations : une infirmière affiliée peut créer une vaccination', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-2', 'nurse-vax-1');
  const nurse = env.authenticatedContext('nurse-vax-1', { role: 'nurse' }).firestore();
  await assertSucceeds(setDoc(doc(nurse, 'mc_vaccinations', 'VAX-2'), {
    vid: 'VAX-2', patient_id: 'MC-VAX-2', vaccine: 'Polio', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-2', created_by: 'nurse-vax-1',
  }));
});

test('mc_vaccinations : une vaccination SANS patient_id (orpheline) est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-3', 'doctor-vax-3');
  const doctor = env.authenticatedContext('doctor-vax-3', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_vaccinations', 'VAX-3'), {
    vid: 'VAX-3', vaccine: 'COVID-19', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-3', created_by: 'doctor-vax-3',
  }));
});

test('mc_vaccinations : un patient_id vide est refusé', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-4', 'doctor-vax-4');
  const doctor = env.authenticatedContext('doctor-vax-4', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_vaccinations', 'VAX-4'), {
    vid: 'VAX-4', patient_id: '', vaccine: 'BCG', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-4', created_by: 'doctor-vax-4',
  }));
});

test("mc_vaccinations : un soignant NON affilié à l'établissement de la fiche ne peut pas créer (anti inter-établissements)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  // doctor-outsider est affilié à HOSP-A, pas à HOSP-B (établissement stampé).
  await seedMember(env, 'HOSP-A', 'doctor-outsider');
  const doctor = env.authenticatedContext('doctor-outsider', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_vaccinations', 'VAX-5'), {
    vid: 'VAX-5', patient_id: 'MC-VAX-5', vaccine: 'BCG', date: '2026-07-28',
    establishmentId: 'HOSP-B', created_by: 'doctor-outsider',
  }));
});

test("mc_vaccinations : created_by doit être l'auteur réel (pas un autre uid)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-6', 'doctor-vax-6');
  const doctor = env.authenticatedContext('doctor-vax-6', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_vaccinations', 'VAX-6'), {
    vid: 'VAX-6', patient_id: 'MC-VAX-6', vaccine: 'BCG', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-6', created_by: 'quelquun-dautre',
  }));
});

test('mc_vaccinations : un rôle non clinique (pharmacien) ne peut pas créer', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-VAX-7', 'pharma-vax-1');
  const pharmacist = env.authenticatedContext('pharma-vax-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'mc_vaccinations', 'VAX-7'), {
    vid: 'VAX-7', patient_id: 'MC-VAX-7', vaccine: 'BCG', date: '2026-07-28',
    establishmentId: 'HOSP-VAX-7', created_by: 'pharma-vax-1',
  }));
});
