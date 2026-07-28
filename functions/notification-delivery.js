/* =====================================================
   MedConnect — Livraison de notifications : file + cron (Phase 4, v2.9.42)

   - deliverNotificationTask (onTaskDispatched) : consomme une tâche d'envoi,
     appelle le fournisseur (couture Phase 5), fait transiter l'état de livraison
     via la logique pure, invalide un enregistrement définitivement en échec, et
     s'appuie sur le retry natif de la Task Queue (backoff exponentiel).
   - cleanupStalePushRegistrations (onSchedule quotidien) : désactive les
     installations obsolètes, ne supprime JAMAIS un compte ni une notification,
     ne produit que des métriques agrégées.

   L'ENVOI RÉEL aux fournisseurs (FCM/Web Push/Electron) est implémenté en
   Phase 5 : ici, tant qu'aucun fournisseur n'est configuré, la tâche laisse la
   livraison à l'état `queued` (jamais un faux `sent_to_provider`/`delivered`).
   ===================================================== */

const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const D = require('./notification-delivery-helpers');
const { NotificationService } = require('./notifications');

const REGION = process.env.MEDCONNECT_FUNCTIONS_REGION || 'europe-west1';

/* Couture Phase 5 : envoi réel au fournisseur. Tant que le module de
   fournisseurs n'existe pas, renvoie `deferred` → la livraison reste `queued`,
   jamais marquée envoyée. */
async function dispatchToDevice(device, payload) {
  let providers = null;
  try { providers = require('./notification-providers'); } catch (_) { providers = null; }
  if (!providers || typeof providers.send !== 'function') {
    return { ok: false, deferred: true, code: 'provider_not_configured' };
  }
  return providers.send(device, payload);
}

const deliverNotificationTask = onTaskDispatched({
  region: REGION,
  memory: '256MiB',
  retryConfig: { maxAttempts: D.MAX_ATTEMPTS, minBackoffSeconds: D.BASE_BACKOFF_SECONDS },
  rateLimits: { maxConcurrentDispatches: 20 },
}, async (req) => {
  const { notificationId, recipientUid, deviceId } = req.data || {};
  if (!notificationId || !recipientUid || !deviceId) return; // rien à faire
  const db = getFirestore();
  const deviceRef = db.collection('pushRegistrations').doc(recipientUid).collection('devices').doc(deviceId);
  const notifRef = db.collection('notifications').doc(notificationId);
  const deliveryRef = db.collection('notificationDeliveries').doc(`del_${notificationId}_${deviceId}`);

  const [deviceSnap, notifSnap] = await Promise.all([deviceRef.get(), notifRef.get()]);
  if (!deviceSnap.exists || !notifSnap.exists) return;
  const device = deviceSnap.data();
  if (device.enabled === false) return; // appareil désactivé : on ne renvoie pas

  const payload = NotificationService.sanitizePushPayload(notifSnap.data()); // expurgé
  const attemptsDone = (req.retryCount != null ? req.retryCount : 0);

  const result = await dispatchToDevice(device, payload);

  // Fournisseur non encore configuré : on laisse `queued`, aucun faux succès,
  // aucun re-essai qui tournerait à vide.
  if (result && result.deferred) {
    await deliveryRef.set({
      deliveryId: deliveryRef.id, notificationId, recipientUid, deviceId,
      provider: device.provider || null, state: 'queued', attempts: attemptsDone,
      lastAttemptAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return;
  }

  const decision = D.nextDeliveryState(result, attemptsDone);
  await deliveryRef.set({
    deliveryId: deliveryRef.id, notificationId, recipientUid, deviceId,
    provider: device.provider || null, state: decision.state,
    attempts: attemptsDone + 1,
    providerMessageId: (result && result.providerMessageId) || null,
    failureCode: (result && !result.ok) ? (result.code || 'unknown') : null,
    lastAttemptAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Mise à jour de l'appareil : succès remet le compteur à zéro ; échec
  // permanent invalide l'enregistrement (jamais réessayé).
  if (result && result.ok) {
    await deviceRef.set({ consecutiveFailures: 0, lastSuccessfulSendAt: FieldValue.serverTimestamp() }, { merge: true });
  } else {
    await deviceRef.set({
      consecutiveFailures: FieldValue.increment(1),
      lastFailureAt: FieldValue.serverTimestamp(),
      lastFailureCode: (result && result.code) || 'unknown',
      ...(decision.invalidate ? { enabled: false } : {}),
    }, { merge: true });
  }

  // Erreur temporaire : relancer une exception fait rejouer la tâche par la
  // Task Queue (backoff natif), tant que maxAttempts n'est pas atteint.
  if (decision.shouldRetry) {
    throw new Error(`retry_delivery ${notificationId}/${deviceId} (${(result && result.code) || 'temporary'})`);
  }
});

/* cleanupStalePushRegistrations — tâche planifiée quotidienne. */
const cleanupStalePushRegistrations = onSchedule({
  region: REGION, schedule: 'every day 03:30', timeZone: 'UTC', memory: '256MiB',
}, async () => {
  const db = getFirestore();
  const now = Date.now();
  // collectionGroup('devices') : parcourt toutes les installations.
  const snap = await db.collectionGroup('devices').where('enabled', '==', true).get();
  let scanned = 0, disabled = 0;
  const batch = db.batch();
  snap.forEach((doc) => {
    scanned++;
    if (D.isStaleRegistration(doc.data(), now)) {
      batch.set(doc.ref, { enabled: false, disabledReason: 'stale', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      disabled++;
    }
  });
  if (disabled) await batch.commit();
  // Métriques AGRÉGÉES uniquement (jamais de jeton, jamais d'uid).
  console.log(`[notifications] cleanupStalePushRegistrations: scanned=${scanned} disabled=${disabled}`);
});

module.exports = { deliverNotificationTask, cleanupStalePushRegistrations, dispatchToDevice };
