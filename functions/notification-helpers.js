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

/* Catégorie de notification → canal de préférence (Phase 5). */
const CATEGORY_TO_CHANNEL = {
  appointments: 'appointments', appointment: 'appointments',
  prescriptions: 'prescriptions', prescription: 'prescriptions',
  labResults: 'labResults', lab_result: 'labResults',
  messages: 'messages', message: 'messages',
  admissions: 'admissions', admission: 'admissions',
  transfers: 'transfers', transfer: 'transfers',
  pharmacy: 'pharmacy', account: 'account',
  administrative: 'administrative', security: 'security',
};

// Une alerte de SÉCURITÉ ou une priorité CRITIQUE part toujours en push externe,
// quelles que soient les préférences (mais reste aussi dans le centre).
function isAlwaysExternal(category, priority) {
  return category === 'security' || priority === 'critical';
}

/* Décide si un push EXTERNE est autorisé (la notification interne est TOUJOURS
   créée par ailleurs). preferences peut être null (défaut : tout autorisé). */
function shouldSendExternal(preferences, category, priority, nowDate) {
  if (isAlwaysExternal(category, priority)) return true;
  const p = preferences || {};
  if (p.enabled === false) return false;
  const channel = CATEGORY_TO_CHANNEL[category];
  if (channel && p.channels && p.channels[channel] === false) return false;
  if (isInQuietHours(nowDate || new Date(), p.quietHours)) return false;
  return true;
}

// Heures silencieuses : {start:'22:00', end:'07:00'} (heure locale approximée).
// Gère l'intervalle qui traverse minuit. Absence → jamais silencieux.
function isInQuietHours(date, quietHours) {
  if (!quietHours || !quietHours.start || !quietHours.end) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  const start = hm(quietHours.start), end = hm(quietHours.end);
  if (start == null || end == null) return false;
  return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}
function hm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

module.exports = {
  SCHEMA_VERSION, VALID_PROVIDERS, PREFERENCE_CHANNELS, NOTIFICATION_ROUTES,
  CATEGORY_TO_CHANNEL,
  makeDeduplicationKey, notificationIdFromDedup, buildSafeDeepLink,
  sanitizePushPayload, normalizePreferences,
  isAlwaysExternal, shouldSendExternal, isInQuietHours,
};
