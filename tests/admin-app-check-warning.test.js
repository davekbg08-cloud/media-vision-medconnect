/* =====================================================
   Tests — js/admin.js : avertissement non bloquant App Check
   (chantier "reception/affiliation sans régression", section 13)

   Vérifie que le dashboard admin signale, de façon purement
   informative et jamais bloquante, quand APP_CHECK_SITE_KEY
   (js/firebase-config.js) n'est pas configurée — sans jamais présenter
   App Check comme un remplacement des règles Firestore.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function fnBody() {
  const start = src.indexOf('function appCheckWarningBanner(');
  const end = src.indexOf('function renderDashboard(', start);
  assert.ok(start !== -1 && end !== -1, 'appCheckWarningBanner introuvable');
  return src.slice(start, end);
}

test('appCheckWarningBanner() lit APP_CHECK_SITE_KEY sans jamais lever (typeof, pas d\'accès direct)', () => {
  const body = fnBody();
  assert.match(body, /typeof APP_CHECK_SITE_KEY !== 'undefined'/);
});

test("appCheckWarningBanner() ne bloque aucune action (retourne une chaîne vide quand configuré, jamais une modale/redirection)", () => {
  const body = fnBody();
  assert.match(body, /if \(configured\) return '';/);
  assert.doesNotMatch(body, /App\.openModal|navigate\(|window\.location/);
});

test("appCheckWarningBanner() ne présente jamais App Check comme un remplacement des règles Firestore", () => {
  const body = fnBody();
  assert.match(body, /règles Firestore/);
  assert.match(body, /couche complémentaire/);
});

test('renderDashboard() insère bien le bandeau App Check dans le rendu', () => {
  const start = src.indexOf('function renderDashboard(');
  const section = src.slice(start, start + 2000);
  assert.match(section, /\$\{appCheckWarningBanner\(\)\}/);
});
