/* =====================================================
   Tests — règles Firestore : split pharmacie interne/externe
   (chantier v2.9.34 — règle IMPÉRATIVE pharmacie)

   Règle : desktop hôpital = pharmacie INTERNE uniquement (service de
   l'établissement, liée à un hospitalMembers actif) ; mobile = pharmacie
   EXTERNE indépendante (jamais affiliée). Conséquences vérifiées ici :
   - une pharmacie EXTERNE ne peut jamais demander/activer une
     affiliation (affiliation_requests + hospitalMembers) ;
   - une pharmacie INTERNE (ou héritée sans pharmacyType) le peut ;
   - pharmacyType est IMMUABLE après création (users/mc_accounts/
     pharmacies) sauf pour l'admin plateforme.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

/* ── affiliation_requests : réservé aux pharmacies internes ───────── */

test("affiliation_requests : une pharmacie INTERNE peut demander une affiliation", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-int-1', { uid: 'ph-int-1', role: 'pharmacist', status: 'approved', pharmacyType: 'internal' });
  const ph = env.authenticatedContext('ph-int-1', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(ph, 'affiliation_requests', 'AFF_ph-int-1_HOSP-1'), {
    requesterUid: 'ph-int-1', requesterRole: 'pharmacist', establishmentId: 'HOSP-1', status: 'pending',
  }));
});

test("affiliation_requests : une pharmacie EXTERNE NE PEUT PAS demander d'affiliation", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-ext-1', { uid: 'ph-ext-1', role: 'pharmacist', status: 'approved', pharmacyType: 'external' });
  const ph = env.authenticatedContext('ph-ext-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(ph, 'affiliation_requests', 'AFF_ph-ext-1_HOSP-1'), {
    requesterUid: 'ph-ext-1', requesterRole: 'pharmacist', establishmentId: 'HOSP-1', status: 'pending',
  }));
});

test("affiliation_requests : une pharmacie HÉRITÉE (sans pharmacyType) reste autorisée (rétro-compat)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-legacy-1', { uid: 'ph-legacy-1', role: 'pharmacist', status: 'approved' });
  const ph = env.authenticatedContext('ph-legacy-1', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(ph, 'affiliation_requests', 'AFF_ph-legacy-1_HOSP-1'), {
    requesterUid: 'ph-legacy-1', requesterRole: 'pharmacist', establishmentId: 'HOSP-1', status: 'pending',
  }));
});

test("affiliation_requests : un rôle NON pharmacien (lab) n'est pas affecté par le split", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const lab = env.authenticatedContext('lab-1', { role: 'lab' }).firestore();
  await assertSucceeds(setDoc(doc(lab, 'affiliation_requests', 'AFF_lab-1_HOSP-1'), {
    requesterUid: 'lab-1', requesterRole: 'lab', establishmentId: 'HOSP-1', status: 'pending',
  }));
});

/* ── hospitalMembers : pas d'auto-activation pour une pharmacie externe ── */

test("hospitalMembers : une pharmacie INTERNE avec affiliation approuvée peut s'activer", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-int-2', { uid: 'ph-int-2', role: 'pharmacist', status: 'approved', pharmacyType: 'internal' });
  await seedDoc(env, 'affiliation_requests', 'AFF_ph-int-2_HOSP-2', {
    requesterUid: 'ph-int-2', establishmentId: 'HOSP-2', status: 'approved',
  });
  const ph = env.authenticatedContext('ph-int-2', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(ph, 'hospitalMembers', 'HOSP-2_ph-int-2'), {
    uid: 'ph-int-2', hospitalId: 'HOSP-2', role: 'pharmacist', status: 'active',
  }));
});

test("hospitalMembers : une pharmacie EXTERNE NE PEUT PAS s'auto-activer, même avec une affiliation approuvée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-ext-2', { uid: 'ph-ext-2', role: 'pharmacist', status: 'approved', pharmacyType: 'external' });
  await seedDoc(env, 'affiliation_requests', 'AFF_ph-ext-2_HOSP-2', {
    requesterUid: 'ph-ext-2', establishmentId: 'HOSP-2', status: 'approved',
  });
  const ph = env.authenticatedContext('ph-ext-2', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(ph, 'hospitalMembers', 'HOSP-2_ph-ext-2'), {
    uid: 'ph-ext-2', hospitalId: 'HOSP-2', role: 'pharmacist', status: 'active',
  }));
});

/* ── Immutabilité de pharmacyType (users/mc_accounts/pharmacies) ──── */

test("users : une pharmacie NE PEUT PAS se requalifier elle-même (external → internal)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-ext-3', { uid: 'ph-ext-3', role: 'pharmacist', status: 'approved', pharmacyType: 'external' });
  const ph = env.authenticatedContext('ph-ext-3', { role: 'pharmacist' }).firestore();
  await assertFails(updateDoc(doc(ph, 'users', 'ph-ext-3'), { pharmacyType: 'internal' }));
});

test("mc_accounts : pharmacyType est immuable pour le propriétaire (external → internal refusé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_accounts', 'ph-ext-4', {
    uid: 'ph-ext-4', authUid: 'ph-ext-4', role: 'pharmacist', status: 'approved', pharmacyType: 'external',
  });
  const ph = env.authenticatedContext('ph-ext-4', { role: 'pharmacist' }).firestore();
  await assertFails(updateDoc(doc(ph, 'mc_accounts', 'ph-ext-4'), { pharmacyType: 'internal' }));
});

test("pharmacies : pharmacyType est immuable pour le propriétaire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'pharmacies', 'ph-ext-5', {
    uid: 'ph-ext-5', role: 'pharmacist', status: 'approved', pharmacyType: 'external',
  });
  const ph = env.authenticatedContext('ph-ext-5', { role: 'pharmacist' }).firestore();
  await assertFails(updateDoc(doc(ph, 'pharmacies', 'ph-ext-5'), { pharmacyType: 'internal' }));
});

test("users : l'admin plateforme PEUT corriger pharmacyType", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'ph-ext-6', { uid: 'ph-ext-6', role: 'pharmacist', status: 'approved', pharmacyType: 'external' });
  const admin = env.authenticatedContext('admin-1', { admin: true, role: 'admin' }).firestore();
  await assertSucceeds(updateDoc(doc(admin, 'users', 'ph-ext-6'), { pharmacyType: 'internal' }));
});
