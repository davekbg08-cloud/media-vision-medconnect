// ========== MedConnect — Map / Geolocation Module ==========

window.MapModule = (() => {
  let map = null;
  let userMarker = null;
  let markers = [];

  function initMap() {
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
    if (navigator.geolocation) {
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
          <button class="btn btn-ghost btn-sm" onclick="MapModule.searchNearby('hospital')">🏥 Hôpitaux</button>
          <button class="btn btn-ghost btn-sm" onclick="MapModule.searchNearby('pharmacy')">💊 Pharmacies</button>
        </div>
      </div>
      <div class="card" style="padding:.75rem">
        <div id="map-container" style="height:420px;border-radius:var(--radius-sm);overflow:hidden"></div>
      </div>
      <div id="map-results" style="margin-top:1rem"></div>`;
    setTimeout(initMap, 50);
  }

  function destroyMap() {
    if (map) {
      map.remove();
      map = null;
      userMarker = null;
      markers = [];
    }
  }

  return { render, initMap, searchNearby, focusOn, destroyMap };
})();
