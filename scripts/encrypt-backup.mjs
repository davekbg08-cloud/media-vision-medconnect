#!/usr/bin/env node
/* =====================================================
   CHIFFREMENT DE SAUVEGARDE — chantier "reception/affiliation sans
   régression", section 12/13.

   Bug confirmé (audit) : le workflow de sauvegarde Firestore
   (.github/workflows/backup-firestore.yml) publiait l'export NDJSON en
   CLAIR comme artefact GitHub Actions — des données patient/compte
   complètes restaient donc accessibles à quiconque a un accès lecture
   au dépôt (mainteneurs, collaborateurs), au-delà du strict besoin
   opérationnel. Ce script chiffre le dossier d'export produit par
   scripts/backup-firestore.mjs (tar + gzip, puis gpg symétrique
   AES256) et écrit, à côté, un manifeste PUBLIC non sensible (date,
   version applicative, nombre total de documents, empreinte SHA-256 de
   l'archive chiffrée) — jamais le contenu en clair.

   Utilise `gpg` (préinstallé sur les runners GitHub Actions
   ubuntu-latest) en mode symétrique — pas de paire de clés à gérer,
   juste une passphrase (secret FIRESTORE_BACKUP_ENCRYPTION_KEY). Aucune
   Cloud Function, aucun plan Firebase Blaze requis (même contrainte que
   backup-firestore.mjs).

   Usage :
     node scripts/encrypt-backup.mjs --in <dossier-export> --out <archive.tar.gz.gpg> [--manifest-out <manifeste.json>]
     FIRESTORE_BACKUP_ENCRYPTION_KEY doit être définie dans l'environnement.

   Procédure de restauration/déchiffrement (sans jamais publier le
   secret) — voir docs/BACKUP_RESTORE_RUNBOOK.md pour le détail complet :
     gpg --batch --yes --decrypt --passphrase "$FIRESTORE_BACKUP_ENCRYPTION_KEY" \
       --output backup-output.tar.gz backup-output.tar.gz.gpg
     tar -xzf backup-output.tar.gz -C backup-output/
     node scripts/restore-firestore.mjs --from backup-output
   ===================================================== */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const out = { in: null, out: null, manifestOut: null, version: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') out.in = argv[++i];
    if (argv[i] === '--out') out.out = argv[++i];
    if (argv[i] === '--manifest-out') out.manifestOut = argv[++i];
    if (argv[i] === '--version') out.version = argv[++i];
    if (argv[i] === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/encrypt-backup.mjs --in <dossier-export> --out <archive.tar.gz.gpg> [--manifest-out <fichier.json>] [--version <x.y.z>]

Chiffre (tar+gzip puis gpg --symmetric --cipher-algo AES256) le dossier
produit par scripts/backup-firestore.mjs, et écrit un manifeste PUBLIC
(date, version, nombre de documents, empreinte SHA-256) à côté —
jamais le contenu en clair. Nécessite la variable d'environnement
FIRESTORE_BACKUP_ENCRYPTION_KEY (passphrase).`);
}

function readTotalDocumentCount(inDir) {
  const manifestPath = path.join(inDir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return Object.values(manifest.collections || {}).reduce((sum, c) => sum + (c.count || 0), 0);
  } catch {
    return null;
  }
}

function sha256Of(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  if (!args.in) { console.error("❌ --in <dossier-export> requis."); process.exit(1); }
  if (!args.out) { console.error("❌ --out <archive.tar.gz.gpg> requis."); process.exit(1); }
  if (!existsSync(args.in) || !statSync(args.in).isDirectory()) {
    console.error(`❌ Dossier introuvable : ${args.in}`); process.exit(1);
  }
  const passphrase = process.env.FIRESTORE_BACKUP_ENCRYPTION_KEY;
  if (!passphrase) {
    console.error('❌ Secret manquant : FIRESTORE_BACKUP_ENCRYPTION_KEY (voir docs/BACKUP_RESTORE_RUNBOOK.md).');
    process.exit(1);
  }

  // Fichier intermédiaire écrit HORS du dossier --in (os.tmpdir(), pas
  // à côté de --out) : correctif d'un bug réel trouvé en testant — si
  // --out (ou son .tmp.tar.gz intermédiaire) se retrouvait À
  // L'INTÉRIEUR du dossier --in, `tar` échouait ("file changed as we
  // read it", il s'archivait lui-même en cours d'écriture).
  const tarPath = path.join(os.tmpdir(), `medconnect-backup-${randomUUID()}.tar.gz`);
  try {
    // tar+gzip d'abord (un seul flux à chiffrer), jamais écrit sur
    // disque en clair au-delà de cette étape intermédiaire locale au
    // runner (supprimée juste après, avant toute publication).
    execFileSync('tar', ['-czf', tarPath, '-C', args.in, '.'], { stdio: 'inherit' });
    execFileSync('gpg', [
      '--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256',
      '--passphrase', passphrase, '--output', args.out, tarPath,
    ], { stdio: 'inherit' });
  } finally {
    try { rmSync(tarPath, { force: true }); } catch { /* ignore */ }
  }

  const manifestOutPath = args.manifestOut || `${args.out}.manifest.json`;
  const publicManifest = {
    date: new Date().toISOString(),
    version: args.version || null,
    collectionDocumentCount: readTotalDocumentCount(args.in),
    encrypted: true,
    cipher: 'AES256 (gpg --symmetric)',
    checksumSha256: sha256Of(args.out),
  };
  writeFileSync(manifestOutPath, JSON.stringify(publicManifest, null, 2));

  console.log(`✅ Archive chiffrée : ${args.out}`);
  console.log(`✅ Manifeste public (non sensible) : ${manifestOutPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Chiffrement interrompu :', err); process.exit(1); });
}
