#!/usr/bin/env node
/* =====================================================
   RESTAURATION FIRESTORE — réimport depuis une sauvegarde NDJSON

   ⚠️ NE PAS EXÉCUTER AUTOMATIQUEMENT (CI, hooks, etc.) — même prudence
   que scripts/migrate-patients-canonical.mjs. Une restauration écrase
   les documents existants avec ceux de la sauvegarde (merge:false) :
   à valider avec --dry-run d'abord, sur un projet Firebase de test si
   possible, jamais directement en production sans vérification.

   Voir docs/BACKUP_RESTORE_RUNBOOK.md pour la procédure complète.

   PRÉREQUIS :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/restore-firestore.mjs --from backups/2026-07-12T00-00-00-000Z --dry-run
     node scripts/restore-firestore.mjs --from backups/2026-07-12T00-00-00-000Z --apply
   ===================================================== */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { from: null, apply: false, collections: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i];
    if (argv[i] === '--apply') out.apply = true;
    if (argv[i] === '--collections') out.collections = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    if (argv[i] === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/restore-firestore.mjs --from <dossier> [--apply] [--collections a,b,c] [--help]

Sans --apply, mode dry-run par défaut : compte les documents à
restaurer sans rien écrire. --collections restreint à un sous-ensemble
des fichiers *.ndjson présents dans le dossier de sauvegarde.`);
}

function readNdjson(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (!args.from) { console.error('❌ --from <dossier> requis.'); process.exit(1); }
  if (!existsSync(args.from)) { console.error(`❌ Dossier introuvable : ${args.from}`); process.exit(1); }

  console.log(args.apply
    ? '⚠️  Mode --apply : des écritures réelles vont écraser les documents existants sur Firestore.'
    : '🔍 Mode dry-run (aucune écriture). Utilisez --apply pour restaurer réellement.');

  let db = null;
  if (args.apply) {
    let initializeApp, applicationDefault, getApps, getFirestore;
    try {
      // firebase-admin v14+ a retiré l'ancienne API groupée
      // (admin.firestore(), admin.credential.applicationDefault()) —
      // il faut désormais importer les sous-modules ESM directement
      // (firebase-admin/app, firebase-admin/firestore).
      ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
      ({ getFirestore } = await import('firebase-admin/firestore'));
    } catch {
      console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
      process.exit(1);
    }
    if (!getApps().length) {
      initializeApp({ credential: applicationDefault() });
    }
    db = getFirestore();
  }

  const files = readdirSync(args.from).filter(f => f.endsWith('.ndjson'));
  const targets = args.collections
    ? files.filter(f => args.collections.includes(f.replace(/\.ndjson$/, '')))
    : files;

  if (targets.length === 0) { console.error('❌ Aucun fichier .ndjson correspondant trouvé.'); process.exit(1); }

  let totalDocs = 0;
  for (const file of targets) {
    const collection = file.replace(/\.ndjson$/, '');
    const docs = readNdjson(path.join(args.from, file));
    totalDocs += docs.length;
    console.log(`${args.apply ? '✍️ ' : '🔍'} ${collection} : ${docs.length} document(s)${args.apply ? '' : ' (dry-run)'}`);

    if (!args.apply) continue;

    // Écriture par lots de 500 (limite Firestore par batch).
    const BATCH_SIZE = 500;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const { id, data } of docs.slice(i, i + BATCH_SIZE)) {
        batch.set(db.collection(collection).doc(id), data);
      }
      await batch.commit();
    }
  }

  console.log(`\n${args.apply ? '✅ Restauration terminée' : '📋 Récapitulatif dry-run'} : ${totalDocs} document(s) sur ${targets.length} collection(s).`);
  if (!args.apply) console.log('Relancez avec --apply pour appliquer réellement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Restauration interrompue :', err); process.exit(1); });
}
