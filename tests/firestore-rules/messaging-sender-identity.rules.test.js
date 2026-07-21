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

/* ── Correctif P0 (audit "workflows mobile/desktop", section 17) ────
   Ce test verrouillait auparavant le comportement inverse
   (assertSucceeds) : un message SANS AUCUNE identité d'expéditeur
   était accepté dès lors que l'auteur était signé. js/network.js
   notify() (seul point d'écriture réel) pose TOUJOURS fromUid en
   usage normal — exiger au moins un identifiant réel ferme la
   possibilité, pour un compte connecté, d'écrire un message
   totalement non attribuable dans la boîte de n'importe quel
   destinataire. */
test("mc_messages : un document SANS AUCUN champ expéditeur est refusé (P0, plus de message non attribuable)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-3').firestore();
  await assertFails(setDoc(doc(sender, 'mc_messages', 'MSG-4'), {
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

/* ── Chantier v2.9.34 (P0 messagerie) : destinataire précis obligatoire,
   champ canonique toUid reconnu, suppression logique autorisée ── */

test("mc_messages : un message SANS destinataire (ni toUid/to_id/recipientUid) est refusé même avec un expéditeur valide", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-v34-1').firestore();
  await assertFails(setDoc(doc(sender, 'mc_messages', 'MSG-V34-1'), {
    mid: 'MSG-V34-1', to_role: 'doctor', fromUid: 'sender-v34-1', type: 'info', body: 'Diffusion sans cible',
  }));
});

test("mc_messages : un message avec le champ CANONIQUE toUid (sans to_id) est accepté", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const sender = env.authenticatedContext('sender-v34-2').firestore();
  await assertSucceeds(setDoc(doc(sender, 'mc_messages', 'MSG-V34-2'), {
    mid: 'MSG-V34-2', to_role: 'doctor', toUid: 'doctor-x', fromUid: 'sender-v34-2', type: 'info',
  }));
});

test("mc_messages : le destinataire désigné par toUid (canonique) peut lire ET marquer lu", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mc_messages', 'MSG-V34-3'), {
      mid: 'MSG-V34-3', toUid: 'recipient-v34', fromUid: 'sender-v34-3', body: 'Salut', readStatus: 'unread',
    });
  });
  const recipient = env.authenticatedContext('recipient-v34').firestore();
  const { getDoc } = require('firebase/firestore');
  await assertSucceeds(getDoc(doc(recipient, 'mc_messages', 'MSG-V34-3')));
  await assertSucceeds(updateDoc(doc(recipient, 'mc_messages', 'MSG-V34-3'), {
    readStatus: 'read', read: true, readAt: '2026-07-21T00:00:00.000Z',
  }));
});

test("mc_messages : le destinataire peut supprimer logiquement (deletedFor/deletedAt/deletedByUid), jamais le contenu", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'mc_messages', 'MSG-V34-4'), {
      mid: 'MSG-V34-4', toUid: 'recipient-del', fromUid: 'sender-v34-4', body: 'À supprimer', readStatus: 'unread',
    });
  });
  const recipient = env.authenticatedContext('recipient-del').firestore();
  await assertSucceeds(updateDoc(doc(recipient, 'mc_messages', 'MSG-V34-4'), {
    deletedFor: ['recipient-del'], deletedAt: '2026-07-21T00:00:00.000Z', deletedByUid: 'recipient-del',
  }));
});

test("notifications : un tiers NE PEUT PAS créer une notification en usurpant l'expéditeur (fromUid falsifié)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('notif-attacker').firestore();
  await assertFails(setDoc(doc(attacker, 'notifications', 'NOTIF-1'), {
    notificationId: 'NOTIF-1', toUid: 'victim', fromUid: 'quelquun-dautre', title: 'Faux', message: 'x',
  }));
});

test("notifications : une notification SANS aucun destinataire/scope est refusée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('notif-user').firestore();
  await assertFails(setDoc(doc(user, 'notifications', 'NOTIF-2'), {
    notificationId: 'NOTIF-2', fromUid: 'notif-user', title: 'Sans cible', message: 'x',
  }));
});

test("notifications : une notification adressée à un utilisateur précis, avec auteur cohérent, est acceptée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('notif-author').firestore();
  await assertSucceeds(setDoc(doc(user, 'notifications', 'NOTIF-3'), {
    notificationId: 'NOTIF-3', toUid: 'destinataire', fromUid: 'notif-author', title: 'Info', message: 'x',
  }));
});

test("notifications : une alerte inter-hôpitaux (recipientHospitalId, sans uid utilisateur) reste créable (transfert d'urgence)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('transfer-doc').firestore();
  await assertSucceeds(setDoc(doc(doctor, 'notifications', 'NOTIF-4'), {
    notificationId: 'NOTIF-4', recipientHospitalId: 'HOSP-DEST', type: 'emergency_transfer',
    title: '🚑 Transfert', message: 'Patient en route',
  }));
});
