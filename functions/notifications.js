/* =====================================================
   MedConnect — Cloud Functions : notifications (Phase 2, v2.9.42)

   Cœur serveur du système de notifications. Firestore est la source de vérité ;
   le push (phases 4/5) n'est qu'un signal. Aucun module métier n'appelle
   directement l'Admin Messaging : tout passe par enqueueNotification.

   Ce module fournit :
   - enqueueNotification()  : primitive centrale, création IDÉMPOTENTE des
     notifications (une par destinataire) via un identifiant déterministe dérivé
     de la deduplicationKey, dans une transaction.
   - NotificationService    : helpers internes (deep link sûr, badge, payload
     expurgé, préférences).
   - 5 callables (Auth + App Check exigés) : registerPushDevice,
     unregisterPushDevice, updateNotificationPreferences, markNotificationRead,
     sendTestNotification.

   L'ENVOI réel aux fournisseurs (FCM/Web Push/Electron) et la file de retry
   sont des phases ultérieures : ici on crée la notification (source de vérité)
   et on journalise une tentative à l'état `queued` — jamais `delivered`.
   ===================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const H = require('./notification-helpers');

const REGION = process.env.MEDCONNECT_FUNCTIONS_REGION || 'europe-west1';
const CALL_OPTS = {
  region: REGION,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 10,
  enforceAppCheck: true,
};

const { SCHEMA_VERSION, VALID_PROVIDERS, PREFERENCE_CHANNELS, NOTIFICATION_ROUTES,
  makeDeduplicationKey, notificationIdFromDedup, buildSafeDeepLink,
  sanitizePushPayload, normalizePreferences } = H;

/* ── Badge : recalcul depuis Firestore (jamais un compteur local) ── */
async function computeBadgeCount(db, uid) {
  const snap = await db.collection('notifications')
    .where('recipientUid', '==', uid)
    .where('readStatus', '==', 'unread')
    .count().get();
  return snap.data().count;
}

/* ── enqueueNotification : primitive centrale ───────────
   input : { eventId, eventType, sourceCollection, sourceDocumentId, hospitalId,
             actorUid, recipients:[{recipientUid, recipientRole, category,
             priority, titleKey, bodyKey, safePreview, sourceType}],
             priority, localizationParams, eventVersion, expiresAt }
   Crée une notification par destinataire, idempotemment. */
async function enqueueNotification(input) {
  const db = getFirestore();
  const {
    eventId, eventType, sourceCollection, sourceDocumentId, hospitalId,
    recipients = [], localizationParams = {}, eventVersion = 0, expiresAt = null,
  } = input || {};
  if (!eventType || !sourceCollection || !sourceDocumentId) {
    throw new HttpsError('invalid-argument', 'eventType, sourceCollection et sourceDocumentId requis.');
  }
  const results = [];
  for (const r of recipients) {
    if (!r || !r.recipientUid) continue; // recipientUid OBLIGATOIRE, jamais d'envoi générique par rôle
    const deduplicationKey = makeDeduplicationKey({
      eventType, sourceCollection, sourceDocumentId, recipientUid: r.recipientUid, eventVersion,
    });
    const notificationId = notificationIdFromDedup(deduplicationKey);
    const ref = db.collection('notifications').doc(notificationId);
    const category = r.category || input.category || 'administrative';
    const priority = r.priority || input.priority || 'normal';
    const sourceType = r.sourceType || eventType;

    const created = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return false; // idempotent : ni doublon, ni double badge, ni re-push
      tx.set(ref, {
        notificationId,
        eventId: eventId || null,
        deduplicationKey,
        type: eventType,
        category,
        priority,
        recipientUid: r.recipientUid,
        recipientRole: r.recipientRole || null,
        hospitalId: hospitalId || null,
        sourceCollection,
        sourceDocumentId,
        titleKey: r.titleKey || input.titleKey || 'notif.generic.title',
        bodyKey: r.bodyKey || input.bodyKey || 'notif.generic.body',
        localizationParams: r.localizationParams || localizationParams || {},
        safePreview: r.safePreview || null, // jamais de donnée clinique
        deepLink: buildSafeDeepLink(category, sourceType, notificationId),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: expiresAt || null,
        readStatus: 'unread',
        readAt: null,
        openedAt: null,
        dismissedAt: null,
        createdBySystem: true,
        schemaVersion: SCHEMA_VERSION,
      });
      return true;
    });

    // Journal de livraison à l'état `queued` (l'envoi réel est une phase
    // ultérieure). On ne prétend JAMAIS `delivered`.
    if (created) {
      const deliveryId = `del_${notificationId}`;
      await db.collection('notificationDeliveries').doc(deliveryId).set({
        deliveryId, notificationId, recipientUid: r.recipientUid,
        provider: null, state: 'queued', attempts: 0,
        createdAt: FieldValue.serverTimestamp(), expiresAt: expiresAt || null,
      }, { merge: true });
    }
    results.push({ recipientUid: r.recipientUid, notificationId, created });
  }
  return results;
}

/* ── Callables ──────────────────────────────────────── */

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Session requise.');
  }
  return request.auth.uid;
}

