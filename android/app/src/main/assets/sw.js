/* =====================================================
   MedConnect 2.0 — Service Worker
   Cache-first + offline fallback
   ===================================================== */
const CACHE = 'medconnect-v2.0';

const ASSETS = [
  './', './index.html',
  './manifest.json',
  './css/style.css',
  './js/i18n.js', './js/db.js', './js/currency.js',
  './js/access_control.js', './js/network.js',
  './js/hospitals_registry.js', './js/auth.js',
  './js/timeline.js', './js/appointments.js', './js/lab.js',
  './js/app.js', './js/patient.js', './js/hospital.js',
  './js/pharmacy.js', './js/map.js', './js/share.js',
  './js/settings.js',
  './assets/icon.png', './assets/icon-192.png', './assets/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Outfit:wght@400;600;700;800&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .catch(console.warn)
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => e.request.destination === 'document' ? caches.match('./index.html') : undefined);
    })
  );
});
