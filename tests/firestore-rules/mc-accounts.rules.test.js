/* =====================================================
   Tests — règles Firestore : mc_accounts (PARTIE B/C/N)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_accounts : lecture publique OK, y compris non authentifié', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-1')));
});

test('mc_accounts : création avec un champ password en clair est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-2'), {
    uid: 'PAT_MC-TEST-2', role: 'patient', password: '123456',
  }));
});

test('mc_accounts : création avec un champ pin en clair est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-3'), {
    uid: 'PAT_MC-TEST-3', role: 'patient', pin: '123456',
  }));
});

test('mc_accounts : création SANS secret (authUid Firebase) est acceptée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-4'), {
    uid: 'PAT_MC-TEST-4', role: 'patient', authUid: 'firebase-uid-xyz', status: 'approved',
  }));
});

test("mc_accounts : le propriétaire (auth.uid == docId) ne peut pas RÉINTRODUIRE un password via update", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-1'), { uid: 'doctor-uid-1', role: 'doctor', status: 'active' });
  });
  const owner = env.authenticatedContext('doctor-uid-1').firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'doctor-uid-1'), { password: 'hacked123' }));
});

test('mc_accounts : le propriétaire peut modifier un champ non sensible de son propre compte', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-2'), { uid: 'doctor-uid-2', role: 'doctor', status: 'active', phone: '' });
  });
  const owner = env.authenticatedContext('doctor-uid-2').firestore();
  await assertSucceeds(updateDoc(doc(owner, 'mc_accounts', 'doctor-uid-2'), { phone: '+243800000000' }));
});

test("mc_accounts : un tiers ne peut pas modifier le compte d'un autre utilisateur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-3'), { uid: 'doctor-uid-3', role: 'doctor', status: 'active' });
  });
  const other = env.authenticatedContext('someone-else').firestore();
  await assertFails(updateDoc(doc(other, 'mc_accounts', 'doctor-uid-3'), { status: 'active', name: 'Hacked' }));
});
