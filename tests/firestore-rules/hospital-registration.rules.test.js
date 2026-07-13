/* =====================================================
   Tests — règles Firestore : auto-inscription établissement
   (establishments / hospitals / mc_hospitals)

   Découverte en auditant le dépôt : ces 3 collections n'avaient QUE
   `allow write/create: if isAdmin()` — le compte hôpital non-admin qui
   vient de s'inscrire (hospital-auth.js register()) ne pouvait donc
   jamais faire aboutir la création de son propre document (échec
   silencieux, jamais rejoué avec succès). Verrouille le comportement
   attendu après correctif : auto-création restreinte (authUid == soi,
   statut figé à 'pending', aucun champ secret), et la migration
   organique du mot de passe hérité (passwordHash → Firebase Auth).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, deleteField } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

for (const collection of ['hospitals', 'establishments', 'mc_hospitals']) {

  test(`${collection} : un établissement peut créer son propre document (authUid = soi, statut pending)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const est = env.authenticatedContext('est-uid-1').firestore();
    await assertSucceeds(setDoc(doc(est, collection, 'EST-1'), {
      establishmentId: 'EST-1', name: 'Hôpital Test', officialId: 'MAT-1',
      authUid: 'est-uid-1', status: 'pending',
    }));
  });

  test(`${collection} : la création est refusée si authUid ne correspond pas à l'appelant`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const attacker = env.authenticatedContext('attacker-uid').firestore();
    await assertFails(setDoc(doc(attacker, collection, 'EST-2'), {
      establishmentId: 'EST-2', name: 'Hôpital Test', officialId: 'MAT-2',
      authUid: 'someone-else-uid', status: 'pending',
    }));
  });

  test(`${collection} : la création est refusée si le statut n'est pas 'pending' (auto-approbation)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const est = env.authenticatedContext('est-uid-3').firestore();
    await assertFails(setDoc(doc(est, collection, 'EST-3'), {
      establishmentId: 'EST-3', name: 'Hôpital Test', officialId: 'MAT-3',
      authUid: 'est-uid-3', status: 'active',
    }));
  });

  test(`${collection} : la création est refusée si un champ secret (passwordHash) est présent`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const est = env.authenticatedContext('est-uid-4').firestore();
    await assertFails(setDoc(doc(est, collection, 'EST-4'), {
      establishmentId: 'EST-4', name: 'Hôpital Test', officialId: 'MAT-4',
      authUid: 'est-uid-4', status: 'pending', passwordHash: 'deadbeef',
    }));
  });
}

/* ── Migration organique (passwordHash hérité → Firebase Auth) ── */

test("hospitals : un établissement hérité (sans authUid) peut réclamer son document en posant authUid == soi", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'hospitals', 'EST-LEGACY-1', {
    establishmentId: 'EST-LEGACY-1', name: 'Hôpital Hérité', officialId: 'MAT-L1',
    status: 'active', passwordHash: 'oldhash',
  });
  const est = env.authenticatedContext('legacy-uid-1').firestore();
  await assertSucceeds(updateDoc(doc(est, 'hospitals', 'EST-LEGACY-1'), {
    authUid: 'legacy-uid-1', passwordHash: deleteField(),
  }));
});

test("hospitals : un tiers ne peut pas réclamer le document d'un établissement DÉJÀ migré (authUid déjà posé, différent)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'hospitals', 'EST-CLAIMED-1', {
    establishmentId: 'EST-CLAIMED-1', name: 'Hôpital Test', officialId: 'MAT-C1',
    status: 'active', authUid: 'legit-owner-uid',
  });
  const attacker = env.authenticatedContext('attacker-uid-2').firestore();
  await assertFails(updateDoc(doc(attacker, 'hospitals', 'EST-CLAIMED-1'), {
    authUid: 'attacker-uid-2',
  }));
});

test("hospitals : la migration ne peut pas changer le statut au passage (pas d'auto-approbation via la migration)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'hospitals', 'EST-LEGACY-2', {
    establishmentId: 'EST-LEGACY-2', name: 'Hôpital Hérité', officialId: 'MAT-L2',
    status: 'pending', passwordHash: 'oldhash',
  });
  const est = env.authenticatedContext('legacy-uid-2').firestore();
  await assertFails(updateDoc(doc(est, 'hospitals', 'EST-LEGACY-2'), {
    authUid: 'legacy-uid-2', passwordHash: deleteField(), status: 'active',
  }));
});

test("hospitals : un établissement déjà propriétaire de son document peut continuer à le mettre à jour (authUid inchangé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'hospitals', 'EST-OWN-1', {
    establishmentId: 'EST-OWN-1', name: 'Hôpital Test', officialId: 'MAT-O1',
    status: 'active', authUid: 'owner-uid-1',
  });
  const est = env.authenticatedContext('owner-uid-1').firestore();
  await assertSucceeds(updateDoc(doc(est, 'hospitals', 'EST-OWN-1'), {
    authUid: 'owner-uid-1', city: 'Kinshasa',
  }));
});
