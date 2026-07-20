#!/usr/bin/env node
/* =====================================================
   BACKFILL patient_directory — migration des fiches patient historiques
   (audit "workflows mobile/desktop", section 7)

   patient_directory est un miroir NON CLINIQUE de mc_patients (identité
   administrative seulement : patientId, firstname, lastname, dob,
   gender, phone, establissementId/hospital_id, administrativeStatus)
   destiné à réduire, à terme, ce que réception et laboratoire lisent
   pour identifier un patient (aujourd'hui : mc_patients en entier, un
   document CLINIQUE complet). Les nouvelles fiches créées via
   DB.addPatientAndConfirmAtomic() alimentent déjà cette collection
   dans le même batch atomique — ce script ne rattrape que les fiches
   créées AVANT ce correctif.

   Mode dry-run par défaut : lit mc_patients et affiche ce qui SERAIT
   écrit dans patient_directory, sans jamais appeler l'Admin SDK en
   écriture. Les documents dont le résultat est ambigu (patientId ou
   nom absent des deux côtés) sont signalés pour traitement manuel,
   jamais écrits automatiquement.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/backfill-patient-directory.mjs           # dry-run (rien n'est écrit)
     node scripts/backfill-patient-directory.mjs --apply   # exécution réelle
   ===================================================== */

function parseArgs(argv) {
  const out = { apply: false, help: false };
  for (const arg of argv) {
    if (arg === '--apply') out.apply = true;
    if (arg === '--help') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/backfill-patient-directory.mjs [--apply] [--help]

Sans --apply, mode dry-run par défaut : affiche ce qui SERAIT écrit
dans patient_directory pour chaque fiche mc_patients qui n'y a pas
encore de miroir, sans appeler l'Admin SDK en écriture.
Avec --apply : écrit réellement les documents patient_directory
manquants (jamais une écriture pour un document déjà présent — ce
script ne modifie jamais un patient_directory existant).`);
}

// Construit l'entrée non clinique à partir d'une fiche mc_patients —
// EXACTEMENT le même ensemble de champs que
// DB.buildPatientDirectoryEntry() (js/db.js), pour ne jamais diverger
// entre les fiches migrées et les nouvelles fiches créées côté client.
function buildDirectoryEntry(patient) {
  return {
    patientId: patient.id,
    firstname: patient.firstname || '',
    lastname: patient.lastname || '',
    dob: patient.dob || patient.birthdate || '',
    gender: patient.gender || '',
    phone: patient.phone || '',
    establishmentId: patient.establishmentId || patient.hospital_id || '',
    hospital_id: patient.hospital_id || patient.establishmentId || '',
    administrativeStatus: 'active',
    createdAt: patient.created_at || null,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log(args.apply
    ? '⚠️  Mode --apply : les documents patient_directory manquants vont être écrits.'
    : '🔍 Mode dry-run (aucune écriture). Utilisez --apply pour exécuter réellement.');

  let initializeApp, applicationDefault, getApps, getFirestore;
  try {
    ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
    ({ getFirestore } = await import('firebase-admin/firestore'));
  } catch {
    console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() });
  }
  const db = getFirestore();

  const [patientsSnap, directorySnap] = await Promise.all([
    db.collection('mc_patients').get(),
    db.collection('patient_directory').get(),
  ]);
  const existingIds = new Set(directorySnap.docs.map(d => d.id));
  const patients = patientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  let toMigrate = 0, skippedExisting = 0, flaggedAmbiguous = 0, written = 0, writeErrors = 0;

  for (const patient of patients) {
    if (existingIds.has(patient.id)) { skippedExisting++; continue; }
    if (!patient.id || (!patient.firstname && !patient.lastname)) {
      flaggedAmbiguous++;
      console.log(`⚠️  Fiche ambiguë signalée pour traitement manuel (id ou nom absent) : ${patient.id || '(sans id)'}`);
      continue;
    }
    toMigrate++;
    const entry = buildDirectoryEntry(patient);
    if (!args.apply) {
      console.log(`🔍 [dry-run] patient_directory/${patient.id} serait créé : ${entry.firstname} ${entry.lastname}`.trim());
      continue;
    }
    try {
      await db.collection('patient_directory').doc(patient.id).set(entry);
      written++;
    } catch (err) {
      writeErrors++;
      console.warn(`⚠️  Échec d'écriture patient_directory/${patient.id} :`, err?.message || err);
    }
  }

  console.log(`\n📦 ${args.apply ? 'Migration terminée' : 'Récapitulatif dry-run'} :`);
  console.log(`   Fiches mc_patients analysées : ${patients.length}.`);
  console.log(`   Déjà migrées (ignorées) : ${skippedExisting}.`);
  console.log(`   Signalées ambiguës (traitement manuel) : ${flaggedAmbiguous}.`);
  console.log(`   À migrer : ${toMigrate}${args.apply ? ` (${written} écrite(s), ${writeErrors} échec(s))` : ' (dry-run, aucune écriture)'}.`);
  if (!args.apply) console.log('Relancez avec --apply pour appliquer réellement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Migration interrompue :', err); process.exit(1); });
}

export { buildDirectoryEntry };