// registerPushDevice — associe une installation à l'utilisateur courant.
// Écrit via l'Admin SDK (les règles interdisent l'écriture directe client).
// Ne logue JAMAIS registrationToken/installationId/webPushSubscription.
const registerPushDevice = onCall(CALL_OPTS, async (request) => {
  const uid = requireAuth(request);
  const d = request.data || {};
  const deviceId = String(d.deviceId || '').trim();
  const provider = String(d.provider || '').trim();
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId requis.');
  if (!VALID_PROVIDERS.includes(provider)) throw new HttpsError('invalid-argument', 'provider invalide.');

  const db = getFirestore();
  const ref = db.collection('pushRegistrations').doc(uid).collection('devices').doc(deviceId);
  const now = FieldValue.serverTimestamp();
  await ref.set({
    uid, deviceId, provider,
    installationId: d.installationId || null,
    registrationToken: d.registrationToken || null,
    webPushSubscription: d.webPushSubscription || null,
    platform: d.platform || null,
    appVariant: d.appVariant || null,
    appVersion: d.appVersion || null,
    locale: d.locale || null,
    timezone: d.timezone || null,
    notificationPermission: d.notificationPermission || null,
    enabled: true,
    updatedAt: now,
    lastSeenAt: now,
    consecutiveFailures: 0,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now, // merge:false → posé une fois ; réenregistrement remplace proprement
  }, { merge: true });
  return { ok: true, deviceId };
});

// unregisterPushDevice — désactive un appareil APPARTENANT à l'utilisateur.
const unregisterPushDevice = onCall(CALL_OPTS, async (request) => {
  const uid = requireAuth(request);
  const deviceId = String((request.data || {}).deviceId || '').trim();
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId requis.');
  const db = getFirestore();
  const ref = db.collection('pushRegistrations').doc(uid).collection('devices').doc(deviceId);
  await ref.set({ enabled: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, deviceId };
});

// updateNotificationPreferences — liste de champs autorisée, uid depuis l'auth.
const updateNotificationPreferences = onCall(CALL_OPTS, async (request) => {
  const uid = requireAuth(request);
  const prefs = normalizePreferences(request.data || {});
  const db = getFirestore();
  await db.collection('notificationPreferences').doc(uid).set({
    uid, ...prefs, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

// markNotificationRead — marque lue SA notification (recipientUid == uid).
const markNotificationRead = onCall(CALL_OPTS, async (request) => {
  const uid = requireAuth(request);
  const notificationId = String((request.data || {}).notificationId || '').trim();
  if (!notificationId) throw new HttpsError('invalid-argument', 'notificationId requis.');
  const db = getFirestore();
  const ref = db.collection('notifications').doc(notificationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Notification introuvable.');
    if (snap.data().recipientUid !== uid) throw new HttpsError('permission-denied', 'Notification d\'un autre utilisateur.');
    tx.update(ref, {
      readStatus: 'read', readAt: FieldValue.serverTimestamp(),
      openedAt: snap.data().openedAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const badgeCount = await computeBadgeCount(db, uid);
  return { ok: true, badgeCount };
});

// sendTestNotification — envoie UNIQUEMENT à soi-même, limité en fréquence,
// aucune donnée médicale. Utilisé depuis Paramètres → Notifications.
const TEST_COOLDOWN_MS = 30000;
const sendTestNotification = onCall(CALL_OPTS, async (request) => {
  const uid = requireAuth(request);
  const db = getFirestore();
  const guardRef = db.collection('notificationPreferences').doc(uid);
  const now = Date.now();
  // Cooldown anti-spam via un champ dédié (transaction).
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(guardRef);
    const last = snap.exists && snap.data().lastTestAt ? snap.data().lastTestAt : 0;
    if (typeof last === 'number' && now - last < TEST_COOLDOWN_MS) {
      throw new HttpsError('resource-exhausted', 'Veuillez patienter avant un nouveau test.');
    }
    tx.set(guardRef, { uid, lastTestAt: now }, { merge: true });
  });
  const res = await enqueueNotification({
    eventId: `test_${uid}_${now}`,
    eventType: 'test',
    sourceCollection: 'notifications',
    sourceDocumentId: `test_${now}`,
    category: 'account',
    priority: 'normal',
    eventVersion: now, // unique → jamais dédoublonné avec un test précédent
    recipients: [{ recipientUid: uid, titleKey: 'notif.test.title', bodyKey: 'notif.test.body' }],
  });
  return { ok: true, notificationId: res[0] && res[0].notificationId };
});

module.exports = {
  // callables (re-exportés par index.js)
  registerPushDevice, unregisterPushDevice, updateNotificationPreferences,
  markNotificationRead, sendTestNotification,
  // primitive + helpers (triggers en phase 3, tests)
  enqueueNotification,
  NotificationService: {
    makeDeduplicationKey, notificationIdFromDedup, buildSafeDeepLink,
    sanitizePushPayload, normalizePreferences, computeBadgeCount,
  },
  // constantes exposées pour les tests
  VALID_PROVIDERS, PREFERENCE_CHANNELS, NOTIFICATION_ROUTES, CALL_OPTS,
};
