#!/usr/bin/env node
/* =====================================================
   AUDIT/MIGRATION — mc_medicines/mc_sales sans pharmacyUid
   (audit "workflows mobile/desktop", section 19)

   Bug confirmé (chantier sécurité, section 11) : avant ce correctif,
   mc_medicines/mc_sales n'avaient jamais de champ pharmacyUid —
   n'importe quel pharmacien pouvait lire/modifier/supprimer le stock
   ou les ventes de n'importe quel AUTRE pharmacien. js/db.js
   addMedicine()/addSale() posent désormais pharmacyUid à la création ;
   firestore.rules (pharmacyOwnsOrLegacy(), ligne ~541) garde un repli
   RÉTROCOMPATIBLE EXPLICITE pour les documents créés AVANT ce correctif
   (accessibles à tout pharmacien tant qu'ils n'ont pas de pharmacyUid).

   LIMITE HONNÊTE (à ne jamais contourner par une supposition) : ces
   documents legacy n'ont JAMAIS eu le moindre champ identifiant leur
   auteur (ni pharmacyUid, ni pharmacy_name, ni created_by) — il n'existe
   AUCUN signal fiable permettant de déduire automatiquement à quel
   pharmacien un document orphelin appartient réellement. Deviner
   serait pire que le statu quo (verrouillerait le stock d'un pharmacien
   sur le compte d'un autre).

   Ce script ne fait donc JAMAIS une supposition arbitraire :
   - S'il n'existe qu'UN SEUL compte pharmacien actif/approuvé sur toute
     la plateforme, l'attribution est sans ambiguïté : ce script peut
     (avec --apply) assigner pharmacyUid à ce seul compte pour tous les
     documents orphelins.
   - S'il existe PLUSIEURS comptes pharmaciens, AUCUNE écriture n'est
     jamais faite, même avec --apply : les documents orphelins sont
     seulement listés (mid/sid, date) pour une réconciliation MANUELLE
     (ex. contacter chaque pharmacie pour confirmer son historique).

   Tant que ces documents restent orphelins, le repli pharmacyOwnsOrLegacy()
   (firestore.rules) doit rester en place — le retirer sans avoir
   d'abord migré ou confirmé qu'aucun document orphelin ne subsiste
   couperait l'accès à des stocks/ventes légitimes.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/audit-legacy-pharmacy-records.mjs           # dry-run (rien n'est écrit)
     node scripts/audit-legacy-pharmacy-records.mjs --apply   # écrit UNIQUEMENT si un seul pharmacien existe
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
  console.log(`Usage: node scripts/audit-legacy-pharmacy-records.mjs [--apply] [--help]

Sans --apply, mode dry-run par défaut : liste les documents
mc_medicines/mc_sales sans pharmacyUid et indique si une attribution
automatique serait possible (un seul pharmacien actif/approuvé).
Avec --apply : n'écrit RÉELLEMENT que si un seul pharmacien actif/
approuvé existe sur toute la plateforme (attribution sans ambiguïté).
S'il en existe plusieurs, --apply n'écrit jamais rien : les documents
restent signalés pour une réconciliation manuelle.`);
}

function isOrphan(doc) {
  const v = doc.pharmacyUid;
  return v === null || v === undefined || v === '';
}

async function auditCollection(db, collectionName, idField) {
  const snap = await db.collection(collectionName).get();
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const orphans = all.filter(isOrphan);
  return { all, orphans, idField, collectionName };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log(args.apply
    ? '⚠️  Mode --apply : écriture UNIQUEMENT si un seul pharmacien actif/approuvé existe.'
    : '🔍 Mode dry-run (aucune écriture). Utilisez --apply pour tenter une attribution automatique.');

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

  const accountsSnap = await db.collection('mc_accounts').get();
  const pharmacists = accountsSnap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(a => a.role === 'pharmacist' && ['approved', 'active'].includes(a.status));

  const medicines = await auditCollection(db, 'mc_medicines', 'mid');
  const sales = await auditCollection(db, 'mc_sales', 'sid');

  console.log(`\n🏥 Comptes pharmacien actifs/approuvés trouvés : ${pharmacists.length}.`);
  console.log(`📦 mc_medicines : ${medicines.all.length} document(s), dont ${medicines.orphans.length} orphelin(s) (sans pharmacyUid).`);
  console.log(`🧾 mc_sales : ${sales.all.length} document(s), dont ${sales.orphans.length} orphelin(s) (sans pharmacyUid).`);

  const totalOrphans = medicines.orphans.length + sales.orphans.length;
  if (totalOrphans === 0) {
    console.log('\n✅ Aucun document orphelin — le repli legacy (pharmacyOwnsOrLegacy) peut être retiré de firestore.rules en toute sécurité.');
    return;
  }

  if (pharmacists.length !== 1) {
    console.log(`\n⚠️  ${pharmacists.length === 0 ? 'Aucun' : 'Plusieurs (' + pharmacists.length + ')'} compte(s) pharmacien actif(s) — aucune attribution automatique n'est possible sans risquer d'assigner un document au mauvais pharmacien.`);
    console.log('   Les documents suivants nécessitent une réconciliation MANUELLE :');
    for (const m of medicines.orphans) console.log(`   - mc_medicines/${m.id} (${m.name || 'sans nom'}, créé le ${m.created_at || '—'})`);
    for (const s of sales.orphans) console.log(`   - mc_sales/${s.id} (total ${s.total || '—'}, ${s.date || '—'})`);
    console.log('\nCe script n\'écrit rien tant que plusieurs comptes pharmacien coexistent (voir la limite documentée en tête de ce fichier).');
    return;
  }

  const owner = pharmacists[0];
  console.log(`\n✅ Un seul compte pharmacien actif/approuvé (${owner.uid}) — attribution sans ambiguïté possible pour les ${totalOrphans} document(s) orphelin(s).`);

  if (!args.apply) {
    for (const m of medicines.orphans) console.log(`🔍 [dry-run] mc_medicines/${m.id}.pharmacyUid serait fixé à ${owner.uid}`);
    for (const s of sales.orphans) console.log(`🔍 [dry-run] mc_sales/${s.id}.pharmacyUid serait fixé à ${owner.uid}`);
    console.log('\nRelancez avec --apply pour appliquer réellement.');
    return;
  }

  let written = 0, writeErrors = 0;
  for (const { collectionName, orphans } of [medicines, sales]) {
    for (const doc of orphans) {
      try {
        await db.collection(collectionName).doc(doc.id).update({ pharmacyUid: owner.uid });
        written++;
      } catch (err) {
        writeErrors++;
        console.warn(`⚠️  Échec d'écriture ${collectionName}/${doc.id} :`, err?.message || err);
      }
    }
  }
  console.log(`\n📦 Migration terminée : ${written} document(s) mis à jour, ${writeErrors} échec(s).`);
  if (writeErrors === 0) {
    console.log('Une fois vérifié qu\'aucun document orphelin ne subsiste (relancer ce script en dry-run), le repli legacy (pharmacyOwnsOrLegacy) peut être retiré de firestore.rules.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Audit interrompu :', err); process.exit(1); });
}

export { isOrphan };
