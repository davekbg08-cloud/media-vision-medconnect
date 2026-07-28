/* =====================================================
   Tests — firebase.json : en-têtes de sécurité Firebase Hosting
   (audit "workflows mobile/desktop", section 22)

   MISE À JOUR v2.9.42 : la CSP, après une phase d'observation en
   Content-Security-Policy-Report-Only et un audit complet des ressources
   réellement chargées, est passée en mode BLOQUANT
   (Content-Security-Policy). Le contrat détaillé (tous les hôtes, les
   directives de durcissement) est verrouillé par
   tests/csp-hosting-headers-v2942.test.js ; ce fichier-ci ne garde que
   les vérifications transverses des en-têtes de sécurité. Les autres
   en-têtes (X-Frame-Options, HSTS, Permissions-Policy) restent inchangés.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '..', 'firebase.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function headerValue(headers, key) {
  const entry = headers.find(h => h.key === key);
  return entry?.value;
}

test('firebase.json reste un JSON valide après ajout des en-têtes de sécurité', () => {
  assert.doesNotThrow(() => loadConfig());
});

test("firebase.json : les en-têtes de sécurité s'appliquent à TOUTES les routes ('**')", () => {
  const config = loadConfig();
  const block = config.hosting.headers.find(h => h.source === '**');
  assert.ok(block, "un bloc headers pour source '**' doit exister");
});

test("firebase.json : conserve les en-têtes déjà en place (X-Content-Type-Options, Referrer-Policy)", () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  assert.strictEqual(headerValue(headers, 'X-Content-Type-Options'), 'nosniff');
  assert.strictEqual(headerValue(headers, 'Referrer-Policy'), 'strict-origin-when-cross-origin');
});

test('firebase.json : ajoute X-Frame-Options (protection clickjacking)', () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  assert.strictEqual(headerValue(headers, 'X-Frame-Options'), 'DENY');
});

test('firebase.json : ajoute Strict-Transport-Security (Firebase Hosting sert toujours en HTTPS)', () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  const hsts = headerValue(headers, 'Strict-Transport-Security');
  assert.match(hsts, /max-age=\d+/);
  assert.match(hsts, /includeSubDomains/);
});

test('firebase.json : Permissions-Policy autorise la géolocalisation (utilisée réellement par js/map.js) mais refuse caméra/micro/paiement (jamais utilisés)', () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  const pp = headerValue(headers, 'Permissions-Policy');
  assert.match(pp, /geolocation=\(self\)/);
  assert.match(pp, /camera=\(\)/);
  assert.match(pp, /microphone=\(\)/);
  assert.match(pp, /payment=\(\)/);
});

test("firebase.json : la CSP est désormais en mode BLOQUANT (Content-Security-Policy), plus Report-Only", () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  assert.ok(headerValue(headers, 'Content-Security-Policy'),
    'la CSP bloquante (Content-Security-Policy) doit être présente');
  assert.strictEqual(headerValue(headers, 'Content-Security-Policy-Report-Only'), undefined,
    'plus de header Report-Only une fois la CSP promue en bloquant');
});

test('firebase.json : la CSP bloquante autorise réellement tous les domaines externes utilisés par l\'app (Firebase, unpkg/Leaflet, tuiles OpenStreetMap, reCAPTCHA)', () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  const csp = headerValue(headers, 'Content-Security-Policy');
  assert.match(csp, /https:\/\/www\.gstatic\.com/, 'SDK Firebase (js/firebase-config.js, firebase-*.js)');
  assert.match(csp, /https:\/\/unpkg\.com/, 'Leaflet (js/map.js)');
  assert.match(csp, /https:\/\/\*\.tile\.openstreetmap\.org/, 'tuiles de carte (js/map.js)');
  assert.match(csp, /https:\/\/\*\.googleapis\.com/, 'Firestore/Auth/App Check');
  assert.match(csp, /https:\/\/\*\.firebaseio\.com/, 'Realtime Database éventuel/legacy');
  assert.match(csp, /https:\/\/www\.google\.com/, 'reCAPTCHA Enterprise (App Check)');
});

test("firebase.json : la CSP interdit les plugins (object-src 'none') et fige base-uri/form-action sur 'self'", () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  const csp = headerValue(headers, 'Content-Security-Policy');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
});
