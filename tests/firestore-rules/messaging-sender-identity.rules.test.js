/* =====================================================
   Tests — règles Firestore : identité de l'expéditeur + immutabilité
   du contenu (chantier "reception/affiliation sans régression",
   section 12)

   Bug confirmé : mc_messages.create ne vérifiait JAMAIS l'identité de
   l'expéditeur (usurpation possible via fromUid/from_id/senderUid/
   createdByUid) ; mc_messages.update acceptait n'importe quel champ
   (le destinataire pouvait réécrire le contenu reçu). Ces deux points
   sont corrigés par messageSenderIdentityOk() et la restriction des
   champs modifiables à readStatus/read/readAt/deletedFor/updatedAt.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_messages : un utilisateur peut créer un message dont il est réellement l\'expéditeur (fromUid == auth.uid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-1').firestore();
  await assertSucceeds(setDoc(doc(sender, 'mc_messages', 'MSG-1'), {
    mid: 'MSG-1', to_role: 'patient', to_id: 'PAT-1', fromUid: 'sender-1', type: 'prescription',
  }));
});

test("mc_messages : un utilisateur NE PEUT PAS usurper l'identité d'un AUTRE expéditeur (fromUid falsifié)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-1').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_messages', 'MSG-2'), {
    mid: 'MSG-2', to_role: 'patient', to_id: 'PAT-2', fromUid: 'someone-else', type: 'prescription',
  }));
});

test("mc_messages : un document avec DEUX identités d'expéditeur contradictoires est refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-2').firestore();
  await assertFails(setDoc(doc(sender, 'mc_messages', 'MSG-3'), {
    mid: 'MSG-3', to_role: 'patient', to_id: 'PAT-3',
    fromUid: 'sender-2', createdByUid: 'someone-else', type: 'prescription',
  }));
});

test('mc_messages : un document sans AUCUN champ expéditeur reste accepté (notifications système historiques)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-3').firestore();
  await assertSucceeds(setDoc(doc(sender, 'mc_messages', 'MSG-4'), {
    mid: 'MSG-4', to_role: 'patient', to_id: 'PAT-4', type: 'appointment',
  }));
});

test('mc_messages : le destinataire peut marquer le message comme lu (readStatus/readAt)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mc_messages', 'MSG-5'), {
      mid: 'MSG-5', to_id: 'recipient-1', fromUid: 'sender-4', body: 'Bonjour', readStatus: 'unread',
    });
  });
  const recipient = env.authenticatedContext('recipient-1').firestore();
  await assertSucceeds(updateDoc(doc(recipient, 'mc_messages', 'MSG-5'), {
    readStatus: 'read', readAt: '2026-01-01T00:00:00.000Z',
  }));
});

test("mc_messages : le destinataire NE PEUT PAS réécrire le corps du message reçu", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mc_messages', 'MSG-6'), {
      mid: 'MSG-6', to_id: 'recipient-2', fromUid: 'sender-5', body: 'Contenu original', readStatus: 'unread',
    });
  });
  const recipient = env.authenticatedContext('recipient-2').firestore();
  await assertFails(updateDoc(doc(recipient, 'mc_messages', 'MSG-6'), {
    body: 'Contenu modifié par le destinataire',
  }));
});

test("mc_messages : le destinataire NE PEUT PAS réattribuer le message à un autre expéditeur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mc_messages', 'MSG-7'), {
      mid: 'MSG-7', to_id: 'recipient-3', fromUid: 'sender-6', readStatus: 'unread',
    });
  });
  const recipient = env.authenticatedContext('recipient-3').firestore();
  await assertFails(updateDoc(doc(recipient, 'mc_messages', 'MSG-7'), {
    fromUid: 'recipient-3',
  }));
});
