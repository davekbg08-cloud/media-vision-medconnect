/* =====================================================
   MedConnect 2.0 — Service Worker
   ===================================================== */
const CACHE = 'medconnect-v2.1';

const ASSETS = [
  './', './index.html', './css/style.css',
  './js/firebase-config.js',
  './js/i18n.js', './js/db.js', './js/currency.js',
  './js/access_control.js', './js/network.js',
  './js/hospitals_registry.js', './js/timeline.js',
  './js/appointments.js', './js/lab.js', './js/map.js',
  './js/patient.js', './js/hospital.js', './js/pharmacy.js',
  './js/share.js', './js/admin.js', './js/settings.js',
  './js/auth.js', './js/app.js',
  './assets/icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Ne pas cacher Firebase
  if (e.request.url.includes('firestore.googleapis.com') ||
      e.request.url.includes('firebase')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => e.request.destination === 'document'
        ? caches.match('./index.html') : undefined);
    })
  );
});
