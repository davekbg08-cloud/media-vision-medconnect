/* =====================================================
   Tests — arrêt des écritures mortes vers mc_affiliations

   Découvert en auditant le dépôt : mc_affiliations
   (firestore.rules, allow write: if isAdmin();) n'est jamais lue par
   l'app — seule affiliation_requests l'est (js/db.js) — et pourtant
   js/hospitals_registry.js saveAffiliations() et
   js/affiliation-cleanup.js markCloudRemoved() y écrivaient
   systématiquement, provoquant un rejet permanent (pour l'appelant
   non-admin réel) mis en file de réessai silencieuse indéfiniment.
   Cette écriture morte est retirée ; le stockage local
   (LEGACY_REQ_KEY / KEYS) n'est volontairement pas touché.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const registrySrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospitals_registry.js'), 'utf8');
const cleanupSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/affiliation-cleanup.js'), 'utf8');

test("hospitals_registry.js saveAffiliations() n'écrit plus vers mc_affiliations (collection Firestore morte)", () => {
  const start = registrySrc.indexOf('function saveAffiliations(');
  assert.ok(start !== -1);
  const end = registrySrc.indexOf('\n  function professionalNumberFor', start);
  const body = registrySrc.slice(start, end);
  assert.doesNotMatch(body, /pushCloud\('mc_affiliations'/, 'ne doit plus pousser vers mc_affiliations');
  assert.match(body, /pushCloud\('affiliation_requests'/, 'doit continuer à pousser vers la vraie collection lue par l\'app');
  assert.match(body, /store\(LEGACY_REQ_KEY, normalized\)/, 'le cache local legacy reste inchangé (pas de régression du stockage local)');
});

test("affiliation-cleanup.js markCloudRemoved() n'écrit plus vers mc_affiliations", () => {
  const start = cleanupSrc.indexOf('function markCloudRemoved(');
  assert.ok(start !== -1);
  const end = cleanupSrc.indexOf('\n  function cleanOrphanRequests', start);
  const body = cleanupSrc.slice(start, end);
  assert.doesNotMatch(body, /pushCloud\('mc_affiliations'/, 'ne doit plus pousser vers mc_affiliations');
  assert.match(body, /pushCloud\('affiliation_requests'/, 'doit continuer à pousser vers la vraie collection lue par l\'app');
});
