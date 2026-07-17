/* =====================================================
   Tests — Application de bureau Electron (Windows + Linux)

   Verrous structurels : main.js doit charger une URL https:// distante
   (jamais file://, qui forcerait currentSourceDevice() en mode 'mobile',
   voir js/exchange-bridge.js), les webPreferences doivent être
   sécurisées (nodeIntegration:false, contextIsolation:true), et le
   workflow CI doit couvrir Windows + Linux sans macOS.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainPath = path.resolve(__dirname, '..', 'electron/main.js');
const mainSrc = fs.readFileSync(mainPath, 'utf8');

const workflowPath = path.resolve(__dirname, '..', '.github/workflows/build-desktop-app.yml');
const workflowSrc = fs.readFileSync(workflowPath, 'utf8');

test('main.js charge une URL https:// distante, jamais file://', () => {
  assert.match(mainSrc, /loadURL\(\s*APP_URL\s*\)/);
  const urlMatch = mainSrc.match(/APP_URL\s*=\s*'([^']+)'/);
  assert.ok(urlMatch, 'APP_URL doit être défini');
  assert.match(urlMatch[1], /^https:\/\//, 'APP_URL doit être en https:// (jamais file://)');
  assert.doesNotMatch(mainSrc, /loadFile\s*\(/, 'ne doit jamais utiliser loadFile (chargement local)');
});

test('main.js ne doit jamais dépendre de @capacitor-community/electron (forcerait la détection mobile)', () => {
  assert.doesNotMatch(mainSrc, /require\(['"].*capacitor.*['"]\)/i);
});

test('webPreferences désactivent nodeIntegration et activent contextIsolation + sandbox', () => {
  assert.match(mainSrc, /nodeIntegration:\s*false/);
  assert.match(mainSrc, /contextIsolation:\s*true/);
  assert.match(mainSrc, /sandbox:\s*true/);
});

test('la navigation externe est restreinte (will-navigate / setWindowOpenHandler)', () => {
  assert.match(mainSrc, /will-navigate/);
  assert.match(mainSrc, /setWindowOpenHandler/);
});

test('le workflow desktop couvre Windows + Linux, sans macOS', () => {
  assert.match(workflowSrc, /windows-latest/);
  assert.match(workflowSrc, /ubuntu-latest/);
  assert.doesNotMatch(workflowSrc, /macos-/);
});

test('le workflow desktop est séparé du pipeline Android (aucune modification du job APK)', () => {
  const apkWorkflowPath = path.resolve(__dirname, '..', '.github/workflows/build-medconnect-apk.yml');
  const apkWorkflowSrc = fs.readFileSync(apkWorkflowPath, 'utf8');
  assert.doesNotMatch(apkWorkflowSrc, /electron/i, 'le workflow APK ne doit rien connaître d\'Electron');
});

test('electron/package.json contient homepage + author.email (requis par electron-builder pour le paquet .deb)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'electron/package.json'), 'utf8'));
  assert.ok(pkg.homepage, 'homepage manquant : le build .deb échoue sans ça');
  assert.ok(pkg.author && pkg.author.email, 'author.email manquant : le build .deb échoue sans ça (maintainer requis)');
});

test('le workflow desktop utilise fail-fast:false (un échec Linux ne doit pas annuler le job Windows en cours, et inversement)', () => {
  assert.match(workflowSrc, /fail-fast:\s*false/);
});

/* =====================================================
   Chantier fix/desktop-session-routing-packaging — durcissement
   Electron, packaging et workflow (points ELECTRON 20-28 de l'audit).
   ===================================================== */

test('main.js : origine dédiée MedConnect (Firebase Hosting), jamais l\'ancienne origine GitHub Pages partagée dans le CODE actif', () => {
  assert.match(mainSrc, /medconnect-e81ba\.web\.app/);
  // Les commentaires expliquant la correction peuvent légitimement citer
  // l'ancienne origine (contexte de l'audit) — seul le CODE actif compte.
  const codeOnly = mainSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codeOnly, /davekbg08-cloud\.github\.io/, 'aucune référence à l\'origine GitHub Pages partagée ne doit subsister dans le code actif de main.js');
});

test('main.js : MEDCONNECT_APP_URL est configurable par variable d\'environnement (pas de repli silencieux vers une autre origine)', () => {
  assert.match(mainSrc, /process\.env\.MEDCONNECT_APP_URL/);
});

test('main.js : ALLOWED_ORIGIN est dérivé de APP_URL (jamais une constante indépendante qui pourrait diverger)', () => {
  assert.match(mainSrc, /ALLOWED_ORIGIN\s*=\s*new URL\(APP_URL\)\.origin/);
});

test('main.js : verrou d\'instance unique (poste hospitalier partagé)', () => {
  assert.match(mainSrc, /requestSingleInstanceLock/);
  assert.match(mainSrc, /second-instance/);
});

