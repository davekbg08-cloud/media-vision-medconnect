/* =====================================================
   Tests — Mise à jour native de l'APK (pont AndroidUpdater)

   Avant : le bouton "Télécharger APK" ouvrait un simple lien dans le
   navigateur (aucun store, aucun mécanisme natif). Cette suite verrouille
   structurellement le pont natif ajouté dans MainActivity.java :
   téléchargement via DownloadManager puis ouverture directe de l'écran
   d'installation Android (FileProvider), avec la permission
   REQUEST_INSTALL_PACKAGES et un contrôle d'URL de confiance côté
   natif (l'appel vient du JS embarqué, mais on ne fait confiance qu'au
   domaine officiel de téléchargement).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const manifestPath = path.resolve(__dirname, '..', 'android/app/src/main/AndroidManifest.xml');
const manifestSrc = fs.readFileSync(manifestPath, 'utf8');

const mainActivityPath = path.resolve(__dirname, '..', 'android/app/src/main/java/com/medconnect/app/MainActivity.java');
const mainActivitySrc = fs.readFileSync(mainActivityPath, 'utf8');

test('AndroidManifest.xml : permission REQUEST_INSTALL_PACKAGES déclarée', () => {
  assert.match(manifestSrc, /<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES" \/>/);
});

test('AndroidManifest.xml : FileProvider déclaré avec l\'autorité applicationId.fileprovider et non exporté', () => {
  const providerIdx = manifestSrc.indexOf('androidx.core.content.FileProvider');
  assert.ok(providerIdx !== -1, 'provider FileProvider manquant');
  const block = manifestSrc.slice(providerIdx - 200, providerIdx + 400);
  assert.match(block, /android:authorities="\$\{applicationId\}\.fileprovider"/);
  assert.match(block, /android:exported="false"/);
  assert.match(block, /file_paths/);
});

test('res/xml/file_paths.xml existe et déclare un cache-path (fichier APK téléchargé hors stockage public)', () => {
  const filePathsPath = path.resolve(__dirname, '..', 'android/app/src/main/res/xml/file_paths.xml');
  assert.ok(fs.existsSync(filePathsPath));
  const src = fs.readFileSync(filePathsPath, 'utf8');
  assert.match(src, /<cache-path/);
});

test('MainActivity.java : le WebView expose le pont AndroidUpdater au JS embarqué', () => {
  assert.match(mainActivitySrc, /addJavascriptInterface\(new AndroidUpdateBridge\(\), "AndroidUpdater"\)/);
  assert.match(mainActivitySrc, /@JavascriptInterface[\s\S]{0,80}public void downloadAndInstall/, 'downloadAndInstall doit être annoté @JavascriptInterface (obligatoire depuis API 17)');
});

test('MainActivity.java : seule une URL du domaine officiel de téléchargement est acceptée avant de lancer un téléchargement', () => {
  assert.match(mainActivitySrc, /TRUSTED_APK_URL_PREFIX\s*=\s*"https:\/\/davekbg08-cloud\.github\.io\/media-vision-medconnect\/downloads\/"/);
  const fnIdx = mainActivitySrc.indexOf('private void startApkDownload');
  const fnBlock = mainActivitySrc.slice(fnIdx, fnIdx + 400);
  assert.match(fnBlock, /!apkUrl\.startsWith\(TRUSTED_APK_URL_PREFIX\)/, 'un pont JS compromis ne doit pas pouvoir faire télécharger une URL arbitraire');
});

test('MainActivity.java : demande l\'autorisation "sources inconnues" avant de télécharger si elle manque (Android 8+)', () => {
  assert.match(mainActivitySrc, /canRequestPackageInstalls\(\)/);
  assert.match(mainActivitySrc, /Settings\.ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
});

test('MainActivity.java : installe via un URI FileProvider (pas file://, interdit depuis Android 7)', () => {
  assert.match(mainActivitySrc, /FileProvider\.getUriForFile\(this, getPackageName\(\) \+ "\.fileprovider", apkFile\)/);
  assert.match(mainActivitySrc, /FLAG_GRANT_READ_URI_PERMISSION/);
});

test('MainActivity.java : le BroadcastReceiver de fin de téléchargement est non-exporté sur Android 13+ (API 33 exige un flag explicite)', () => {
  const fnIdx = mainActivitySrc.indexOf('private void registerDownloadReceiver');
  const fnBlock = mainActivitySrc.slice(fnIdx, fnIdx + 1200);
  assert.match(fnBlock, /Context\.RECEIVER_NOT_EXPORTED/);
});

test('MainActivity.java : libère le récepteur de téléchargement dans onDestroy (pas de fuite si l\'app ferme pendant le téléchargement)', () => {
  const idx = mainActivitySrc.indexOf('protected void onDestroy()');
  assert.ok(idx !== -1);
  const block = mainActivitySrc.slice(idx, idx + 300);
  assert.match(block, /unregisterReceiver\(updateDownloadReceiver\)/);
});

test('build.gradle et MainActivity.java partagent la même version (versionName ↔ paramètre ?apk=)', () => {
  const gradleSrc = fs.readFileSync(path.resolve(__dirname, '..', 'android/app/build.gradle'), 'utf8');
  const versionName = gradleSrc.match(/versionName\s+"([^"]+)"/)?.[1];
  const apkParam = mainActivitySrc.match(/\?apk=v([\d.]+)"/)?.[1];
  assert.ok(versionName, 'versionName introuvable dans build.gradle');
  assert.strictEqual(apkParam, versionName);
});
