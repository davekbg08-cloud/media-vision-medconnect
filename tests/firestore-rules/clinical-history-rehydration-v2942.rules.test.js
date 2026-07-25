/* =====================================================
   Tests — Rechargement query-safe de l'historique clinique (chantier 1, v2.9.42)

   Généralise le correctif patients de v2.9.41 aux collections cliniques :
   le membre d'établissement recharge par where('establishmentId','==') /
   where('created_by','=='), le patient par where('patient_id','==') (règle
   patientOwnsClinicalDoc). Isolation inter-établissements et confidentialité
   inter-patients préservées.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', 'H1_docX'), { hospitalId: 'H1', uid: 'docX', status: 'active', role: 'doctor' });
    await setDoc(doc(db, 'mc_consultations', 'CONS-A'), { cid: 'CONS-A', patient_id: 'MC-A', establishmentId: 'H1', created_by: 'docX', diagnosis: 'a' });
    await setDoc(doc(db, 'mc_consultations', 'CONS-B'), { cid: 'CONS-B', patient_id: 'MC-B', establishmentId: 'H1', created_by: 'docX', diagnosis: 'b' });
    await setDoc(doc(db, 'mc_consultations', 'CONS-C'), { cid: 'CONS-C', patient_id: 'MC-C', establishmentId: 'H2', created_by: 'docY', diagnosis: 'c' });
    await setDoc(doc(db, 'mc_accounts', 'PAT_MC-A'), { uid: 'PAT_MC-A', role: 'patient', authUid: 'fb-a' });
    await setDoc(doc(db, 'mc_accounts', 'PAT_MC-B'), { uid: 'PAT_MC-B', role: 'patient', authUid: 'fb-b' });
  });
}
const docX = (env) => env.authenticatedContext('docX', { role: 'doctor' }).firestore();
const patA = (env) => env.authenticatedContext('fb-a', { role: 'patient' }).firestore();

test('médecin membre : query establishmentId==H1 sur mc_consultations ACCEPTÉE', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertSucceeds(getDocs(query(collection(docX(env), 'mc_consultations'), where('establishmentId', '==', 'H1'))));
});
test('médecin : query created_by==uid ACCEPTÉE', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertSucceeds(getDocs(query(collection(docX(env), 'mc_consultations'), where('created_by', '==', 'docX'))));
});
test('médecin : query sur un AUTRE établissement REFUSÉE (isolation)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertFails(getDocs(query(collection(docX(env), 'mc_consultations'), where('establishmentId', '==', 'H2'))));
});
test('patient : query patient_id== sa fiche ACCEPTÉE (son historique revient)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertSucceeds(getDocs(query(collection(patA(env), 'mc_consultations'), where('patient_id', '==', 'MC-A'))));
});
test('patient : query patient_id== fiche d\'autrui REFUSÉE', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertFails(getDocs(query(collection(patA(env), 'mc_consultations'), where('patient_id', '==', 'MC-B'))));
});
test('patient : get unitaire d\'une consultation d\'autrui REFUSÉ', async () => {
  const env = await getTestEnv(); await clearAll(env); await seed(env);
  await assertFails(getDoc(doc(patA(env), 'mc_consultations', 'CONS-B')));
});
