/* =====================================================
   Tests — Chantier B (performance, v2.9.39)
   Leaflet chargé À LA DEMANDE via LazyLoader plutôt qu'au démarrage.
   - LazyLoader : API + idempotence ;
   - index.html : Leaflet n'est plus chargé eager, LazyLoader l'est ;
   - map.js : toutes les entrées passent par ensureLeaflet() ;
   - sw.js : Leaflet ET lazy-loader.js restent précachés (hors ligne OK).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadIntoWindow } = require('./helper');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const indexSrc = read('index.html');
const mapSrc   = read('js/map.js');
const swSrc    = read('sw.js');
const loaderSrc = read('js/lazy-loader.js');

/* ── LazyLoader ─────────────────────────────────────── */
test('LazyLoader se charge et expose load() + loadCss()', () => {
  const win = loadIntoWindow(['js/lazy-loader.js']);
  assert.ok(win.LazyLoader, 'LazyLoader doit être exporté');
  assert.strictEqual(typeof win.LazyLoader.load, 'function');
  assert.strictEqual(typeof win.LazyLoader.loadCss, 'function');
});

test('LazyLoader.load résout immédiatement si le global attendu existe déjà', async () => {
  const win = loadIntoWindow(['js/lazy-loader.js']);
  win.DejaLa = { ok: true };
  const res = await win.LazyLoader.load('https://exemple/inexistant.js', 'DejaLa');
  assert.deepStrictEqual(res, { ok: true }, 'ne doit pas réinjecter si le global est présent');
});

test('LazyLoader est idempotent (cache de promesses par ressource)', () => {
  assert.match(loaderSrc, /_cache\.has\(src\)/);
  assert.match(loaderSrc, /_cache\.set\(src, p\)/);
  assert.match(loaderSrc, /_cache\.has\(href\)/);
});

/* ── index.html ─────────────────────────────────────── */
test('index.html ne charge PLUS Leaflet au démarrage (ni JS ni CSS eager)', () => {
  assert.doesNotMatch(indexSrc, /<script[^>]+leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.doesNotMatch(indexSrc, /<link[^>]+leaflet@1\.9\.4\/dist\/leaflet\.css/);
});

test('index.html charge js/lazy-loader.js avant les modules qui l\'utilisent', () => {
  // On cible les BALISES <script src="…"> (les commentaires citent aussi
  // "js/map.js", d'où une recherche stricte sur src=).
  const loaderIdx = indexSrc.indexOf('src="js/lazy-loader.js"');
  const mapIdx = indexSrc.indexOf('src="js/map.js"');
  assert.ok(loaderIdx !== -1, 'lazy-loader.js doit être inclus');
  assert.ok(mapIdx !== -1 && loaderIdx < mapIdx, 'lazy-loader.js doit précéder map.js');
});

/* ── map.js ─────────────────────────────────────────── */
test('map.js définit ensureLeaflet() via LazyLoader (JS + CSS)', () => {
  assert.match(mapSrc, /function ensureLeaflet\(\)/);
  assert.match(mapSrc, /LazyLoader/);
  assert.match(mapSrc, /loader\.load\(LEAFLET_JS, 'L'\)/);
  assert.match(mapSrc, /loader\.loadCss\(LEAFLET_CSS\)/);
});

test('map.js : render/renderPharmacyMap initialisent la carte APRÈS ensureLeaflet()', () => {
  // Plus aucun setTimeout(initMap) direct : on passe toujours par ensureLeaflet.
  assert.doesNotMatch(mapSrc, /setTimeout\(initMap,/);
  assert.match(mapSrc, /ensureLeaflet\(\)\.then\(\(\) => initMap\(\)\)\.catch\(showMapLoadError\)/);
});

test('map.js : les 3 entrées async gardent ensureLeaflet() avant d\'utiliser L', () => {
  for (const fn of ['searchNearby', 'showRegisteredEstablishments', 'showVisiblePharmacies']) {
    const i = mapSrc.indexOf(`async function ${fn}(`);
    assert.ok(i !== -1, `${fn} doit exister`);
    const head = mapSrc.slice(i, i + 160);
    assert.match(head, /await ensureLeaflet\(\)/, `${fn} doit attendre ensureLeaflet()`);
  }
});

/* ── sw.js (hors ligne préservé) ────────────────────── */
test('sw.js précache toujours Leaflet (CSS + JS) → carte hors ligne préservée', () => {
  assert.match(swSrc, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css/);
  assert.match(swSrc, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/);
});

test('sw.js précache le nouveau js/lazy-loader.js', () => {
  assert.match(swSrc, /'\.\/js\/lazy-loader\.js'/);
});