test('main.js : permissionRequestHandler n\'autorise que la géolocalisation, jamais caméra/microphone/notifications', () => {
  assert.match(mainSrc, /setPermissionRequestHandler/);
  assert.match(mainSrc, /ALLOWED_PERMISSIONS\s*=\s*new Set\(\['geolocation'\]\)/);
  assert.doesNotMatch(mainSrc, /ALLOWED_PERMISSIONS.*(camera|microphone|notifications|media)/i);
});

test('main.js : permissionRequestHandler vérifie l\'origine de la requête (pas seulement le nom de la permission)', () => {
  const idx = mainSrc.indexOf('setPermissionRequestHandler');
  const block = mainSrc.slice(idx, idx + 400);
  assert.match(block, /origin\s*===\s*ALLOWED_ORIGIN/);
});

test('main.js : did-fail-load affiche une page locale claire au lieu d\'une fenêtre blanche', () => {
  assert.match(mainSrc, /did-fail-load/);
  assert.match(mainSrc, /offline\.html/);
  assert.doesNotMatch(mainSrc, /did-fail-load[\s\S]{0,10}\n\s*\}\)/, 'le handler did-fail-load ne doit pas être un no-op vide');
});

test('main.js : gère will-download (aucun téléchargement silencieux dans la fenêtre)', () => {
  assert.match(mainSrc, /will-download/);
});

test('electron/offline.html existe, propose de réessayer, et cible l\'URL réelle (pas un simple reload de lui-même)', () => {
  const offlinePath = path.resolve(__dirname, '..', 'electron/offline.html');
  assert.ok(fs.existsSync(offlinePath), 'electron/offline.html doit exister');
  const src = fs.readFileSync(offlinePath, 'utf8');
  assert.match(src, /Réessayer/);
  assert.match(src, /target/, 'doit relire un paramètre "target" pour recharger la vraie URL MedConnect, pas se recharger lui-même');
});

test('electron/package.json : "files" inclut offline.html et resources/**/* (le BrowserWindow ne doit jamais référencer une ressource absente du package)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'electron/package.json'), 'utf8'));
  const files = pkg.build?.files || [];
  assert.ok(files.includes('main.js'));
  assert.ok(files.includes('offline.html'), '"offline.html" absent de build.files — did-fail-load chargerait un fichier absent du paquet');
  assert.ok(files.some(f => f.startsWith('resources')), '"resources/**/*" absent de build.files — l\'icône ne serait pas incluse dans le paquet');
});

test('electron/package.json : version synchronisée avec package.json racine', () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const electronPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'electron/package.json'), 'utf8'));
  assert.strictEqual(electronPkg.version, rootPkg.version, 'electron/package.json doit rester synchronisé avec la version racine (scripts/sync-desktop-version.mjs)');
});

test('electron/package.json : predist:win/predist:linux appellent le script de synchronisation de version', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'electron/package.json'), 'utf8'));
  assert.match(pkg.scripts?.['predist:win'] || '', /sync-desktop-version/);
  assert.match(pkg.scripts?.['predist:linux'] || '', /sync-desktop-version/);
});

