/* =====================================================
   MedConnect — Notifications : helpers PURS (v2.9.42)

   Logique sans dépendance Firebase (seulement `crypto` natif) → testable
   directement depuis la suite JS racine. Utilisé par functions/notifications.js
   (Cloud Functions) ET par les tests.
   ===================================================== */
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

const VALID_PROVIDERS = [
  'fcm_android_native', 'fcm_web', 'webpush_ios', 'webpush_safari', 'electron_running',
];

const PREFERENCE_CHANNELS = [
  'appointments', 'prescriptions', 'labResults', 'messages', 'admissions',
  'transfers', 'pharmacy', 'account', 'administrative', 'security',
];

/* Allowlist des routes de deep link (NotificationRouteRegistry). */
const NOTIFICATION_ROUTES = {
  appointment: '/appointments',
  prescription: '/prescriptions',
  lab_result: '/lab',
  admission: '/admissions',
  transfer: '/transfers',
  message: '/messages',
};

function makeDeduplicationKey({ eventType, sourceCollection, sourceDocumentId, recipientUid, eventVersion }) {
  return [eventType, sourceCollection, sourceDocumentId, recipientUid, eventVersion == null ? 0 : eventVersion].join('|');
}

// Identifiant DÉTERMINISTE : deux rejeux du même événement → même id → création
// idempotente (ni doublon, ni double badge, ni re-push).
function notificationIdFromDedup(deduplicationKey) {
  return 'ntf_' + crypto.createHash('sha256').update(deduplicationKey).digest('hex').slice(0, 32);
}

// Deep link SÛR : toujours interne, jamais une URL absolue (anti open-redirect).
// On route TOUJOURS d'abord vers /notifications/{id} : le client vérifie les
// droits puis redirige vers la source autorisée.
function buildSafeDeepLink(category, sourceType, notificationId) {
  const base = NOTIFICATION_ROUTES[sourceType] || NOTIFICATION_ROUTES[category] || null;
  return { primary: `/notifications/${notificationId}`, category: base };
}

// Payload push EXPURGÉ : jamais de contenu médical ni de safePreview.
function sanitizePushPayload(notification) {
  return {
    notificationId: notification.notificationId,
    category: notification.category || null,
    priority: notification.priority || 'normal',
    deepLink: (notification.deepLink && notification.deepLink.primary) || `/notifications/${notification.notificationId}`,
  };
}

// Préférences : liste de champs STRICTE (aucun autre champ n'est écrit).
function normalizePreferences(input) {
  const out = {};
  const allow = ['enabled', 'language', 'timezone', 'quietHours', 'soundEnabled',
    'vibrationEnabled', 'criticalAlertsEnabled'];
  for (const k of allow) if (input[k] !== undefined) out[k] = input[k];
  if (input.channels && typeof input.channels === 'object') {
    out.channels = {};
    for (const c of PREFERENCE_CHANNELS) {
      if (input.channels[c] !== undefined) out.channels[c] = !!input.channels[c];
    }
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION, VALID_PROVIDERS, PREFERENCE_CHANNELS, NOTIFICATION_ROUTES,
  makeDeduplicationKey, notificationIdFromDedup, buildSafeDeepLink,
  sanitizePushPayload, normalizePreferences,
};
