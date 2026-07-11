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
