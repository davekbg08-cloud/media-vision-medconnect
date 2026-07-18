/* =====================================================
   Tests — règles Firestore : lecture de notifications selon le champ
   destinataire réellement écrit

   Correctif (audit sécurité) : js/db.js saveMessages() (miroir
   mc_messages) écrit to_id/to_role, mais js/cloud-db.js
   createNotification() (utilisée par js/hospital-reception.js pour
   notifier le médecin orienté, et js/hospital-subscription.js) écrit
   toUid/recipientUserId — deux noms de champs jamais couverts par la
   règle, qui ne testait que to_id/recipientUid/userUid. Les
   notifications créées par ce second chemin restaient structurellement
   illisibles par leur destinataire non-admin. Ajout ADDITIF des 2
   clés manquantes, sans retirer les 3 existantes.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

test('notifications : le destinataire désigné par to_id (js/db.js saveMessages, chemin déjà fonctionnel) peut lire — non-régression', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'notifications', 'NOTIF-1'), {
      to_id: 'doctor-notif-1', to_role: 'doctor', message: 'Test',
    });
  });
  const doctor = env.authenticatedContext('doctor-notif-1', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'notifications', 'NOTIF-1')));
});

test('notifications : le destinataire désigné par toUid/recipientUserId (js/cloud-db.js createNotification, ex. réception → médecin) peut désormais lire', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'notifications', 'NOTIF-2'), {
      toUid: 'doctor-notif-2', recipientUserId: 'doctor-notif-2', type: 'reception_orientation',
    });
  });
  const doctor = env.authenticatedContext('doctor-notif-2', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'notifications', 'NOTIF-2')));
});

test("notifications : un tiers non concerné (aucun des 5 champs ne correspond) ne peut pas lire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'notifications', 'NOTIF-3'), {
      toUid: 'doctor-notif-3', recipientUserId: 'doctor-notif-3', type: 'reception_orientation',
    });
  });
  const stranger = env.authenticatedContext('doctor-notif-stranger', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(stranger, 'notifications', 'NOTIF-3')));
});

test('notifications : un document ne portant AUCUN des 5 champs destinataire ne lève pas d\'erreur d\'évaluation (juste refusé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'notifications', 'NOTIF-4'), { type: 'subscription_request', message: 'Test' });
  });
  const doctor = env.authenticatedContext('doctor-notif-4', { role: 'doctor' }).firestore();
  await assertFails(getDoc(doc(doctor, 'notifications', 'NOTIF-4')));
});
