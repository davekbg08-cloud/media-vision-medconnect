#!/usr/bin/env node
/* =====================================================
   MIGRATION MANUELLE — dédoublonnage patients → mc_patients (PARTIE G)

   ⚠️ NE PAS EXÉCUTER AUTOMATIQUEMENT (CI, hooks, etc.). Ce script
   n'a jamais été lancé contre une base de production dans le cadre
   de ce chantier de sécurisation — aucun accès sûr aux vraies
   données patients depuis cet environnement de développement, et une
   erreur ici serait potentiellement irréversible (perte de dossiers
   médicaux). À valider et exécuter manuellement par le propriétaire
   du projet, avec une sauvegarde préalable de la base Firestore
   (export via `gcloud firestore export`).

   CONTEXTE : le code applicatif (js/db.js) écrit historiquement en
   double dans deux collections aux règles différentes : `mc_patients`
   (lue par getPatientById/searchPatients, donc réellement canonique
   côté lecture) et `patients` (write-only côté client actuel, jamais
   relue par ces fonctions, probablement consommée ailleurs — à
   vérifier avant suppression complète, d'où l'absence de suppression
   automatique de `patients` dans ce script). `mc_patients` est donc
   retenue comme collection canonique.

   CE QUE FAIT CE SCRIPT :
   1. Lit `mc_patients` et `patients`.
   2. Pour chaque patient_id présent dans `patients` mais absent (ou
      moins complet) dans `mc_patients`, fusionne les champs vers
      `mc_patients` (mc_patients prioritaire en cas de conflit — c'est
      la copie déjà considérée fiable par le reste de l'app).
   3. Écrit un journal de migration (JSON) listant chaque id traité,
      AVANT toute écriture — permet de vérifier et d'annuler
      manuellement si besoin.
   4. NE SUPPRIME RIEN dans `patients` — la dépréciation de cette
      collection est une décision distincte, à prendre seulement après
      avoir confirmé qu'aucun autre consommateur (Android bundlé,
      export, etc.) ne la lit encore.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/migrate-patients-canonical.mjs --dry-run   # d'abord !
     node scripts/migrate-patients-canonical.mjs --apply     # ensuite
   ===================================================== */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  console.log(DRY_RUN
    ? '🔍 Mode dry-run (aucune écriture). Utilisez --apply pour appliquer réellement.'
    : '⚠️  Mode --apply : des écritures réelles vont être effectuées sur Firestore.');

  let admin;
  try {
    admin = await import('firebase-admin');
  } catch {
    console.error('❌ firebase-admin introuvable. Installez-le d\'abord : npm install firebase-admin --no-save');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  const db = admin.firestore();

  const [mcPatientsSnap, patientsSnap] = await Promise.all([
    db.collection('mc_patients').get(),
    db.collection('patients').get(),
  ]);

  const mcPatients = new Map(mcPatientsSnap.docs.map(d => [d.id, d.data()]));
  const journal = [];

  for (const doc of patientsSnap.docs) {
    const id = doc.id;
    const patientsData = doc.data();
    const canonical = mcPatients.get(id);

    if (!canonical) {
      journal.push({ id, action: 'copy_missing', reason: 'absent de mc_patients' });
      if (!DRY_RUN) await db.collection('mc_patients').doc(id).set(patientsData, { merge: true });
      continue;
    }

    // mc_patients déjà présent : on ne fusionne QUE les champs absents
    // côté mc_patients (mc_patients reste prioritaire en cas de conflit).
    const missingFields = Object.fromEntries(
      Object.entries(patientsData).filter(([k, v]) => canonical[k] === undefined && v !== undefined)
    );
    if (Object.keys(missingFields).length > 0) {
      journal.push({ id, action: 'merge_missing_fields', fields: Object.keys(missingFields) });
      if (!DRY_RUN) await db.collection('mc_patients').doc(id).set(missingFields, { merge: true });
    } else {
      journal.push({ id, action: 'no_change' });
    }
  }

  const journalPath = `migration-journal-patients-${Date.now()}.json`;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  console.log(`📝 Journal écrit : ${journalPath} (${journal.length} entrées)`);
  console.log(DRY_RUN
    ? '✅ Dry-run terminé, aucune écriture effectuée.'
    : '✅ Migration appliquée.');
}

main().catch(e => { console.error('❌ Échec de la migration :', e); process.exit(1); });
