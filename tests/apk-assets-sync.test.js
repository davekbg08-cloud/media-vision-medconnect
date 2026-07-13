/* =====================================================
   Tests — Synchronisation des assets web dans l'APK Android

   Bug corrigé : android/app/src/main/assets/ était une copie figée,
   maintenue à la main via sync-assets.ps1 (script Windows jamais lancé
   en CI). Constaté en audit : tout le module desktop hôpital
   (hospital-desktop-ui.js, medical-record-desktop.js, cloud-db.js,
   exchange-bridge.js, version-manager.js...) et config/app-version.json
   manquaient de l'APK réellement construit et signé par la CI.

   Le workflow build-medconnect-apk.yml resynchronise maintenant les
   assets depuis la racine à chaque build, avant la compilation
   Gradle. Ces tests verrouillent structurellement ce correctif.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const workflowPath = path.resolve(__dirname, '..', '.github/workflows/build-medconnect-apk.yml');
const workflowSrc = fs.readFileSync(workflowPath, 'utf8');

test('le workflow APK contient une étape de synchronisation des assets avant le build Gradle', () => {
  const syncIdx = workflowSrc.indexOf('Sync web assets into Android app');
  const buildIdx = workflowSrc.indexOf('Build release APK');
  assert.ok(syncIdx !== -1, 'étape de synchronisation manquante');
  assert.ok(buildIdx !== -1, 'étape de build manquante');
  assert.ok(syncIdx < buildIdx, 'la synchronisation doit se faire AVANT la compilation Gradle');
});

test('la synchronisation copie bien css, js, assets (icônes) et config (version) — pas seulement index.html', () => {
  const syncIdx = workflowSrc.indexOf('Sync web assets into Android app');
  const validateIdx = workflowSrc.indexOf('Validate signing secrets');
  const syncBlock = workflowSrc.slice(syncIdx, validateIdx);
  for (const dir of ['css', 'js', 'assets', 'config']) {
    assert.match(syncBlock, new RegExp(`\\b${dir}\\b`), `le dossier ${dir} doit être synchronisé`);
  }
  assert.match(syncBlock, /index\.html/);
  assert.match(syncBlock, /manifest\.json/);
  assert.match(syncBlock, /sw\.js/);
});

test('android/app/src/main/assets/ contient bien les fichiers critiques du desktop hôpital et du versioning (état du dépôt, hors CI)', () => {
  // Ce test documente l'état du dépôt au moment du commit : si quelqu'un
  // modifie encore sync-assets.ps1 ou l'app Android sans relancer la
  // synchro, ce test échouera et rappellera que le build CI est la
  // source de vérité (voir étape "Sync web assets into Android app").
  const assetsDir = path.resolve(__dirname, '..', 'android/app/src/main/assets');
  const criticalFiles = [
    'js/hospital-desktop-ui.js',
    'js/medical-record-desktop.js',
    'js/cloud-db.js',
    'js/exchange-bridge.js',
    'js/version-manager.js',
    'config/app-version.json',
  ];
  for (const f of criticalFiles) {
    assert.ok(fs.existsSync(path.join(assetsDir, f)), `${f} devrait être présent dans les assets Android (committé ou resynchronisé)`);
  }
});

// Correctif (audit) : le test ci-dessus ne vérifie que la PRÉSENCE des
// fichiers, jamais leur CONTENU — la copie Android committée avait pu
// dériver silencieusement du code source (version pré-durcissement :
// PIN patient en clair, pas de code d'accès, pas de Firebase Auth
// patient) sans qu'aucun test ne le détecte, puisque le build CI
// écrase cette copie avant chaque APK (donc pas d'impact en
// production) — mais un dev qui build en local sans relancer la
// synchro, ou qui lit cette copie par erreur, tombe sur du code
// périmé. Comparaison octet pour octet, même liste de dossiers/
// fichiers que l'étape "Sync web assets into Android app" du workflow.
function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

test("la copie Android (android/app/src/main/assets) est identique octet pour octet à la racine (js/, css/, config/app-version.json, index.html, sw.js)", () => {
  const root = path.resolve(__dirname, '..');
  const assetsDir = path.join(root, 'android/app/src/main/assets');
  const mismatches = [];

  for (const dir of ['js', 'css']) {
    const rootDir = path.join(root, dir);
    for (const rootFile of listFilesRecursive(rootDir)) {
      const rel = path.join(dir, path.relative(rootDir, rootFile));
      const mirrorFile = path.join(assetsDir, rel);
      if (!fs.existsSync(mirrorFile)) { mismatches.push(`${rel} (absent côté Android)`); continue; }
      if (fs.readFileSync(rootFile, 'utf8') !== fs.readFileSync(mirrorFile, 'utf8')) mismatches.push(rel);
    }
  }
  for (const rel of ['config/app-version.json', 'index.html', 'sw.js']) {
    const rootFile = path.join(root, rel);
    const mirrorFile = path.join(assetsDir, rel);
    if (!fs.existsSync(mirrorFile)) { mismatches.push(`${rel} (absent côté Android)`); continue; }
    if (fs.readFileSync(rootFile, 'utf8') !== fs.readFileSync(mirrorFile, 'utf8')) mismatches.push(rel);
  }

  assert.deepStrictEqual(mismatches, [], `Fichiers désynchronisés (relancer la sync avant de committer) : ${mismatches.join(', ')}`);
});
