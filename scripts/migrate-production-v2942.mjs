#!/usr/bin/env node
/* =====================================================
   MIGRATION PRODUCTION v2.9.42 — cohérence establishmentId / patient_directory
   (chantier 9 — « Firestore = source de vérité »)

   ⚠️ NE JAMAIS EXÉCUTER AUTOMATIQUEMENT (CI, hooks, déploiement). À lancer
   MANUELLEMENT par le propriétaire du projet, APRÈS une sauvegarde Firestore.
   Ce script ne SUPPRIME rien, ne réinitialise aucune collection, ne modifie
   AUCUN identifiant de document. Il n'ajoute que des CHAMPS MANQUANTS, en
   écriture partielle (merge), et écrit un journal complet AVANT/APRÈS
   permettant une annulation manuelle (rollback).

   POURQUOI CETTE MIGRATION
   ------------------------
   Depuis v2.9.42 (chantier 1), les écrans cliniques ne s'abonnent plus à la
   collection entière : ils interrogent chaque collection canonique par
   requêtes CIBLÉES `where('establishmentId','==', <id>)` (+ filet
   `where('created_by','==', uid)`). Une fiche/consultation/ordonnance
   HISTORIQUE qui ne porte QUE `hospital_id` (ancien nom) et pas
   `establishmentId` — ou l'inverse — devient invisible à ces requêtes : la
   donnée existe toujours dans Firestore mais ne « remonte » plus à l'écran.
   Cette migration rétablit la cohérence des deux champs (l'un recopié depuis
   l'autre quand il manque), de façon strictement additive, pour qu'aucune
   donnée confirmée ne disparaisse sous le nouveau modèle de lecture.

   Elle (re)crée aussi les entrées `patient_directory` manquantes (annuaire
   administratif non clinique), même ensemble de champs que
   DB.buildPatientDirectoryEntry / backfill-patient-directory.mjs.

   CE QU'ELLE NE FAIT JAMAIS
   -------------------------
   - Si `establishmentId` ET `hospital_id` sont présents mais DIFFÉRENTS :
     CONFLIT signalé pour traitement manuel, jamais tranché automatiquement
     (choisir au hasard pourrait ré-router une donnée clinique vers le mauvais
     établissement).
   - Si les DEUX sont absents : AMBIGU signalé, jamais deviné.
   - `created_by` manquant n'est JAMAIS fabriqué (on ne peut pas inventer
     l'auteur d'un document) — seulement signalé.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/backup-firestore.mjs                      # 1) SAUVEGARDE d'abord
     node scripts/migrate-production-v2942.mjs               # 2) dry-run (défaut, rien écrit)
     node scripts/migrate-production-v2942.mjs --apply --i-have-a-backup   # 3) exécution réelle

   OPTIONS :
     --apply               applique réellement (sinon dry-run par défaut)
     --i-have-a-backup     obligatoire avec --apply (garde-fou sauvegarde)
     --limit N             traite au plus N documents par collection
     --resume-from DOCID   reprend APRÈS ce docId (reprise après interruption)
     --collection NAME     restreint à une seule collection (défaut : toutes)
     --help
   ===================================================== */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/* Collections canoniques portant un champ d'établissement à réconcilier.
   patient_directory est traité à part (backfill depuis mc_patients). */
export const ESTABLISHMENT_COLLECTIONS = [
  'mc_patients', 'mc_consultations', 'mc_prescriptions', 'mc_appointments',
  'mc_lab_results', 'mc_admissions', 'mc_emergency_cases',
  'mc_maternity_cases', 'mc_vaccinations',
];

/* Décision PURE (testable hors Firebase) pour un document donné.
   Retourne { action, patch }, où patch est l'écriture partielle à appliquer
   (vide si aucune). N'écrase JAMAIS une valeur existante. */
