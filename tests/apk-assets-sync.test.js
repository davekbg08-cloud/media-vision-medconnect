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
