/* =====================================================
   Tests — règles Firestore : durcissement sans Cloud Functions
   (plan Firebase Spark/gratuit — voir rapport de PR pour le détail
   de ce qui reste hors d'atteinte sans le plan Blaze)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, collection, id), data);
  });
}

// accountStatusOk() : un compte suspendu ne peut plus déclencher de
// révocation de session Firebase Auth réelle sans Cloud Function
// (Admin SDK requis, donc plan Blaze), mais TOUTE requête Firestore
// suivante doit être refusée dès que users/{uid}.status bascule, sans
// attendre l'expiration naturelle du token.
test("accountStatusOk : un médecin dont le compte est suspendu perd l'accès en écriture, même rôle inchangé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'doctor-susp-1', { uid: 'doctor-susp-1', role: 'doctor', status: 'suspended' });
  const doctor = env.authenticatedContext('doctor-susp-1').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_consultations', 'C1'), {
    patient_id: 'MC-C1', created_by: 'doctor-susp-1', establishmentId: 'HOSP-1',
  }));
});

test("accountStatusOk : un médecin approuvé/actif garde l'accès en écriture", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'doctor-ok-1', { uid: 'doctor-ok-1', role: 'doctor', status: 'active' });
  const doctor = env.authenticatedContext('doctor-ok-1').firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_consultations', 'C2'), {
    patient_id: 'MC-C2', created_by: 'doctor-ok-1', establishmentId: 'HOSP-1',
  }));
});

test("accountStatusOk : un compte sans champ status (rétro-compatibilité) garde l'accès", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'users', 'doctor-legacy-1', { uid: 'doctor-legacy-1', role: 'doctor' });
  const doctor = env.authenticatedContext('doctor-legacy-1').firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_consultations', 'C3'), {
    patient_id: 'MC-C3', created_by: 'doctor-legacy-1', establishmentId: 'HOSP-1',
  }));
});

// auditLogs.create : mitigation atteignable sans Cloud Function —
// empêche de forger une entrée AU NOM d'un tiers (userId doit
// correspondre à l'auteur réel de la requête, quand ce champ est
// posé). Ne ferme PAS l'omission volontaire d'un log par son auteur
// (impossible à forcer sans code serveur) — non testé ici car non
// atteignable côté règles.
test("auditLogs : impossible de créer une entrée au nom d'un AUTRE utilisateur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-uid').firestore();
  await assertFails(setDoc(doc(attacker, 'auditLogs', 'AUDIT1'), {
    establishmentId: 'HOSP-1', userId: 'someone-else-uid', action: 'test', createdAt: new Date().toISOString(),
  }));
});

test("auditLogs : créer une entrée avec son propre userId est accepté", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('real-user-uid').firestore();
  await assertSucceeds(setDoc(doc(user, 'auditLogs', 'AUDIT2'), {
    establishmentId: 'HOSP-1', userId: 'real-user-uid', action: 'test', createdAt: new Date().toISOString(),
  }));
});

test("auditLogs : créer une entrée SANS champ userId reste accepté (compatibilité des appelants existants)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('real-user-uid-2').firestore();
  await assertSucceeds(setDoc(doc(user, 'auditLogs', 'AUDIT3'), {
    establishmentId: 'HOSP-1', action: 'test', createdAt: new Date().toISOString(),
  }));
});