export function reconcileEstablishmentField(data) {
  const est = data?.establishmentId;
  const hosp = data?.hospital_id;
  const hasEst = est !== undefined && est !== null && est !== '';
  const hasHosp = hosp !== undefined && hosp !== null && hosp !== '';

  if (hasEst && hasHosp) {
    if (est === hosp) return { action: 'no_change', patch: {} };
    // Deux valeurs présentes et divergentes : jamais tranché automatiquement.
    return { action: 'conflict', patch: {}, detail: { establishmentId: est, hospital_id: hosp } };
  }
  if (hasEst && !hasHosp) {
    return { action: 'fill_hospital_id', patch: { hospital_id: est } };
  }
  if (!hasEst && hasHosp) {
    return { action: 'fill_establishmentId', patch: { establishmentId: hosp } };
  }
  // Aucun des deux : impossible de deviner l'établissement.
  return { action: 'ambiguous', patch: {} };
}

/* Entrée annuaire — MÊME ensemble de champs que DB.buildPatientDirectoryEntry
   (js/db.js) et backfill-patient-directory.mjs, pour ne jamais diverger. */
export function buildDirectoryEntry(patient) {
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

export function parseArgs(argv) {
  const out = { apply: false, backup: false, help: false, limit: Infinity, resumeFrom: null, collection: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--i-have-a-backup') out.backup = true;
    else if (a === '--help') out.help = true;
    else if (a === '--limit') out.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (a === '--resume-from') out.resumeFrom = argv[++i] || null;
    else if (a === '--collection') out.collection = argv[++i] || null;
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/migrate-production-v2942.mjs [options]

Réconcilie establishmentId <-> hospital_id (champs manquants uniquement) sur les
collections canoniques et (re)crée les entrées patient_directory manquantes.
Strictement additif : ne supprime rien, ne modifie aucun identifiant, ne
tranche jamais un conflit automatiquement.

Options :
  --apply               applique réellement (sinon dry-run par défaut)
  --i-have-a-backup     OBLIGATOIRE avec --apply (garde-fou sauvegarde)
  --limit N             au plus N documents par collection
  --resume-from DOCID   reprend APRÈS ce docId
  --collection NAME     une seule collection (défaut : toutes + patient_directory)
  --help`);
}

async function loadAdmin() {
  let initializeApp, applicationDefault, getApps, getFirestore;
  try {
    ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
    ({ getFirestore } = await import('firebase-admin/firestore'));
  } catch {
    console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
    process.exit(1);
  }
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  return getFirestore();
}

async function migrateEstablishmentCollection(db, coll, args, journal, counters) {
  const snap = await db.collection(coll).get();
  let seenResume = args.resumeFrom == null;
  let processed = 0;
  for (const doc of snap.docs) {
    if (!seenResume) { if (doc.id === args.resumeFrom) seenResume = true; continue; }
    if (processed >= args.limit) break;
    processed++;
    const data = doc.data();
    const { action, patch, detail } = reconcileEstablishmentField(data);
    const missingCreatedBy = !data.created_by;

    if (action === 'no_change') { counters.noChange++; }
    else if (action === 'conflict') {
      counters.conflict++;
      journal.push({ collection: coll, id: doc.id, action, detail });
      console.log(`⚠️  CONFLIT ${coll}/${doc.id} : establishmentId=${detail.establishmentId} ≠ hospital_id=${detail.hospital_id} — traitement manuel.`);
    } else if (action === 'ambiguous') {
      counters.ambiguous++;
      journal.push({ collection: coll, id: doc.id, action });
      console.log(`⚠️  AMBIGU ${coll}/${doc.id} : ni establishmentId ni hospital_id — traitement manuel.`);
    } else {
      // fill_* : écriture partielle d'un champ manquant.
      counters.toFill++;
      journal.push({ collection: coll, id: doc.id, action, patch, before: { establishmentId: data.establishmentId ?? null, hospital_id: data.hospital_id ?? null } });
      if (args.apply) {
        try { await doc.ref.set(patch, { merge: true }); counters.written++; }
        catch (e) { counters.writeErrors++; console.warn(`⚠️  Échec écriture ${coll}/${doc.id} :`, e?.message || e); }
      } else {
        console.log(`🔍 [dry-run] ${coll}/${doc.id} : ${action} ${JSON.stringify(patch)}`);
      }
    }
    if (missingCreatedBy && (action === 'fill_establishmentId' || action === 'fill_hospital_id' || action === 'no_change')) {
      counters.missingCreatedBy++;
      // Jamais fabriqué : seulement signalé (une fiche sans created_by ne
      // remonte pas au filet created_by, mais reste visible par establishmentId).
      journal.push({ collection: coll, id: doc.id, action: 'missing_created_by_flagged' });
    }
  }
  console.log(`   ${coll} : ${processed} document(s) parcouru(s).`);
}

async function backfillDirectory(db, args, journal, counters) {
  const [patientsSnap, directorySnap] = await Promise.all([
    db.collection('mc_patients').get(),
    db.collection('patient_directory').get(),
  ]);
  const existing = new Set(directorySnap.docs.map(d => d.id));
  let seenResume = args.resumeFrom == null;
  let processed = 0;
  for (const doc of patientsSnap.docs) {
    if (!seenResume) { if (doc.id === args.resumeFrom) seenResume = true; continue; }
    if (processed >= args.limit) break;
    processed++;
    if (existing.has(doc.id)) { counters.dirSkipped++; continue; }
    const patient = { id: doc.id, ...doc.data() };
    if (!patient.firstname && !patient.lastname) {
      counters.dirAmbiguous++;
      console.log(`⚠️  patient_directory/${doc.id} : nom absent — traitement manuel.`);
      continue;
    }
    const entry = buildDirectoryEntry(patient);
    counters.dirToCreate++;
    journal.push({ collection: 'patient_directory', id: doc.id, action: 'create_directory_entry' });
    if (args.apply) {
      try { await db.collection('patient_directory').doc(doc.id).set(entry); counters.dirWritten++; }
      catch (e) { counters.writeErrors++; console.warn(`⚠️  Échec patient_directory/${doc.id} :`, e?.message || e); }
    } else {
      console.log(`🔍 [dry-run] patient_directory/${doc.id} serait créé : ${entry.firstname} ${entry.lastname}`.trim());
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  if (args.apply && !args.backup) {
    console.error('❌ --apply exige --i-have-a-backup. Lancez d\'abord `node scripts/backup-firestore.mjs`, puis relancez avec les deux drapeaux.');
    process.exit(1);
  }
  console.log(args.apply
    ? '⚠️  Mode --apply : écritures partielles réelles (champs manquants uniquement).'
    : '🔍 Mode dry-run (aucune écriture). Ajoutez --apply --i-have-a-backup pour exécuter.');

  const db = await loadAdmin();
  const journal = [];
  const counters = {
    noChange: 0, conflict: 0, ambiguous: 0, toFill: 0, written: 0, writeErrors: 0,
    missingCreatedBy: 0, dirSkipped: 0, dirAmbiguous: 0, dirToCreate: 0, dirWritten: 0,
  };

  const collections = args.collection
    ? (args.collection === 'patient_directory' ? [] : [args.collection])
    : ESTABLISHMENT_COLLECTIONS;
  for (const coll of collections) {
    await migrateEstablishmentCollection(db, coll, args, journal, counters);
  }
  if (!args.collection || args.collection === 'patient_directory') {
    await backfillDirectory(db, args, journal, counters);
  }

  const journalPath = `migration-journal-v2942-${Date.now()}.json`;
  writeFileSync(journalPath, JSON.stringify({ startedAt: new Date().toISOString(), dryRun: !args.apply, args, counters, journal }, null, 2));
  console.log(`\n📝 Journal écrit : ${journalPath} (${journal.length} entrée(s)) — sert de base au rollback manuel.`);
  console.log('📦 Récapitulatif :');
  console.log(`   Champ établissement à compléter : ${counters.toFill} (écrits : ${counters.written}, échecs : ${counters.writeErrors}).`);
  console.log(`   Inchangés : ${counters.noChange} | Conflits (manuel) : ${counters.conflict} | Ambigus (manuel) : ${counters.ambiguous}.`);
  console.log(`   Sans created_by (signalés) : ${counters.missingCreatedBy}.`);
  console.log(`   patient_directory à créer : ${counters.dirToCreate} (écrits : ${counters.dirWritten}, déjà présents : ${counters.dirSkipped}, ambigus : ${counters.dirAmbiguous}).`);
  if (!args.apply) console.log('\nRelancez avec --apply --i-have-a-backup pour appliquer réellement.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('❌ Migration interrompue :', e); process.exit(1); });
}
