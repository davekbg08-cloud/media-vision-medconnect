/* =====================================================
   MedConnect — Fournisseurs push (Phase 5, v2.9.42)

   Adaptateur d'ENVOI réel, appelé UNIQUEMENT depuis deliverNotificationTask
   (environnement fiable). Le payload est déjà expurgé (sanitizePushPayload) :
   AUCUNE donnée médicale ne part au fournisseur — seulement notificationId,
   category, priority, deepLink. La notification push n'est qu'un signal ; le
   client relit la notification autorisée depuis Firestore après clic.

   Fournisseurs :
   - fcm_web / fcm_android_native : Firebase Admin Messaging (data-only) ;
   - webpush_ios / webpush_safari : Web Push (lib `web-push`, clés VAPID dans
     Secret Manager) — activé quand les clés sont fournies ;
   - electron_running : le poste Electron écoute Firestore directement ; aucun
     push serveur (le centre in-app + notifications natives locales suffisent).

   Les erreurs sont NORMALISÉES en codes que classifyProviderError comprend
   (404/410/registration-token-not-registered → permanent → invalidation).
   ===================================================== */

const { getMessaging } = require('firebase-admin/messaging');

/* Message data-only : jamais de bloc `notification` (qui, sur certains OS,
   afficherait un titre/corps non contrôlés) — le client construit l'affichage
   à partir de la notification Firestore autorisée. */
function buildDataMessage(token, payload) {
  return {
    token,
    data: {
      notificationId: String(payload.notificationId || ''),
      category: String(payload.category || ''),
      priority: String(payload.priority || 'normal'),
      deepLink: String(payload.deepLink || ''),
    },
    android: { priority: payload.priority === 'critical' ? 'high' : 'normal' },
    apns: { headers: { 'apns-priority': payload.priority === 'critical' ? '10' : '5' } },
  };
}

function normalizeFcmError(e) {
  const code = (e && e.errorInfo && e.errorInfo.code) || (e && e.code) || 'unknown';
  return { ok: false, code: String(code) };
}

async function sendFcm(device, payload) {
  const token = device.registrationToken;
  if (!token) return { ok: false, code: 'invalid-registration-token' };
  try {
    const id = await getMessaging().send(buildDataMessage(token, payload));
    return { ok: true, providerMessageId: id };
  } catch (e) {
    return normalizeFcmError(e);
  }
}

/* Web Push (iOS/Safari) : nécessite les clés VAPID (Secret Manager). Tant
   qu'elles ne sont pas fournies à l'environnement, on renvoie `deferred` (la
   livraison reste `queued`, jamais un faux envoi). */
async function sendWebPush(device, payload) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:support@medconnect.app';
  if (!pub || !priv) return { ok: false, deferred: true, code: 'webpush_not_configured' };
  let webpush;
  try { webpush = require('web-push'); } catch (_) { return { ok: false, deferred: true, code: 'webpush_lib_missing' }; }
  const sub = device.webPushSubscription;
  if (!sub || !sub.endpoint) return { ok: false, code: '410' }; // souscription absente → invalider
  try {
    webpush.setVapidDetails(subject, pub, priv);
    const res = await webpush.sendNotification(sub, JSON.stringify(payload));
    return { ok: true, providerMessageId: String(res && res.statusCode || '201') };
  } catch (e) {
    // 404/410 → endpoint disparu/expiré → permanent (invalidation).
    const status = e && (e.statusCode || e.status);
    return { ok: false, code: status ? String(status) : (e && e.code) || 'webpush_error' };
  }
}

/* Point d'entrée unique appelé par deliverNotificationTask. */
async function send(device, payload) {
  if (!device || !device.provider) return { ok: false, code: 'invalid-argument' };
  switch (device.provider) {
    case 'fcm_web':
    case 'fcm_android_native':
      return sendFcm(device, payload);
    case 'webpush_ios':
    case 'webpush_safari':
      return sendWebPush(device, payload);
    case 'electron_running':
      // Le poste Electron écoute Firestore directement : pas de push serveur.
      return { ok: false, deferred: true, code: 'electron_local_listener' };
    default:
      return { ok: false, code: 'invalid-argument' };
  }
}

module.exports = { send, buildDataMessage, normalizeFcmError };
