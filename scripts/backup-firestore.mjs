#!/usr/bin/env node
/* =====================================================
   SAUVEGARDE FIRESTORE — export JSON/NDJSON (PARTIE 8 de l'audit)

   Ferme le point "sauvegarde/perte de données" à coût nul : ce script
   utilise l'Admin SDK (gratuit, ne nécessite PAS le plan Blaze — c'est
   l'export natif `gcloud firestore export` qui exige un compte de
   facturation GCP, pas l'Admin SDK) pour lire chaque collection et
   l'écrire en NDJSON (un document JSON par ligne, format streamable et
   facile à réimporter). Conçu pour tourner soit manuellement, soit via
   la Action GitHub planifiée `backup-firestore.yml` (voir ce fichier).

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/backup-firestore.mjs                    # collections par défaut
     node scripts/backup-firestore.mjs --out ./mon-dossier # dossier de sortie personnalisé
     node scripts/backup-firestore.mjs --collections mc_accounts,users

   Voir docs/BACKUP_RESTORE_RUNBOOK.md pour la procédure de
   restauration et la vérification d'intégrité avant réimport.
   ===================================================== */
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import path from 'node:path';

// Collections applicatives réelles (extraites de firestore.rules) —
// exclut les collections purement techniques (`system`) qui ne
// contiennent aucune donnée utilisateur à sauvegarder.
export const BACKUP_COLLECTIONS = [
  'mc_accounts', 'users', 'doctors', 'nurses', 'pharmacies',
  'registration_requests', 'affiliation_requests', 'hospitalMembers',
  'hospitals', 'establishments', 'establishment_documents', 'subscriptions',
  'mc_patients', 'patients', 'medical_records',
  'mc_consultations', 'consultations', 'mc_prescriptions', 'prescriptions',
  'labRequests', 'labResults', 'mc_lab_results',
  'admissions', 'receptionVisits', 'emergencyCases', 'maternityCases', 'beds', 'aiQueries',
  'mc_consents', 'medical_record_shares', 'emergencyTransfers',
  'mc_appointments', 'appointments',
  'mc_vaccinations', 'mc_medicines', 'mc_sales',
  'mc_messages', 'messages', 'notifications',
  'auditLogs',
  'mc_hospitals', 'mc_affiliations',
  'mc_verified_doctors', 'mc_verified_nurses', 'mc_verified_pharms',
];

function parseArgs(argv) {
  const out = { outDir: null, collections: BACKUP_COLLECTIONS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.outDir = argv[++i];
    if (argv[i] === '--collections') out.collections = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    if (argv[i] === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/backup-firestore.mjs [--out <dossier>] [--collections a,b,c] [--help]

Sans --collections, exporte les ${BACKUP_COLLECTIONS.length} collections
applicatives connues (voir BACKUP_COLLECTIONS dans ce fichier).
Sans --out, écrit dans backups/<horodatage-ISO>/.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  let admin;
  try {
    admin = await import('firebase-admin');
  } catch {
    console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.outDir || path.join('backups', timestamp);
  mkdirSync(outDir, { recursive: true });

  const manifest = { startedAt: new Date().toISOString(), collections: {} };

  for (const collection of args.collections) {
    const filePath = path.join(outDir, `${collection}.ndjson`);
    const stream = createWriteStream(filePath, { encoding: 'utf8' });
    let count = 0;
    try {
      const snap = await db.collection(collection).get();
      for (const docSnap of snap.docs) {
        stream.write(JSON.stringify({ id: docSnap.id, data: docSnap.data() }) + '\n');
        count++;
      }
      manifest.collections[collection] = { count, ok: true };
      console.log(`✅ ${collection} : ${count} document(s)`);
    } catch (err) {
      // Une collection absente/inaccessible ne doit jamais interrompre
      // la sauvegarde des autres — chaque collection est indépendante,
      // même principe que les suppressions best-effort de
      // Auth._confirmDeleteMyAccount.
      manifest.collections[collection] = { count: 0, ok: false, error: err?.message || String(err) };
      console.warn(`⚠️  ${collection} : échec (${err?.message || err})`);
    } finally {
      stream.end();
    }
  }

  manifest.finishedAt = new Date().toISOString();
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const failed = Object.values(manifest.collections).filter(c => !c.ok).length;
  console.log(`\n📦 Sauvegarde écrite dans ${outDir} (${args.collections.length - failed}/${args.collections.length} collections OK).`);
  if (failed > 0) {
    console.warn(`⚠️  ${failed} collection(s) en échec — voir manifest.json. Le reste de la sauvegarde est utilisable.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Sauvegarde interrompue :', err); process.exit(1); });
}
