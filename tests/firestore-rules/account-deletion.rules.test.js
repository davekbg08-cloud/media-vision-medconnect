/* =====================================================
   Tests — règles Firestore : suppression de compte self-service

   Verrouille : le propriétaire peut supprimer son propre document
   d'identité (mc_accounts, users, doctors/nurses/pharmacies,
   hospitalMembers) ; un tiers ne peut jamais supprimer le compte de
   quelqu'un d'autre ; mc_patients reste non supprimable même par le
   patient concerné (rétention légale/médicale, cf. delete-account.html).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, deleteDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_accounts : un professionnel peut supprimer son propre compte (docId == uid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-del-1'), { uid: 'doctor-del-1', role: 'doctor', status: 'active' });
  });
  const owner = env.authenticatedContext('doctor-del-1').firestore();
  await assertSucceeds(deleteDoc(doc(owner, 'mc_accounts', 'doctor-del-1')));
});

test('mc_accounts : un patient peut supprimer son propre compte (docId != uid, via authUid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'PAT_MC-DEL-1'), { uid: 'PAT_MC-DEL-1', role: 'patient', status: 'approved', authUid: 'patient-del-real-uid' });
  });
  const owner = env.authenticatedContext('patient-del-real-uid').firestore();
  await assertSucceeds(deleteDoc(doc(owner, 'mc_accounts', 'PAT_MC-DEL-1')));
});

test("mc_accounts : un tiers ne peut pas supprimer le compte d'un autre utilisateur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-del-2'), { uid: 'doctor-del-2', role: 'doctor', status: 'active' });
  });
  const attacker = env.authenticatedContext('someone-else').firestore();
  await assertFails(deleteDoc(doc(attacker, 'mc_accounts', 'doctor-del-2')));
});

test('users : le propriétaire peut supprimer son propre document', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'user-del-1'), { uid: 'user-del-1', role: 'doctor', status: 'active' });
  });
  const owner = env.authenticatedContext('user-del-1').firestore();
  await assertSucceeds(deleteDoc(doc(owner, 'users', 'user-del-1')));
});

test("users : un tiers ne peut pas supprimer le document d'un autre utilisateur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'user-del-2'), { uid: 'user-del-2', role: 'doctor', status: 'active' });
  });
  const attacker = env.authenticatedContext('someone-else').firestore();
  await assertFails(deleteDoc(doc(attacker, 'users', 'user-del-2')));
});

for (const [collection, role] of [['doctors', 'doctor'], ['nurses', 'nurse'], ['pharmacies', 'pharmacist']]) {
  test(`${collection} : le propriétaire peut supprimer son propre document de rôle`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, collection, `${role}-del-1`), { uid: `${role}-del-1`, role, status: 'active' });
    });
    const owner = env.authenticatedContext(`${role}-del-1`).firestore();
    await assertSucceeds(deleteDoc(doc(owner, collection, `${role}-del-1`)));
  });

  test(`${collection} : un tiers ne peut pas supprimer le document de rôle d'un autre utilisateur`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, collection, `${role}-del-2`), { uid: `${role}-del-2`, role, status: 'active' });
    });
    const attacker = env.authenticatedContext('someone-else').firestore();
    await assertFails(deleteDoc(doc(attacker, collection, `${role}-del-2`)));
  });
}

test('hospitalMembers : le membre peut supprimer son propre document (nettoyage lors de la suppression de compte)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-1_member-del-1'), { uid: 'member-del-1', hospitalId: 'HOSP-1', status: 'active' });
  });
  const owner = env.authenticatedContext('member-del-1').firestore();
  await assertSucceeds(deleteDoc(doc(owner, 'hospitalMembers', 'HOSP-1_member-del-1')));
});

test("hospitalMembers : un tiers ne peut pas supprimer l'affiliation d'un autre membre", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', 'HOSP-1_member-del-2'), { uid: 'member-del-2', hospitalId: 'HOSP-1', status: 'active' });
  });
  const attacker = env.authenticatedContext('someone-else').firestore();
  await assertFails(deleteDoc(doc(attacker, 'hospitalMembers', 'HOSP-1_member-del-2')));
});

// Rétention légale/médicale (cf. delete-account.html) : la suppression
// de compte ne doit JAMAIS entraîner la suppression du dossier médical
// du patient, même par le patient concerné lui-même.
test('mc_patients : reste non supprimable, même par le patient concerné (rétention légale/médicale)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-DEL-RECORD-1'), { id: 'MC-DEL-RECORD-1' });
    await setDoc(doc(db, 'mc_accounts', 'PAT_MC-DEL-RECORD-1'), { uid: 'PAT_MC-DEL-RECORD-1', role: 'patient', authUid: 'patient-record-owner' });
  });
  const patient = env.authenticatedContext('patient-record-owner').firestore();
  await assertFails(deleteDoc(doc(patient, 'mc_patients', 'MC-DEL-RECORD-1')));
});
