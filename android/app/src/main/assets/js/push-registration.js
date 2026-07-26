/* =====================================================
   MedConnect 2.0 — Enregistrement push client (Phase 5-client, v2.9.42)

   Opt-in EXPLICITE de l'utilisateur (jamais de demande à l'ouverture). Obtient
   un jeton/souscription selon la plateforme et l'enregistre via la Cloud
   Function registerPushDevice (Auth + App Check) — jamais d'écriture directe du
   jeton par le client (interdite par les règles). Ne logue jamais le jeton.

   - Chrome/Edge/Firefox/Android-PWA : Firebase Cloud Messaging Web (getToken +
     clé VAPID) → provider `fcm_web`.
   - iPhone/iPad (PWA installée) : Web Push standard (PushManager.subscribe +
     applicationServerKey VAPID) → provider `webpush_ios`.
   ===================================================== */
const PushRegistration = (() => {
  'use strict';

  const DEVICE_KEY = 'mc_push_device_id';

  function caps() {
    const w = (typeof window !== 'undefined') ? window : {};
    const n = (typeof navigator !== 'undefined') ? navigator : {};
    const standalone = !!(w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) ||
      (n.standalone === true);
    const isIOS = /iPad|iPhone|iPod/.test(n.userAgent || '') ||
      (n.platform === 'MacIntel' && (n.maxTouchPoints || 0) > 1);
    const nativeAndroid = !!(w.MedConnectPush && typeof w.MedConnectPush.isNativeAndroid === 'function' && w.MedConnectPush.isNativeAndroid());
    let nativeToken = '';
    if (nativeAndroid) { try { nativeToken = w.MedConnectPush.getCachedToken() || ''; } catch (_) { nativeToken = ''; } }
    return {
      serviceWorker: 'serviceWorker' in n,
      pushManager: (typeof w.PushManager !== 'undefined'),
      notification: (typeof w.Notification !== 'undefined'),
      standalone, isIOS, nativeAndroid, nativeToken,
      permission: (typeof w.Notification !== 'undefined') ? w.Notification.permission : 'unsupported',
    };
  }

  // Fournisseur selon la plateforme (détection de FONCTIONNALITÉ, pas UA seul).
  function pickProvider(c) {
    if (c.nativeAndroid) return 'fcm_android_native';
    if (c.isIOS) return 'webpush_ios';
    return 'fcm_web';
  }

  // État affiché à l'utilisateur (aucun faux « activé »).
  function computeState(c, configured) {
    // App native Android : le jeton FCM natif + la permission POST_NOTIFICATIONS
    // sont gérés côté natif ; l'état reflète la présence du jeton.
    if (c.nativeAndroid) return c.nativeToken ? 'granted' : 'default';
    if (!c.serviceWorker || !c.pushManager || !c.notification) return 'unsupported';
    if (c.isIOS && !c.standalone) return 'ios-needs-install'; // ajouter à l'écran d'accueil
    if (!configured) return 'not-configured'; // clé VAPID absente
    if (c.permission === 'denied') return 'blocked';
    if (c.permission === 'granted') return 'granted';
    return 'default'; // permission jamais demandée
  }

  function vapidKey() {
    try { return (typeof window !== 'undefined' && window.PUSH_VAPID_PUBLIC_KEY) || ''; } catch (_) { return ''; }
  }
  function getState() { return computeState(caps(), !!vapidKey()); }
  function isSupported() { const c = caps(); return c.serviceWorker && c.pushManager && c.notification; }

  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev_' + (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (_) { return 'dev_' + Date.now(); }
  }

  function _fns() { return (typeof firebaseFunctions !== 'undefined' && firebaseFunctions) ? firebaseFunctions : (window.firebaseFunctions || null); }

  async function _registerServer(payload) {
    const fns = _fns();
    if (!fns || !fns.httpsCallable) throw new Error('functions_unavailable');
    await fns.httpsCallable('registerPushDevice')(payload);
  }

  function _b64ToUint8(base64) {
    const pad = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // Opt-in : DOIT être appelé depuis un clic utilisateur (requestPermission).
  async function enable() {
    const c = caps();
    // App native Android : enregistre le jeton FCM natif (provider dédié) — la
    // permission POST_NOTIFICATIONS est demandée par MainActivity.
    if (c.nativeAndroid) {
      const token = c.nativeToken;
      if (!token) return { ok: false, state: 'default' }; // jeton pas encore prêt
      try {
        await _registerServer({
          deviceId: deviceId(), provider: 'fcm_android_native', registrationToken: token,
          platform: 'android', appVariant: 'android-native',
          appVersion: (window.VersionManager && window.VersionManager.getCurrent && window.VersionManager.getCurrent().version) || null,
          locale: navigator.language || null,
          timezone: (Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
          notificationPermission: 'granted',
        });
        return { ok: true, state: 'granted' };
      } catch (e) { console.warn('[PushRegistration] native android :', e && e.message); return { ok: false, state: 'error' }; }
    }
    const key = vapidKey();
    if (!key) return { ok: false, state: 'not-configured' };
    if (c.isIOS && !c.standalone) return { ok: false, state: 'ios-needs-install' };
    if (!isSupported()) return { ok: false, state: 'unsupported' };

    const perm = await window.Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, state: perm === 'denied' ? 'blocked' : 'default' };

    const reg = await navigator.serviceWorker.ready;
    const provider = pickProvider(c);
    const base = {
      deviceId: deviceId(), provider,
      platform: navigator.platform || null,
      appVariant: c.standalone ? 'pwa' : 'web',
      appVersion: (window.VersionManager && window.VersionManager.getCurrent && window.VersionManager.getCurrent().version) || null,
      locale: navigator.language || null,
      timezone: (Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
      notificationPermission: 'granted',
    };
    try {
      if (provider === 'fcm_web' && window.firebase && firebase.messaging) {
        const messaging = firebase.messaging();
        const token = await messaging.getToken({ vapidKey: key, serviceWorkerRegistration: reg });
        if (!token) return { ok: false, state: 'error' };
        await _registerServer({ ...base, registrationToken: token });
      } else {
        // Web Push standard (iOS/Safari) ou repli.
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToUint8(key) });
        await _registerServer({ ...base, provider: c.isIOS ? 'webpush_ios' : provider, webPushSubscription: sub.toJSON() });
      }
      return { ok: true, state: 'granted' };
    } catch (e) {
      console.warn('[PushRegistration] enable :', e && e.message);
      return { ok: false, state: 'error' };
    }
  }

  async function disable() {
    try {
      const fns = _fns();
      if (fns && fns.httpsCallable) await fns.httpsCallable('unregisterPushDevice')({ deviceId: deviceId() });
      const reg = navigator.serviceWorker && await navigator.serviceWorker.ready;
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      return { ok: true };
    } catch (e) { console.warn('[PushRegistration] disable :', e && e.message); return { ok: false }; }
  }

  return {
    isSupported, getState, enable, disable, deviceId,
    _internal: { caps, pickProvider, computeState },
  };
})();

if (typeof window !== 'undefined') window.PushRegistration = PushRegistration;
if (typeof module !== 'undefined' && module.exports) module.exports = PushRegistration;
