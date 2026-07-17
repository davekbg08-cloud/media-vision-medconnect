#!/usr/bin/env node
/* =====================================================
   Synchronisation de version — MedConnect Desktop (Electron)

   Source unique de version : package.json (racine). Ce script applique
   cette version à electron/package.json AVANT chaque build Electron —
   corrige la dérive constatée à l'audit (version racine 2.9.25,
   version Electron restée figée à 1.0.0). electron/main.js lit ensuite
   cette version via app.getVersion() pour le paramètre ?desktop=v...
   de l'URL chargée : plus aucune version codée en dur.

   Zéro dépendance npm, reproductible (même résultat en local et en CI).
   ===================================================== */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const rootPkgPath = path.join(REPO_ROOT, 'package.json');
const electronPkgPath = path.join(REPO_ROOT, 'electron', 'package.json');

const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'));
const electronPkg = JSON.parse(readFileSync(electronPkgPath, 'utf8'));

if (!rootPkg.version) {
  console.error('❌ package.json racine sans champ "version" — impossible de synchroniser.');
  process.exit(1);
}

if (electronPkg.version === rootPkg.version) {
  console.log(`✅ electron/package.json déjà synchronisé (${rootPkg.version}).`);
} else {
  electronPkg.version = rootPkg.version;
  writeFileSync(electronPkgPath, JSON.stringify(electronPkg, null, 2) + '\n');
  console.log(`✅ electron/package.json synchronisé : version → ${rootPkg.version}`);
}
