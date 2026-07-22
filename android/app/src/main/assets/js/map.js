// ========== MedConnect — Map / Geolocation Module ==========

window.MapModule = (() => {
  let map = null;
  let userMarker = null;
  let markers = [];
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── Chargement de Leaflet À LA DEMANDE (chantier B, perf) ──
     Leaflet (JS + CSS, ~150 Ko) n'est plus chargé au démarrage de
     l'app : il ne l'est qu'à la PREMIÈRE ouverture d'une carte, via
     LazyLoader. Idempotent (une seule injection, promesse partagée).
     Le service worker précache toujours ces URLs → carte hors ligne OK.
     Toutes les fonctions qui utilisent `L` passent d'abord par
     ensureLeaflet(). */
  const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  let _leafletPromise = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!_leafletPromise) {
      const loader = window.LazyLoader;
      if (!loader) return Promise.reject(new Error('LazyLoader indisponible'));
      _leafletPromise = Promise.all([
        loader.loadCss(LEAFLET_CSS),
        loader.load(LEAFLET_JS, 'L'),
      ]).then(() => window.L).catch(err => { _leafletPromise = null; throw err; });
    }
    return _leafletPromise;
  }

  /* Message honnête si Leaflet ne peut pas être chargé (ex. tout premier
     accès à la carte en étant hors ligne, avant que le SW ne l'ait mis
     en cache) — au lieu d'une carte vide silencieuse. */
  function showMapLoadError() {
    const c = document.getElementById('map-container');
    if (c) c.innerHTML = '<p class="muted" style="padding:1rem;text-align:center">🗺️ Carte indisponible pour le moment — une connexion est requise au premier chargement.</p>';
  }

  function initMap(options = {}) {
    const container = document.getElementById('map-container');
    if (!container) return;

    // Reset if already initialized
    if (map) {
      map.invalidateSize();
      return;
    }

    // Default to Kinshasa coordinates
    map = L.map('map-container').setView([-4.3217, 15.3125], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    // Try to get user location
    if (options.locate !== false && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          map.setView([latitude, longitude], 14);

          if (userMarker) map.removeLayer(userMarker);
          userMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
              className: 'user-marker',
              html: '<div style="background:var(--primary);width:16px;height:16px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>',
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            })
          }).addTo(map).bindPopup('📍 Votre position');
        },
        () => {},
        { timeout: 10000 }
      );
    }

    setTimeout(() => map.invalidateSize(), 200);
  }

  function clearMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
  }

  async function searchNearby(type) {
    try { await ensureLeaflet(); } catch { return showMapLoadError(); }
    if (!map) initMap();
    await new Promise(r => setTimeout(r, 300));

    const center = map.getCenter();
    const resultsDiv = document.getElementById('map-results');

    resultsDiv.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:1rem;">🔄 Recherche en cours...</p>';
    clearMarkers();

    // Use Overpass API to find nearby places
    const amenity = type === 'pharmacy' ? 'pharmacy' : 'hospital';
    const radius = 5000; // 5km
    const query = `[out:json][timeout:10];node["amenity"="${amenity}"](around:${radius},${center.lat},${center.lng});out body;`;

    try {
      const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (!data.elements || data.elements.length === 0) {
        showNoResults(type);
        return;
      }

      const icon = type === 'pharmacy' ? '🏪' : '🏥';
      const color = type === 'pharmacy' ? '#8B5CF6' : '#10B981';

      data.elements.forEach(el => {
        const name = el.tags?.name || `${icon} ${type === 'pharmacy' ? 'Pharmacie' : 'Hôpital'}`;
        const marker = L.marker([el.lat, el.lon], {
          icon: L.divIcon({
            className: 'place-marker',
            html: `<div style="background:${color};color:white;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${icon} ${name}</div>`,
            iconSize: [0, 0],
          })
        }).addTo(map).bindPopup(`<strong>${name}</strong><br>${el.tags?.['addr:street'] || ''}`);
        markers.push(marker);
      });

      resultsDiv.innerHTML = `
        <div class="glass" style="padding:1rem;border-radius:var(--radius-md);">
          <h4 style="margin-bottom:0.5rem;">${icon} ${data.elements.length} ${type === 'pharmacy' ? 'pharmacie(s)' : 'hôpital/hôpitaux'} trouvé(s)</h4>
          <div style="max-height:200px;overflow-y:auto;">
            ${data.elements.slice(0, 10).map(el => `
              <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <strong style="font-size:0.9rem;">${el.tags?.name || 'Sans nom'}</strong>
                  <p style="font-size:0.75rem;color:var(--text-muted);">${el.tags?.['addr:street'] || 'Adresse non disponible'}</p>
                </div>
                <button class="btn btn-sm btn-ghost" onclick="MapModule.focusOn(${el.lat}, ${el.lon})">📍</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      // Fit map to show all markers
      if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
      }

    } catch (err) {
      showNoResults(type);
    }
  }

  function showNoResults(type) {
    const resultsDiv = document.getElementById('map-results');
    const icon = type === 'pharmacy' ? '🏪' : '🏥';

    resultsDiv.innerHTML = `
      <div class="glass" style="padding:1rem;border-radius:var(--radius-md);">
        <h4 style="margin-bottom:0.5rem;">${icon} Aucun résultat disponible</h4>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">
          Aucun établissement réel n'a été trouvé autour de cette zone.
        </p>
      </div>
    `;
  }

  async function showRegisteredEstablishments() {
    try { await ensureLeaflet(); } catch { return showMapLoadError(); }
    if (!map) initMap();
    await new Promise(r => setTimeout(r, 300));
    clearMarkers();

    const resultsDiv = document.getElementById('map-results');
    const establishments = (window.HospitalsRegistry?.getHospitals?.() || [])
      .filter(h => h.status !== 'inactive' && h.latitude !== '' && h.longitude !== '' &&
        !Number.isNaN(Number(h.latitude)) && !Number.isNaN(Number(h.longitude)));

    if (!establishments.length) {
      resultsDiv.innerHTML = `
        <div class="glass" style="padding:1rem;border-radius:var(--radius-sm);">
          <h4 style="margin-bottom:.5rem;">🏥 Aucun établissement enregistré avec GPS</h4>
          <p style="font-size:.75rem;color:var(--text-muted);">
            Ajoutez latitude et longitude depuis Administration > Établissements.
          </p>
        </div>`;
      return;
    }

    establishments.forEach(h => {
      const lat = Number(h.latitude);
      const lng = Number(h.longitude);
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'place-marker',
          html: `<div style="background:#10B981;color:white;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);">🏥 ${esc(h.name)}</div>`,
          iconSize: [0, 0],
        })
      }).addTo(map).bindPopup(`<strong>${esc(h.name)}</strong><br>${esc(h.address || h.city || '')}`);
      markers.push(marker);
    });

    resultsDiv.innerHTML = `
      <div class="glass" style="padding:1rem;border-radius:var(--radius-sm);">
        <h4 style="margin-bottom:.5rem;">🏥 ${establishments.length} établissement(s) MedConnect</h4>
        <div style="max-height:200px;overflow-y:auto;">
          ${establishments.map(h => `
            <div style="padding:.5rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong style="font-size:.9rem;">${esc(h.name)}</strong>
                <p style="font-size:.75rem;color:var(--text-muted);">${esc(h.address || h.city || 'Adresse non disponible')}</p>
              </div>
              <button class="btn btn-sm btn-ghost" onclick="MapModule.focusOn(${Number(h.latitude)}, ${Number(h.longitude)})">📍</button>
            </div>
          `).join('')}
        </div>
      </div>`;

    if (markers.length > 0) {
      const group = new L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  function canReadCloud() {
    return typeof firebaseReady !== 'undefined' && firebaseReady &&
      typeof firebaseDB !== 'undefined' && firebaseDB;
  }

  async function getCloudVisiblePharmacies() {
    if (!canReadCloud()) return [];
    const rows = [];
    const queries = [
      firebaseDB.collection('users')
        .where('role', '==', 'pharmacist')
        .where('status', 'in', ['active', 'approved'])
        .where('isLocationVisible', '==', true),
      firebaseDB.collection('pharmacies')
        .where('status', 'in', ['active', 'approved'])
        .where('isLocationVisible', '==', true),
    ];
    for (const query of queries) {
      try {
        const snap = await query.get();
        snap.docs.forEach(doc => rows.push({ uid: doc.id, ...doc.data() }));
      } catch (e) {
        console.warn('[Map] Requête établissements échouée :', e?.message || e);
      }
    }
    return rows;
  }

  async function getVisiblePharmacies() {
    const byUid = new Map();
    (DB.getUsers?.() || []).forEach(u => byUid.set(u.uid, u));
    DB.getAccounts().forEach(a => {
      if (!byUid.has(a.uid)) byUid.set(a.uid, a);
      else byUid.set(a.uid, { ...a, ...byUid.get(a.uid) });
    });
    (await getCloudVisiblePharmacies()).forEach(u => {
      if (!u.uid) return;
      byUid.set(u.uid, { ...(byUid.get(u.uid) || {}), ...u });
    });
    return [...byUid.values()].filter(u => {
      const loc = u.pharmacyLocation;
      const active = u.status === 'active' || (u.status === 'approved' && loc);
      return u.role === 'pharmacist' &&
        active &&
        u.isLocationVisible === true &&
        loc &&
        !Number.isNaN(Number(loc.latitude)) &&
        !Number.isNaN(Number(loc.longitude));
    });
  }

  async function showVisiblePharmacies() {
    try { await ensureLeaflet(); } catch { return showMapLoadError(); }
    if (!map) initMap({ locate: false });
    await new Promise(r => setTimeout(r, 300));
    clearMarkers();

    const resultsDiv = document.getElementById('map-results');
    const pharmacies = await getVisiblePharmacies();

    if (!pharmacies.length) {
      resultsDiv.innerHTML = `
        <div class="glass" style="padding:1rem;border-radius:var(--radius-sm);">
          <h4 style="margin-bottom:.5rem;">💊 Aucune pharmacie visible</h4>
          <p style="font-size:.78rem;color:var(--text-muted);">
            Les pharmacies apparaissent ici après qu'un pharmacien a ajouté sa localisation dans Paramètres > Localisation.
          </p>
        </div>`;
      return;
    }

    pharmacies.forEach(ph => {
      const loc = ph.pharmacyLocation;
      const lat = Number(loc.latitude);
      const lng = Number(loc.longitude);
      const name = ph.pharmacy || ph.name || 'Pharmacie';
      const contact = ph.phone || ph.matricule || ph.username || '';
      const popup = `
        <strong>${esc(name)}</strong><br>
        ${contact ? `<span>${esc(contact)}</span><br>` : ''}
        <button class="btn btn-ghost btn-xs" style="margin-top:.4rem"
          onclick="MapModule.openDirections(${lat},${lng})">Itinéraire</button>`;
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'place-marker',
          html: `<div style="background:#8B5CF6;color:white;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.3);">💊 ${esc(name)}</div>`,
          iconSize: [0, 0],
        })
      }).addTo(map).bindPopup(popup);
      markers.push(marker);
    });

    resultsDiv.innerHTML = `
      <div class="glass" style="padding:1rem;border-radius:var(--radius-sm);">
        <h4 style="margin-bottom:.5rem;">💊 ${pharmacies.length} pharmacie(s) visible(s)</h4>
        <div style="max-height:240px;overflow-y:auto;">
          ${pharmacies.map(ph => {
            const loc = ph.pharmacyLocation;
            const name = ph.pharmacy || ph.name || 'Pharmacie';
            const contact = ph.phone || ph.matricule || ph.username || '';
            return `
              <div style="padding:.55rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:.75rem;align-items:center;">
                <div style="min-width:0">
                  <strong style="font-size:.9rem;">${esc(name)}</strong>
                  <p style="font-size:.75rem;color:var(--text-muted);">${contact ? esc(contact) : 'Contact non renseigné'}</p>
                </div>
                <div style="display:flex;gap:.35rem;flex-shrink:0">
                  <button class="btn btn-sm btn-ghost" onclick="MapModule.focusOn(${Number(loc.latitude)}, ${Number(loc.longitude)})">📍</button>
                  <button class="btn btn-sm btn-ghost" onclick="MapModule.openDirections(${Number(loc.latitude)}, ${Number(loc.longitude)})">Itinéraire</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    if (markers.length > 0) {
      const group = new L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }

  function openDirections(lat, lng) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function focusOn(lat, lng) {
    if (map) {
      map.setView([lat, lng], 16);
    }
  }

  function render(main) {
    destroyMap();
    main.innerHTML = `
      <div class="page-header">
        <h2>🗺️ ${window.I18n?.t ? I18n.t('map_title') : 'Établissements de Santé'}</h2>
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" onclick="MapModule.showRegisteredEstablishments()">🏥 Enregistrés</button>
          <button class="btn btn-ghost btn-sm" onclick="MapModule.searchNearby('hospital')">🏥 Hôpitaux</button>
          <button class="btn btn-ghost btn-sm" onclick="MapModule.searchNearby('pharmacy')">💊 Pharmacies</button>
        </div>
      </div>
      <div class="card" style="padding:.75rem">
        <div id="map-container" style="height:420px;border-radius:var(--radius-sm);overflow:hidden"></div>
      </div>
      <div id="map-results" style="margin-top:1rem"></div>`;
    setTimeout(() => { ensureLeaflet().then(() => initMap()).catch(showMapLoadError); }, 50);
  }

  function renderPharmacyMap(main) {
    destroyMap();
    main.innerHTML = `
      <div class="page-header">
        <h2>💊 Carte des pharmacies</h2>
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" onclick="MapModule.showVisiblePharmacies()">💊 Pharmacies visibles</button>
          <button class="btn btn-ghost btn-sm" onclick="MapModule.searchNearby('pharmacy')">Autour de moi</button>
        </div>
      </div>
      <div class="card" style="padding:.75rem">
        <div id="map-container" style="height:420px;border-radius:var(--radius-sm);overflow:hidden"></div>
      </div>
      <div id="map-results" style="margin-top:1rem"></div>`;
    setTimeout(() => {
      ensureLeaflet().then(() => {
        initMap({ locate: false });
        showVisiblePharmacies();
      }).catch(showMapLoadError);
    }, 50);
  }

  function destroyMap() {
    if (map) {
      map.remove();
      map = null;
      userMarker = null;
      markers = [];
    }
  }

  return {
    render, renderPharmacyMap,
    initMap, searchNearby, showRegisteredEstablishments, showVisiblePharmacies,
    focusOn, openDirections, destroyMap
  };
})();
