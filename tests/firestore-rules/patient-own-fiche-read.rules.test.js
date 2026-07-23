/* =====================================================
   Tests — règles Firestore : lecture de sa PROPRE fiche par le patient
   (chantier v2.9.41)

   Bug confirmé (photos utilisateur) : depuis son téléphone, un patient ne
   pouvait pas relire sa fiche mc_patients/{id} — la fiche ne porte aucun
   champ le liant (ownsPatientData faux), et toute lecture cloud était
   refusée. Correctif ADDITIF : le titulaire authentifié du compte
   mc_accounts/PAT_{id} (authUid == request.auth.uid) peut lire SA fiche.

   Ces tests vérifient aussi la NON-RÉGRESSION du rechargement médecin
   (requêtes filtrées établissement + created_by acceptées, collection
   entière et autre établissement toujours refusées) — l'ajout d'une
   branche OR ne doit rien retirer ni élargir indûment.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seed(env, coll, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), coll, id), data);
  });
}
async function seedMember(env, hospitalId, uid, role) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalMembers', `${hospitalId}_${uid}`),
      { hospitalId, uid, status: 'active', role });
  });
}

/* ── Nouvelle branche : patient propriétaire ─────────── */

test('patient authentifié LIT sa propre fiche (titulaire de PAT_{id})', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'mc_patients', 'MC-P1', { id: 'MC-P1', firstname: 'A', lastname: 'B', establishmentId: 'HOSP-Z' });
  await seed(env, 'mc_accounts', 'PAT_MC-P1', { uid: 'PAT_MC-P1', role: 'patient', authUid: 'fb-p1' });
  const patient = env.authenticatedContext('fb-p1', { role: 'patient' }).firestore();
  await assertSucceeds(getDoc(doc(patient, 'mc_patients', 'MC-P1')));
});

test('patient NE PEUT PAS lire la fiche d\'un AUTRE patient', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'mc_patients', 'MC-P2', { id: 'MC-P2', establishmentId: 'HOSP-Z' });
  await seed(env, 'mc_accounts', 'PAT_MC-P2', { uid: 'PAT_MC-P2', role: 'patient', authUid: 'fb-p2' });
  // fb-p1 est un patient authentifié, mais pas le titulaire de PAT_MC-P2.
  await seed(env, 'mc_accounts', 'PAT_MC-P1', { uid: 'PAT_MC-P1', role: 'patient', authUid: 'fb-p1' });
  const other = env.authenticatedContext('fb-p1', { role: 'patient' }).firestore();
  await assertFails(getDoc(doc(other, 'mc_patients', 'MC-P2')));
});

test('un compte sans PAT_{id} correspondant ne lit pas la fiche', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'mc_patients', 'MC-P3', { id: 'MC-P3', establishmentId: 'HOSP-Z' });
  // Aucun mc_accounts/PAT_MC-P3 : exists() faux → refus.
  const someone = env.authenticatedContext('fb-x', { role: 'patient' }).firestore();
  await assertFails(getDoc(doc(someone, 'mc_patients', 'MC-P3')));
});

test('authUid non concordant (usurpation) → refusé', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'mc_patients', 'MC-P4', { id: 'MC-P4', establishmentId: 'HOSP-Z' });
  await seed(env, 'mc_accounts', 'PAT_MC-P4', { uid: 'PAT_MC-P4', role: 'patient', authUid: 'fb-legit' });
  const impostor = env.authenticatedContext('fb-impostor', { role: 'patient' }).firestore();
  await assertFails(getDoc(doc(impostor, 'mc_patients', 'MC-P4')));
});

/* ── Non-régression : rechargement médecin & isolation ── */

test('NON-RÉGRESSION médecin : query where establishmentId == hid ACCEPTÉE', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-R', 'doc-r', 'doctor');
  await seed(env, 'mc_patients', 'MC-R1', { id: 'MC-R1', establishmentId: 'HOSP-R', created_by: 'someone' });
  await seed(env, 'mc_patients', 'MC-R2', { id: 'MC-R2', establishmentId: 'HOSP-R', created_by: 'doc-r' });
  const d = env.authenticatedContext('doc-r', { role: 'doctor' }).firestore();
  await assertSucceeds(getDocs(query(collection(d, 'mc_patients'), where('establishmentId', '==', 'HOSP-R'))));
});

test('NON-RÉGRESSION médecin : query where created_by == uid ACCEPTÉE', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-R', 'doc-r2', 'doctor');
  await seed(env, 'mc_patients', 'MC-R3', { id: 'MC-R3', establishmentId: 'HOSP-R', created_by: 'doc-r2' });
  const d = env.authenticatedContext('doc-r2', { role: 'doctor' }).firestore();
  await assertSucceeds(getDocs(query(collection(d, 'mc_patients'), where('created_by', '==', 'doc-r2'))));
});

test('NON-RÉGRESSION : query collection entière mc_patients REFUSÉE au médecin', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-R', 'doc-r3', 'doctor');
  await seed(env, 'mc_patients', 'MC-R4', { id: 'MC-R4', establishmentId: 'HOSP-R' });
  await seed(env, 'mc_patients', 'MC-R5', { id: 'MC-R5', establishmentId: 'HOSP-AUTRE' });
  const d = env.authenticatedContext('doc-r3', { role: 'doctor' }).firestore();
  await assertFails(getDocs(collection(d, 'mc_patients')));
});

test('NON-RÉGRESSION isolation : get unitaire d\'une fiche d\'un AUTRE établissement REFUSÉ', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-R', 'doc-r4', 'doctor');
  await seed(env, 'mc_patients', 'MC-R6', { id: 'MC-R6', establishmentId: 'HOSP-AUTRE', created_by: 'autre' });
  const d = env.authenticatedContext('doc-r4', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(d, 'mc_patients', 'MC-R6')));
});
