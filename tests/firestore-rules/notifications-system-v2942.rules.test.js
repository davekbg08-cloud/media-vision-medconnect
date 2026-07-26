/* =====================================================
   Tests — règles Firestore du système de notifications (v2.9.42)

   Vérifie les 4 collections canoniques :
   - notifications (étendu) : destinataire lit + met à jour SES SEULS champs
     d'état (dont openedAt), jamais le contenu/adressage (non-régression) ;
   - pushRegistrations/{uid}/devices : lecture propriétaire seule, écriture
     client TOUJOURS refusée (passe par Cloud Functions Auth+App Check) ;
   - notificationPreferences/{uid} : propriétaire seul, uid immuable, pas de
     préférence d'un autre compte, suppression interdite ;
   - notificationDeliveries : client (non-admin) ne lit ni n'écrit.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seed(env, coll, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), coll, id), data);
  });
}
async function seedPath(env, path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...path), data);
  });
}

/* ── notifications (étendu) ─────────────────────────── */

test('le destinataire lit sa notification et marque openedAt/readStatus', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notifications', 'N1', {
    notificationId: 'N1', recipientUid: 'fb-doc', type: 'lab_result',
    titleKey: 'notif.lab.title', bodyKey: 'notif.lab.body', readStatus: 'unread',
  });
  const doc1 = env.authenticatedContext('fb-doc', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doc1, 'notifications', 'N1')));
  await assertSucceeds(updateDoc(doc(doc1, 'notifications', 'N1'),
    { readStatus: 'read', readAt: 'now', openedAt: 'now' }));
});

test('le destinataire NE PEUT PAS altérer le contenu/adressage d\'une notification', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notifications', 'N2', {
    notificationId: 'N2', recipientUid: 'fb-doc', type: 'lab_result',
    titleKey: 'notif.lab.title', readStatus: 'unread',
  });
  const doc1 = env.authenticatedContext('fb-doc', { role: 'doctor' }).firestore();
  await assertFails(updateDoc(doc(doc1, 'notifications', 'N2'), { titleKey: 'ALTÉRÉ' }));
  await assertFails(updateDoc(doc(doc1, 'notifications', 'N2'), { recipientUid: 'fb-autre' }));
});

test('un autre utilisateur ne lit pas la notification d\'autrui', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notifications', 'N3', { notificationId: 'N3', recipientUid: 'fb-doc', readStatus: 'unread' });
  const autre = env.authenticatedContext('fb-autre', { role: 'nurse' }).firestore();
  await assertFails(getDoc(doc(autre, 'notifications', 'N3')));
});

/* ── pushRegistrations/{uid}/devices ────────────────── */

test('le propriétaire lit ses appareils ; un autre utilisateur non', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedPath(env, ['pushRegistrations', 'fb-doc', 'devices', 'D1'],
    { uid: 'fb-doc', deviceId: 'D1', provider: 'fcm_web', enabled: true });
  const owner = env.authenticatedContext('fb-doc', {}).firestore();
  const other = env.authenticatedContext('fb-autre', {}).firestore();
  await assertSucceeds(getDoc(doc(owner, 'pushRegistrations', 'fb-doc', 'devices', 'D1')));
  await assertFails(getDoc(doc(other, 'pushRegistrations', 'fb-doc', 'devices', 'D1')));
});

test('l\'écriture directe d\'un appareil est TOUJOURS refusée (Cloud Functions uniquement)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const owner = env.authenticatedContext('fb-doc', {}).firestore();
  // Même le propriétaire ne peut PAS écrire directement : registrationToken
  // sensible → passe par registerPushDevice (Admin SDK).
  await assertFails(setDoc(doc(owner, 'pushRegistrations', 'fb-doc', 'devices', 'D2'),
    { uid: 'fb-doc', deviceId: 'D2', registrationToken: 'secret-token' }));
});

/* ── notificationPreferences/{uid} ──────────────────── */

test('le propriétaire crée et lit ses préférences ; uid immuable', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const owner = env.authenticatedContext('fb-doc', {}).firestore();
  await assertSucceeds(setDoc(doc(owner, 'notificationPreferences', 'fb-doc'),
    { uid: 'fb-doc', enabled: true, channels: { labResults: true } }));
  await assertSucceeds(getDoc(doc(owner, 'notificationPreferences', 'fb-doc')));
  // Tenter de changer l'uid est refusé.
  await assertFails(updateDoc(doc(owner, 'notificationPreferences', 'fb-doc'), { uid: 'fb-autre' }));
});

test('un utilisateur ne touche pas aux préférences d\'un autre compte', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notificationPreferences', 'fb-doc', { uid: 'fb-doc', enabled: true });
  const other = env.authenticatedContext('fb-autre', {}).firestore();
  await assertFails(getDoc(doc(other, 'notificationPreferences', 'fb-doc')));
  await assertFails(updateDoc(doc(other, 'notificationPreferences', 'fb-doc'), { enabled: false }));
});

test('la suppression des préférences est interdite (dismissal logique ailleurs)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notificationPreferences', 'fb-doc', { uid: 'fb-doc', enabled: true });
  const owner = env.authenticatedContext('fb-doc', {}).firestore();
  const { deleteDoc } = require('firebase/firestore');
  await assertFails(deleteDoc(doc(owner, 'notificationPreferences', 'fb-doc')));
});

/* ── notificationDeliveries ─────────────────────────── */

test('le client (non-admin) ne lit ni n\'écrit le journal de livraison', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'notificationDeliveries', 'DEL1',
    { deliveryId: 'DEL1', notificationId: 'N1', recipientUid: 'fb-doc', provider: 'fcm_web', state: 'sent_to_provider', providerMessageId: 'pmid-secret' });
  const user = env.authenticatedContext('fb-doc', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(user, 'notificationDeliveries', 'DEL1')));
  await assertFails(setDoc(doc(user, 'notificationDeliveries', 'DEL2'), { deliveryId: 'DEL2' }));
});
