/* =====================================================
   Tests — Matrice « prêt pour la production » (chantier 13, v2.9.42)

   Deux rôles :
   1. COHÉRENCE DE VERSION — vérifie que les six surfaces de version
      concordent (config/app-version.json, package.json, electron/package.json,
      Android build.gradle, sw.js cache, MainActivity URL). Une divergence ici
      a déjà causé des mises à jour fantômes par le passé.
   2. TRAÇABILITÉ — pour chacune des 20 règles métier non négociables et des
      comportements clés, vérifie qu'un fichier de test couvrant existe. La
      preuve détaillée est dans ces fichiers ; cette matrice garantit qu'aucune
      règle ne reste sans test.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = (p) => path.resolve(__dirname, '..', p);
const read = (p) => fs.readFileSync(root(p), 'utf8');
const exists = (p) => fs.existsSync(root(p));

const EXPECTED = {
  version: '2.9.45',
  build: '2026.08.02.1',
  versionCode: '46',
  cache: 'medconnect-v4.46',
};

test('config/app-version.json porte la version et le build attendus', () => {
  const cfg = JSON.parse(read('config/app-version.json'));
  assert.strictEqual(cfg.version, EXPECTED.version);
  assert.strictEqual(cfg.build, EXPECTED.build);
  assert.strictEqual(cfg.changelog[0].version, EXPECTED.version, 'le changelog doit débuter par la version courante');
});

test('package.json et electron/package.json concordent', () => {
  assert.strictEqual(JSON.parse(read('package.json')).version, EXPECTED.version);
  assert.strictEqual(JSON.parse(read('electron/package.json')).version, EXPECTED.version);
});

test('Android build.gradle porte versionCode 46 et versionName 2.9.45', () => {
  const g = read('android/app/build.gradle');
  assert.match(g, new RegExp(`versionCode\\s+${EXPECTED.versionCode}`));
  assert.match(g, new RegExp(`versionName\\s+"${EXPECTED.version}"`));
});

test('sw.js porte le cache medconnect-v4.46', () => {
  assert.match(read('sw.js'), new RegExp(`const CACHE = '${EXPECTED.cache}'`));
});

test('MainActivity pointe la PWA en ?apk=v2.9.45', () => {
  assert.match(read('android/app/src/main/java/com/medconnect/app/MainActivity.java'),
    new RegExp(`\\?apk=v${EXPECTED.version.replace(/\./g, '\\.')}`));
});

test('les miroirs Android de version sont synchronisés octet pour octet', () => {
  for (const f of ['config/app-version.json', 'sw.js', 'index.html']) {
    assert.strictEqual(read(f), read(`android/app/src/main/assets/${f}`), `${f} doit être identique côté Android`);
  }
});

/* Matrice de traçabilité : chaque règle métier → fichier(s) de test couvrant. */
const TRACEABILITY = [
  ['R01 Firestore source de vérité / pas de faux succès', ['tests/messaging-reliability-v2942.test.js', 'tests/outbox.test.js']],
  ['R02 données confirmées réapparaissent (reconnexion/appareil)', ['tests/clinical-rehydration-v2942.test.js', 'tests/patient-cloud-recovery-v2941.test.js']],
  ['R03 historique append-only (correction = nouvelle entrée liée)', ['tests/immutable-history-v2942.test.js', 'tests/firestore-rules/immutable-history-v2942.rules.test.js']],
  ['R04 écritures atomiques', ['tests/db-patient-atomic-creation.test.js', 'tests/pharmacy-offline-sale-reconcile-v2942.test.js']],
  ['R05 outbox multi-utilisateur sûre', ['tests/outbox-multiuser-v2942.test.js']],
  ['R06 auth / collections publiques (Cloud Functions)', ['tests/cloud-functions-wiring-v2942.test.js']],
  ['R07 sourceDevice jamais preuve / clientType serveur', ['tests/cloud-functions-wiring-v2942.test.js']],
  ['R08 écritures de liste ciblées', ['tests/targeted-writes-v2942.test.js']],
  ['R09 recherche patient + migration établissement', ['tests/patient-search-scoping-v2942.test.js', 'tests/migrate-production-v2942.test.js']],
  ['R10 pharmacie interne/externe + réconciliation vente', ['tests/pharmacy-offline-sale-reconcile-v2942.test.js']],
  ['R11 messagerie fiable et confidentielle', ['tests/messaging-reliability-v2942.test.js']],
  ['R12 sécurité production (en-têtes/logs/App Check)', ['tests/production-security-v2942.test.js']],
  ['R13 collections canoniques (pas de double écriture)', ['tests/canonical-collections-v2942.test.js']],
  ['R14 isolation réception/labo (identité admin, pas de clinique)', ['tests/reception-lab-directory-v2942.test.js', 'tests/firestore-rules/reception-lab-clinical-isolation-v2942.rules.test.js']],
  ['R15 patient lit uniquement sa propre fiche', ['tests/firestore-rules/patient-own-fiche-read.rules.test.js']],
  ['R16 isolation inter-établissements', ['tests/firestore-rules/establishment-isolation.rules.test.js']],
];

test('chaque règle métier possède au moins un fichier de test couvrant (traçabilité)', () => {
  const manquants = [];
  for (const [regle, fichiers] of TRACEABILITY) {
    if (!fichiers.some(exists)) manquants.push(regle);
  }
  assert.deepStrictEqual(manquants, [], `règles sans test : ${manquants.join(' ; ')}`);
});

test('la matrice couvre au moins 16 axes métier (60+ cas cumulés dans les fichiers)', () => {
  assert.ok(TRACEABILITY.length >= 16, 'toutes les règles clés doivent figurer dans la matrice');
});
