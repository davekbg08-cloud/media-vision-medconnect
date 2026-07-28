/* =====================================================
   Tests — Réception/Labo exclus de la fiche clinique mc_patients (chantier 2, v2.9.42)

   Confidentialité : la lecture de mc_patients passe de belongsToSameEstablishment
   (tout membre) à isClinicalHospitalMember (doctor/nurse/admin_hospital). La
   réception et le laboratoire identifient un patient via patient_directory
   (identité administrative), jamais via la fiche clinique.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', 'H1_docD'), { hospitalId: 'H1', uid: 'docD', status: 'active', role: 'doctor' });
    await setDoc(doc(db, 'hospitalMembers', 'H1_recR'), { hospitalId: 'H1', uid: 'recR', status: 'active', role: 'reception' });
    await setDoc(doc(db, 'hospitalMembers', 'H1_labL'), { hospitalId: 'H1', uid: 'labL', status: 'active', role: 'lab' });
    await setDoc(doc(db, 'mc_patients', 'MC-1'), { id: 'MC-1', establishmentId: 'H1', created_by: 'docD', firstname: 'A', lastname: 'B', diagnosis: 'secret' });
    await setDoc(doc(db, 'patient_directory', 'MC-1'), { patientId: 'MC-1', establishmentId: 'H1', firstname: 'A', lastname: 'B', phone: 'x' });
  });
}
const as = (env, uid, role) => env.authenticatedContext(uid, { role }).firestore();

test('NON-RÉGRESSION : médecin lit toujours mc_patients (query + get)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertSucceeds(getDocs(query(collection(as(env, 'docD', 'doctor'), 'mc_patients'), where('establishmentId', '==', 'H1'))));
  await assertSucceeds(getDoc(doc(as(env, 'docD', 'doctor'), 'mc_patients', 'MC-1')));
});
test('réception NE PEUT PLUS lire la fiche clinique mc_patients (query + get)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertFails(getDocs(query(collection(as(env, 'recR', 'reception'), 'mc_patients'), where('establishmentId', '==', 'H1'))));
  await assertFails(getDoc(doc(as(env, 'recR', 'reception'), 'mc_patients', 'MC-1')));
});
test('laboratoire NE PEUT PLUS lire la fiche clinique mc_patients', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertFails(getDoc(doc(as(env, 'labL', 'lab'), 'mc_patients', 'MC-1')));
});
test('réception/labo lisent patient_directory (identité administrative)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertSucceeds(getDoc(doc(as(env, 'recR', 'reception'), 'patient_directory', 'MC-1')));
  await assertSucceeds(getDocs(query(collection(as(env, 'recR', 'reception'), 'patient_directory'), where('establishmentId', '==', 'H1'))));
  await assertSucceeds(getDoc(doc(as(env, 'labL', 'lab'), 'patient_directory', 'MC-1')));
});
