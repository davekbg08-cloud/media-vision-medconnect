/* =====================================================
   MedConnect — Livraison de notifications : décisions PURES (Phase 4, v2.9.42)

   Sans Firebase : classification des erreurs fournisseur, backoff exponentiel,
   transition d'état de livraison, détection des enregistrements obsolètes.
   Testable directement depuis la suite racine.
   ===================================================== */

// Codes d'erreur fournisseur PERMANENTS (l'enregistrement ne redeviendra jamais
// valide → ne plus réessayer, invalider l'appareil). Couvre FCM et Web Push.
const PERMANENT_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'registration-token-not-registered',
  'invalid-registration-token',
  'not-registered',
  'invalid-argument',
  '404', // Web Push : endpoint disparu
  '410', // Web Push : souscription expirée (Gone)
]);

function classifyProviderError(code) {
  if (code == null) return 'temporary';
  return PERMANENT_ERROR_CODES.has(String(code)) ? 'permanent' : 'temporary';
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 3600;

// Backoff exponentiel borné. attempt = nombre de tentatives DÉJÀ effectuées.
function computeRetry(attempts) {
  const a = Math.max(0, attempts | 0);
  if (a >= MAX_ATTEMPTS) return { shouldRetry: false, delaySeconds: 0 };
  const delay = Math.min(BASE_BACKOFF_SECONDS * Math.pow(2, a), MAX_BACKOFF_SECONDS);
  return { shouldRetry: true, delaySeconds: delay };
}

/* État de livraison suivant, à partir du résultat d'une tentative.
   result : { ok:true } | { ok:false, code } . Ne renvoie JAMAIS 'delivered'
   (aucun fournisseur ne prouve la livraison finale ici) : un succès d'envoi =
   'sent_to_provider'. */
function nextDeliveryState(result, attemptsDone) {
  if (result && result.ok) return { state: 'sent_to_provider', shouldRetry: false };
  const kind = classifyProviderError(result && result.code);
  if (kind === 'permanent') return { state: 'failed_permanent', shouldRetry: false, invalidate: true };
  const retry = computeRetry(attemptsDone);
  return {
    state: retry.shouldRetry ? 'failed_temporary' : 'failed_permanent',
    shouldRetry: retry.shouldRetry,
    delaySeconds: retry.delaySeconds,
  };
}

// Un enregistrement est OBSOLÈTE si trop d'échecs consécutifs OU s'il n'a pas
// été revu depuis longtemps. Ne supprime jamais : signale pour désactivation.
const STALE_AFTER_DAYS = 270; // ~9 mois sans réapparition
const MAX_CONSECUTIVE_FAILURES = 10;
function isStaleRegistration(device, nowMs) {
  if (!device) return false;
  if ((device.consecutiveFailures || 0) >= MAX_CONSECUTIVE_FAILURES) return true;
  const last = toMillis(device.lastSeenAt);
  if (last == null) return false; // jamais vu ⇒ on ne devine pas
  return (nowMs - last) > STALE_AFTER_DAYS * 86400000;
}

function toMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v._seconds != null) return v._seconds * 1000;
  return null;
}

module.exports = {
  PERMANENT_ERROR_CODES, MAX_ATTEMPTS, BASE_BACKOFF_SECONDS, MAX_BACKOFF_SECONDS,
  STALE_AFTER_DAYS, MAX_CONSECUTIVE_FAILURES,
  classifyProviderError, computeRetry, nextDeliveryState, isStaleRegistration, toMillis,
};
