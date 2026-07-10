/* =====================================================
   MedConnect 2.0 — Service Worker
   Optimisation chargement / PWA
   ===================================================== */
const CACHE = 'medconnect-v4.7';

const ASSETS = [
  './', './index.html', './css/style.css', './css/establishments-balance.css',
  './css/hospital-desktop.css', './css/medical-record-desktop.css', './css/mobile-layout-fixes.css',
  './config/app-version.json', './js/version-manager.js',
  // SDK Firebase : ne passait JAMAIS dans le cache dynamique (réponse
  // opaque cross-origin rejetée par le check type !== 'opaque') — la
  // PWA hors-ligne échouait au chargement. Le précache via addAll
  // accepte les réponses opaques (même mécanisme que Leaflet ci-dessous).
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  './js/firebase-config.js',
  // Contrat d'échange + transfert d'urgence (manquaient au précache
  // depuis leur intégration — le fetch network-first masquait le trou
  // en ligne, mais le hors-ligne PWA les perdait)
  './js/exchange-bridge.js', './js/medical-record-sharing.js', './js/emergency-transfer.js',
  './js/sync-badge.js',
  // Bundle desktop hôpital (adapté)
  './js/cloud-db.js', './js/hospital-permissions.js', './js/hospital-capabilities.js', './js/hospital-auth.js', './js/hospital-i18n.js', './js/hospital-subscription.js',
  './js/medical-ai.js', './js/hospital-beds.js', './js/hospital-lab.js',
  './js/hospital-desktop-ui.js', './js/hospital-reception.js', './js/hospital-auth.js',
  './js/medical-record-desktop.js',
  './js/i18n.js', './js/db.js', './js/currency.js',
  './js/access_control.js', './js/haptic_feedback.js',
  './js/transfer_service.js', './js/network.js', './js/inbox_message_controls.js', './js/transfer_ui_patch.js',
  './js/hospitals_registry.js', './js/timeline.js',
  './js/appointments.js', './js/lab.js', './js/map.js',
  './js/patient.js', './js/hospital.js', './js/pharmacy.js',
  './js/share.js', './js/admin.js', './js/settings.js',
  './js/prescription-flow-fix.js',
  './js/auth.js', './js/registration-submit-flow.js', './js/app.js',
  './js/global_back_button.js', './js/patient_edit_guard.js', './js/auth-ui-cleanup.js',
  './js/affiliation-cleanup.js',
  './assets/icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .catch(error => console.warn('[SW] Pré-cache partiel :', error))
  );
  // PAS de self.skipWaiting() automatique ici : un nouveau SW installé
  // doit rester "waiting" pendant qu'un onglet existant tourne encore,
  // pour que VersionManager puisse demander confirmation ("Recharger
  // maintenant ?") avant de basculer — jamais une mise à jour forcée
  // en silence pendant qu'un utilisateur travaille. skipWaiting() n'est
  // déclenché que sur demande explicite via le listener 'message'
  // ci-dessous (VersionManager.reloadNow / applyUpdate).
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Permet à VersionManager (js/version-manager.js) de faire passer un
// nouveau SW "waiting" en contrôle immédiat quand l'utilisateur
// choisit explicitement "Mettre à jour" / "Recharger maintenant" —
// jamais automatiquement de son propre chef.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function shouldBypassCache(request) {
  const url = request.url;
  return request.method !== 'GET' ||
    url.includes('firestore.googleapis.com') ||
    url.includes('firebase') ||
    url.includes('googleapis.com/identitytoolkit') ||
    url.includes('securetoken.googleapis.com') ||
    url.endsWith('.apk') ||
    url.includes('/downloads/');
}

function isFreshAppShellRequest(request) {
  return request.mode === 'navigate' ||
    request.destination === 'document' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.url.endsWith('.js') ||
    request.url.endsWith('.css') ||
    request.url.endsWith('/index.html') ||
    // config/app-version.json : la détection de mise à jour (Version
    // Manager) doit toujours comparer contre le fichier le plus frais
    // possible, jamais une copie mise en cache potentiellement ancienne.
    request.url.includes('/config/');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate' || request.destination === 'document') {
      return caches.match('./index.html');
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.status === 200 && response.type !== 'opaque') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  return cached || networkPromise;
}

self.addEventListener('fetch', event => {
  if (shouldBypassCache(event.request)) return;

  event.respondWith(
    isFreshAppShellRequest(event.request)
      ? networkFirst(event.request)
      : staleWhileRevalidate(event.request)
  );
});