/* =====================================================
   Tests — firebase.json : en-têtes de sécurité Firebase Hosting
   (audit "workflows mobile/desktop", section 22)

   Déploiement PROGRESSIF, jamais brutal — même philosophie que
   l'activation d'App Check (docs/FIREBASE_APP_CHECK_SETUP.md) : la CSP
   est ajoutée en mode Content-Security-Policy-Report-Only (violations
   journalisées par le navigateur, JAMAIS bloquées) pour observer le
   comportement réel avant d'envisager un jour un mode bloquant. Les
   autres en-têtes (X-Frame-Options, HSTS, Permissions-Policy) sont
   sans ambiguïté et n'affectent aucune fonctionnalité existante.
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

test("firebase.json : la CSP est en mode Report-Only (jamais bloquante) — déploiement progressif obligatoire", () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  assert.strictEqual(headerValue(headers, 'Content-Security-Policy'), undefined,
    'aucune CSP BLOQUANTE ne doit être ajoutée avant observation en mode Report-Only');
  assert.ok(headerValue(headers, 'Content-Security-Policy-Report-Only'),
    'la CSP doit exister en mode Report-Only');
});

test('firebase.json : la CSP (Report-Only) autorise réellement tous les domaines externes utilisés par l\'app (Firebase, unpkg/Leaflet, tuiles OpenStreetMap, reCAPTCHA)', () => {
  const config = loadConfig();
  const headers = config.hosting.headers.find(h => h.source === '**').headers;
  const csp = headerValue(headers, 'Content-Security-Policy-Report-Only');
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
  const csp = headerValue(headers, 'Content-Security-Policy-Report-Only');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
});
