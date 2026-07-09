/* =====================================================
   Tests — VersionManager (versions, mises à jour, maintenance)

   Trois familles :
   1. compareVersions() — comparaison semver simplifiée, pure.
   2. Mode maintenance / version minimale obligatoire — SEUL
      mécanisme qui doit bloquer l'accès, et seulement si activé
      côté Firestore par un administrateur ; l'administrateur
      garde toujours l'accès.
   3. Gardes structurelles (lecture de source) sur sw.js : la mise
      à jour du Service Worker ne doit JAMAIS s'appliquer toute
      seule (pas de skipWaiting() automatique à l'install), pour
      que VersionManager puisse toujours demander confirmation.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadVersionManager({ firebaseDoc = null, adminRole = null } = {}) {
  const blockScreens = {}; // id -> fake element
  const modals = [];       // { title, html } capturés
  const fakeDoc = {
    getElementById: (id) => {
      if (!blockScreens[id]) {
        blockScreens[id] = { style: {}, innerHTML: '' };
      }
      return blockScreens[id];
    },
    createElement: () => ({ style: {}, innerHTML: '' }),
    body: { appendChild: () => {} },
    readyState: 'complete',
    addEventListener: () => {},
  };

  const sandbox = {
    console,
    document: fakeDoc,
    window: {
      Auth: adminRole ? { getUser: () => ({ role: adminRole }) } : undefined,
      App: {
        openModal: (title, html) => modals.push({ title, html }),
        closeModal: () => {},
      },
    },
    navigator: {}, // volontairement sans 'serviceWorker' : la garde `'serviceWorker' in navigator` doit rester fausse (le SW est testé via lecture de source, plus bas)
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
      };
    })(),
    firebaseReady: !!firebaseDoc,
    firebaseDB: firebaseDoc ? {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: !!firebaseDoc, data: () => firebaseDoc }),
        }),
      }),
    } : null,
    fetch: async () => ({ ok: true, json: async () => ({ version: '2.4.0', build: '2026.07.09.01', buildDate: '2026-07-09', changelog: [] }) }),
    // N'auto-déclenche PAS init() : chaque test l'appelle explicitement
    // et l'attend, pour éviter une course avec les promesses internes
    // (fetch, firebaseDB.get) non attendues par init() lui-même.
    setTimeout: () => 0,
    Date, JSON,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/version-manager.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/version-manager.js' });
  return { VM: sandbox.window.VersionManager, blockScreens, modals };
}

test('compareVersions() : comparaison semver simplifiée correcte', () => {
  const { VM } = loadVersionManager();
  assert.strictEqual(VM.compareVersions('2.4.0', '2.4.1'), -1);
  assert.strictEqual(VM.compareVersions('2.4.1', '2.4.0'), 1);
  assert.strictEqual(VM.compareVersions('2.4.0', '2.4.0'), 0);
  assert.strictEqual(VM.compareVersions('2.10.0', '2.9.9'), 1, 'comparaison numérique par segment, pas lexicographique');
  assert.strictEqual(VM.compareVersions('2.4', '2.4.0'), 0, 'segments manquants traités comme 0');
});

test('sans maintenance activée et sans version minimale, aucun écran de blocage ne s\'affiche', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: false } });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen']?.style.display, 'none');
});

test('maintenance activée : un utilisateur normal est bloqué avec le message personnalisé', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: true, message: 'Maintenance planifiée jusqu\'à 22h.' } });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen'].style.display, 'flex');
  assert.match(blockScreens['mc-block-screen'].innerHTML, /Maintenance en cours/);
  assert.match(blockScreens['mc-block-screen'].innerHTML, /Maintenance planifiée jusqu'à 22h/);
});

test('maintenance activée : un administrateur garde toujours accès (pas d\'écran de blocage)', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: true, message: 'Maintenance' }, adminRole: 'admin' });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen'].style.display, 'none');
});

test('version installée trop ancienne (minimumVersion) : accès bloqué pour un utilisateur normal', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: false, minimumVersion: '9.9.9' } });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen'].style.display, 'flex');
  assert.match(blockScreens['mc-block-screen'].innerHTML, /trop ancienne/);
});

test('version installée trop ancienne (minimumVersion) : un administrateur garde toujours accès', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: false, minimumVersion: '9.9.9' }, adminRole: 'admin' });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen'].style.display, 'none');
});

test('version installée à jour (>= minimumVersion) : pas de blocage', async () => {
  const { VM, blockScreens } = loadVersionManager({ firebaseDoc: { enabled: false, minimumVersion: '2.0.0' } });
  await VM.init(); // charge _current (version installée) avant de comparer
  await VM.checkMaintenanceAndMinimumVersion();
  assert.strictEqual(blockScreens['mc-block-screen'].style.display, 'none');
});

/* ── Garde structurelle : le Service Worker ne doit jamais
   s'auto-appliquer sans confirmation (mise à jour non obligatoire
   par défaut — seul le mode maintenance/version minimale peut
   bloquer, et seulement si activé explicitement par un admin). ── */
test('sw.js : skipWaiting() n\'est plus appelé automatiquement à l\'install (attend confirmation utilisateur)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  const installBlock = src.slice(src.indexOf("addEventListener('install'"), src.indexOf("addEventListener('activate'"));
  // Recherche un appel réel (";" après les parenthèses), pas la mention
  // en commentaire qui explique justement pourquoi il a été retiré.
  assert.doesNotMatch(installBlock, /self\.skipWaiting\(\);/, 'install ne doit plus forcer skipWaiting()');
});

test('sw.js : un listener "message" permet de déclencher skipWaiting() sur demande (VersionManager)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(src, /addEventListener\('message'/);
  assert.match(src, /SKIP_WAITING/);
  assert.match(src, /self\.skipWaiting\(\)/, 'skipWaiting doit rester disponible, déclenché par le message');
});

test('sw.js : clients.claim() reste actif à l\'activation (nécessaire pour le reload après confirmation)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(src, /self\.clients\.claim\(\)/);
});

test('sw.js : config/app-version.json est bien servi en priorité réseau (jamais une copie périmée)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(src, /isFreshAppShellRequest[\s\S]*?\/config\//);
});

test('config/app-version.json est un JSON valide avec les champs attendus', () => {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'config/app-version.json'), 'utf8');
  const data = JSON.parse(raw);
  assert.ok(data.version, 'version requise');
  assert.ok(data.build, 'build requis');
  assert.ok(data.buildDate, 'buildDate requis');
  assert.ok(Array.isArray(data.changelog), 'changelog doit être un tableau');
});

test('package.json et config/app-version.json partagent la même version (source unique)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config/app-version.json'), 'utf8'));
  assert.strictEqual(pkg.version, appVersion.version);
});

test('firestore.rules : system/maintenance lisible publiquement, écriture réservée admin', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
  const block = src.slice(src.indexOf('match /system/{docId}'), src.indexOf('match /system/{docId}') + 300);
  assert.match(block, /allow read: if true/);
  assert.match(block, /allow write: if isAdmin\(\)/);
});
