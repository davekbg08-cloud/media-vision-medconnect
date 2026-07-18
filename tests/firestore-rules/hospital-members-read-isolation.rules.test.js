/* =====================================================
   Tests — règles Firestore : lecture de hospitalMembers

   Correctif (audit sécurité) : "allow read: if isAdmin() || signedIn()"
   laissait N'IMPORTE QUEL compte connecté (patient, pharmacien,
   personnel d'un tout autre établissement) lire l'affiliation
   hôpital↔personnel↔rôle↔statut de n'importe qui, en devinant
   simplement le docId ({hospitalId}_{uid}). Resserré à l'admin et au
   titulaire du document (les 2 seuls lecteurs réels identifiés côté
   client : auth.js verifyAgent et hospitals_registry.js
   getHospitalMemberDirect, tous deux des lectures de SA PROPRE
   affiliation).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

test('hospitalMembers : le titulaire du document peut lire sa propre affiliation', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-HM-1_doctor-hm-1'), {
      hospitalId: 'HOSP-HM-1', uid: 'doctor-hm-1', role: 'doctor', status: 'active',
    });
  });
  const doctor = env.authenticatedContext('doctor-hm-1', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'hospitalMembers', 'HOSP-HM-1_doctor-hm-1')));
});

test("hospitalMembers : un tiers connecté (autre établissement) ne peut plus lire l'affiliation d'un(e) autre professionnel(le)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-HM-2_doctor-hm-2'), {
      hospitalId: 'HOSP-HM-2', uid: 'doctor-hm-2', role: 'doctor', status: 'active',
    });
  });
  const stranger = env.authenticatedContext('nurse-hm-stranger', { role: 'nurse' }).firestore();
  await assertFails(getDoc(doc(stranger, 'hospitalMembers', 'HOSP-HM-2_doctor-hm-2')));
});

test('hospitalMembers : un patient connecté ne peut pas lire une affiliation professionnelle quelconque', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-HM-3_doctor-hm-3'), {
      hospitalId: 'HOSP-HM-3', uid: 'doctor-hm-3', role: 'doctor', status: 'active',
    });
  });
  const patient = env.authenticatedContext('patient-hm-1', { role: 'patient' }).firestore();
  await assertFails(getDoc(doc(patient, 'hospitalMembers', 'HOSP-HM-3_doctor-hm-3')));
});

test('hospitalMembers : admin peut toujours lire (accès de secours inchangé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-HM-4_doctor-hm-4'), {
      hospitalId: 'HOSP-HM-4', uid: 'doctor-hm-4', role: 'doctor', status: 'active',
    });
  });
  const admin = env.authenticatedContext('admin-hm-1', { role: 'admin' }).firestore();
  await assertSucceeds(getDoc(doc(admin, 'hospitalMembers', 'HOSP-HM-4_doctor-hm-4')));
});
