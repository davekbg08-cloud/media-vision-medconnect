/* =====================================================
   Tests — IA médicale RÉELLE (js/medical-ai.js)

   Demande client : la version simulée (mockSafeResponse) doit être
   remplacée par une vraie IA de recherche médicale. Architecture
   (app sans backend — aucun secret ne peut vivre dans le code) :
   1. Recherche documentaire Europe PMC (publique, gratuite, sans clé,
      CORS) — articles sourcés affichés dans tous les cas.
   2. Synthèse Claude OPTIONNELLE : uniquement si l'établissement a
      configuré SA PROPRE clé API, stockée en localStorage sur SON
      appareil — jamais dans le code, jamais dans Firestore.
   Invariants : gating abonnement, journal aiQueries, échappement,
   anti double-appui, échec de synthèse n'empêche pas les articles.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/medical-ai.js'), 'utf8');
const sw = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

test('la réponse simulée (mock) a disparu', () => {
  assert.ok(!src.includes('mockSafeResponse'), 'mockSafeResponse doit être supprimée');
  assert.ok(!src.includes('en attente de configuration API'), 'le texte de réponse simulée doit être supprimé');
});

test('la recherche documentaire interroge Europe PMC (API publique, sans clé)', () => {
  assert.match(src, /ebi\.ac\.uk\/europepmc\/webservices\/rest\/search/, 'endpoint Europe PMC requis');
  assert.match(src, /encodeURIComponent\(query\)/, 'la requête doit être encodée');
  assert.match(src, /abstractText/, 'les résumés doivent être extraits');
});

test('la synthèse Claude est OPTIONNELLE et conditionnée à une clé configurée localement', () => {
  assert.match(src, /if \(!apiKey \|\| !articles\.length\) return null;/,
    'sans clé (ou sans article), aucune synthèse — et aucun appel API');
  assert.match(src, /if \(getApiKey\(\) && articles\.length\)/,
    "le site d'appel doit vérifier la présence de la clé");
  assert.match(src, /localStorage\.(getItem|setItem)\(AI_KEY_STORAGE/,
    'la clé vit en localStorage (appareil local uniquement)');
});

test("l'appel Claude utilise le bon modèle et l'en-tête navigateur dédié", () => {
  assert.match(src, /'anthropic-dangerous-direct-browser-access': 'true'/,
    "l'en-tête d'accès direct navigateur est requis pour un appel CORS");
  assert.match(src, /model: 'claude-opus-4-8'/, 'modèle Claude attendu');
  assert.match(src, /'anthropic-version': '2023-06-01'/, 'version API requise');
});

test('aucun secret dans le code, et la clé ne part jamais dans Firestore', () => {
  assert.ok(!/sk-ant/.test(src), 'aucune clé API ne doit apparaître dans le source');
  // La clé n'apparaît dans aucun payload createDoc (seul l'audit aiQueries est écrit).
  const auditIdx = src.indexOf("createDoc('aiQueries'");
  assert.ok(auditIdx !== -1, 'le journal aiQueries doit être conservé');
  const auditBlock = src.slice(auditIdx, src.indexOf('});', auditIdx));
  assert.ok(!auditBlock.includes('apiKey') && !auditBlock.includes('AI_KEY_STORAGE'),
    'la clé ne doit jamais être journalisée');
});

test('gating abonnement conservé + anti double-appui + articles affichés même si la synthèse échoue', () => {
  assert.match(src, /requireWritableSubscription\('use_medical_ai'\)/, 'gating abonnement conservé');
  assert.match(src, /subscriptionAllowsWrite\('use_medical_ai'\)/, 'gating affichage conservé');
  assert.match(src, /let _asking = false;/, 'verrou de réentrance requis');
  assert.match(src, /finally \{/, 'verrou libéré dans finally');
  assert.match(src, /catch \(err\) \{ synthesisError = err\.message;/,
    "un échec de synthèse est capté sans faire échouer l'affichage des articles");
});

test('service worker : les API de recherche ne sont jamais mises en cache (fraîcheur + confidentialité)', () => {
  assert.match(sw, /ebi\.ac\.uk/, 'Europe PMC doit contourner le cache');
  assert.match(sw, /api\.anthropic\.com/, "l'API Claude doit contourner le cache");
});
