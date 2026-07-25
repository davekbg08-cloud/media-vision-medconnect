/* =====================================================
   Tests — Sécurité production (chantier 12, v2.9.42)

   Verrouille l'état de durcissement déjà en place :
   - en-têtes de sécurité présents côté Hosting (firebase.json) ;
   - l'inspecteur de synchronisation (settings.js) et l'export de diagnostic
     n'exposent JAMAIS de contenu clinique (identifiants/collections/horodatages
     uniquement) ;
   - App Check est activé côté client.

   L'ENFORCEMENT App Check et la PROMOTION de la CSP en mode bloquant sont des
   étapes go-live gatées (staging d'abord) — documentées dans
   docs/PRODUCTION_READINESS_v2.9.42.md, pas appliquées ici pour ne pas casser
   la production avant validation.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('firebase.json expose les en-têtes de sécurité attendus', () => {
  const j = JSON.parse(read('firebase.json'));
  const headers = j.hosting.headers[0].headers.map(h => h.key);
  for (const h of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Strict-Transport-Security', 'Permissions-Policy']) {
    assert.ok(headers.includes(h), `en-tête ${h} attendu`);
  }
  const xfo = j.hosting.headers[0].headers.find(h => h.key === 'X-Frame-Options');
  assert.strictEqual(xfo.value, 'DENY');
  // Une CSP est présente (report-only tant que l'enforcement n'est pas validé).
  assert.ok(headers.some(h => /Content-Security-Policy/.test(h)), 'une CSP doit être déclarée');
});

test('l\'inspecteur de synchronisation ne rend aucun champ clinique', () => {
  const s = read('js/settings.js');
  // _opLabel/_opRow ne doivent référencer que des métadonnées (collection,
  // docId, module, rôle, horodatage, code d'erreur), jamais de contenu.
  const opLabel = s.slice(s.indexOf('function _opLabel'), s.indexOf('function _opLabel') + 300);
  const opRow = s.slice(s.indexOf('function _opRow'), s.indexOf('function _opRow') + 1400);
  for (const forbidden of ['firstname', 'lastname', 'diagnos', '.body', 'medicines', '.data']) {
    assert.ok(!opLabel.includes(forbidden), `_opLabel ne doit pas rendre ${forbidden}`);
    assert.ok(!opRow.includes(forbidden), `_opRow ne doit pas rendre ${forbidden}`);
  }
});

test('l\'export de diagnostic passe par exportOutboxDiagnostic (metadata-only)', () => {
  const s = read('js/settings.js');
  assert.match(s, /DB\?\.exportOutboxDiagnostic\?\.\(\)/,
    'l\'export partageable doit utiliser la projection metadata-only');
});

test('App Check est activé côté client', () => {
  const cfg = read('js/firebase-config.js');
  assert.match(cfg, /activateAppCheck\(\)/, 'activateAppCheck doit être appelé à l\'init');
  assert.match(cfg, /ReCaptchaEnterpriseProvider/, 'fournisseur App Check déclaré');
});

test('la CSP autorise les origines réellement utilisées et interdit object/base arbitraires', () => {
  const j = JSON.parse(read('firebase.json'));
  const csp = j.hosting.headers[0].headers.find(h => /Content-Security-Policy/.test(h.key)).value;
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  // Les origines Cloud Functions (chantiers 6/7) sont autorisées.
  assert.match(csp, /cloudfunctions\.net/);
});