test('main.js : utilise app.getVersion() pour le paramètre desktop de l\'URL — jamais de version codée en dur', () => {
  assert.match(mainSrc, /app\.getVersion\(\)/);
  assert.doesNotMatch(mainSrc, /desktop=v1\.0\.0/);
  assert.doesNotMatch(mainSrc, /desktop=v2\.9\.25['"`]/, 'la version ne doit jamais être codée en dur dans le template littéral');
});

test('scripts/sync-desktop-version.mjs existe et synchronise electron/package.json sur la version racine', () => {
  const scriptPath = path.resolve(__dirname, '..', 'scripts/sync-desktop-version.mjs');
  assert.ok(fs.existsSync(scriptPath));
  const src = fs.readFileSync(scriptPath, 'utf8');
  assert.match(src, /electron.*package\.json/);
  assert.match(src, /rootPkg\.version/);
});

test('le workflow desktop génère SHA256SUMS.txt pour Windows et pour Linux', () => {
  const matches = workflowSrc.match(/sha256sum \* > SHA256SUMS\.txt/g) || [];
  assert.ok(matches.length >= 2, 'SHA256SUMS.txt doit être généré pour les deux plateformes');
});

test('le workflow desktop nomme l\'installateur Windows non signé avec le suffixe "-unsigned-beta"', () => {
  assert.match(workflowSrc, /unsigned-beta/);
  assert.match(workflowSrc, /steps\.sign\.outputs\.signed/, 'le nom doit dépendre de la détection réelle de signature (CSC_LINK/CSC_KEY_PASSWORD)');
});

test('le workflow desktop vérifie le miroir Firebase Hosting AVANT le build (échec clair si indisponible)', () => {
  const idx = workflowSrc.indexOf('verify-hosting:');
  assert.ok(idx !== -1, 'job verify-hosting manquant');
  const block = workflowSrc.slice(idx, idx + 800);
  assert.match(block, /curl/);
  assert.match(block, /exit 1/);
  assert.match(workflowSrc, /needs:\s*\[test, verify-hosting\]/, 'le job build doit dépendre de verify-hosting');
});

test('le workflow desktop vérifie le fichier produit (taille minimale, extension, en-tête)', () => {
  assert.match(workflowSrc, /MIN=\$\(\(20\*1024\*1024\)\)/);
  assert.match(workflowSrc, /MZ/, 'vérification de l\'en-tête PE (exécutable Windows valide)');
});

test('le workflow desktop expose des inputs workflow_dispatch : version, publish_release, release_tag', () => {
  const idx = workflowSrc.indexOf('workflow_dispatch:');
  const block = workflowSrc.slice(idx, idx + 600);
  assert.match(block, /version:/);
  assert.match(block, /publish_release:/);
  assert.match(block, /release_tag:/);
});

test('le workflow desktop ne publie une GitHub Release que si publish_release=true', () => {
  const idx = workflowSrc.indexOf('\n  release:\n');
  assert.ok(idx !== -1, 'job "release" introuvable (recherche du job top-level, pas de "publish_release")');
  const block = workflowSrc.slice(idx, idx + 300);
  assert.match(block, /if:\s*github\.event\.inputs\.publish_release\s*==\s*'true'/);
});

/* ── Comportement réel de main.js (pas seulement du texte) ──────────
   require() est shimmé pour injecter un faux module 'electron' —
   permet d'exécuter réellement isAllowedNavigation, le gate de
   permissions, et le verrou d'instance unique dans un vm sandbox,
   sans dépendre du binaire Electron (non téléchargeable dans cet
   environnement de test). */
function loadElectronMain({ existingInstanceLock = true } = {}) {
  const realRequire = require;
  const handlers = {};
  const permHandlers = {};
  let quitCalled = false;
  let loadedUrl = null;
  let secondInstanceCb = null;

  const fakeWebContents = {
    session: {
      setPermissionRequestHandler: (fn) => { permHandlers.request = fn; },
      setPermissionCheckHandler: (fn) => { permHandlers.check = fn; },
      on: (evt, fn) => { handlers[`session:${evt}`] = fn; },
    },
    on: (evt, fn) => { handlers[evt] = fn; },
    setWindowOpenHandler: (fn) => { handlers.windowOpenHandler = fn; },
    getURL: () => loadedUrl || '',
  };

  class FakeBrowserWindow {
    constructor() {
      this.webContents = fakeWebContents;
      this._minimized = false;
    }
    loadURL(u) { loadedUrl = u; }
    isMinimized() { return this._minimized; }
    restore() {}
    focus() {}
    static getAllWindows() { return [new FakeBrowserWindow()]; }
  }

  const fakeApp = {
    getVersion: () => '9.9.9-test',
    requestSingleInstanceLock: () => existingInstanceLock,
    quit: () => { quitCalled = true; },
    whenReady: () => Promise.resolve(),
    on: (evt, fn) => { if (evt === 'second-instance') secondInstanceCb = fn; },
  };

  const fakeShell = { openExternal: () => {} };
  const fakeElectron = { app: fakeApp, BrowserWindow: FakeBrowserWindow, shell: fakeShell };

  const sandbox = {
    require: (name) => (name === 'electron' ? fakeElectron : realRequire(name)),
    process: { env: {}, platform: 'linux' },
    console,
    URL,
    module: { exports: {} },
    __dirname: path.resolve(__dirname, '..', 'electron'),
  };
  vm.createContext(sandbox);
  vm.runInContext(mainSrc, sandbox, { filename: 'electron/main.js' });

  return { sandbox, fakeApp, handlers, permHandlers, get loadedUrl() { return loadedUrl; }, get quitCalled() { return quitCalled; }, secondInstanceCb, FakeBrowserWindow };
}

test('main.js (exécution réelle) : isAllowedNavigation autorise l\'origine MedConnect, refuse toute autre origine', () => {
  const { sandbox } = loadElectronMain();
  const isAllowed = vm.runInContext('isAllowedNavigation', sandbox);
  assert.strictEqual(isAllowed('https://medconnect-e81ba.web.app/'), true);
  assert.strictEqual(isAllowed('https://davekbg08-cloud.github.io/media-vision-medconnect/'), false);
  assert.strictEqual(isAllowed('https://evil.example.com/'), false);
});

test('main.js (exécution réelle) : le verrou d\'instance unique appelle app.quit() si une instance existe déjà', () => {
  const { quitCalled } = loadElectronMain({ existingInstanceLock: false });
  assert.strictEqual(quitCalled, true);
});

test('main.js (exécution réelle) : le verrou d\'instance unique ne quitte PAS quand aucune instance n\'existe déjà', () => {
  const { quitCalled } = loadElectronMain({ existingInstanceLock: true });
  assert.strictEqual(quitCalled, false);
});
