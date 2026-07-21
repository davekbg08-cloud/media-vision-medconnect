#!/usr/bin/env node
/* =====================================================
   AUDIT/MIGRATION — comptes pharmacien sans pharmacyType
   (chantier v2.9.34 — règle IMPÉRATIVE pharmacie interne/externe)

   Contexte : v2.9.34 impose un split strict des pharmacies —
     - INTERNE (pharmacyType:'internal') : service pharmacie d'un
       établissement, inscrit depuis le desktop hôpital, rattaché à CET
       établissement et activable seulement via un hospitalMembers actif.
     - EXTERNE (pharmacyType:'external') : pharmacie indépendante,
       inscrite depuis la version mobile, jamais affiliée, jamais
       d'establishmentId/hospitalId.
   js/auth.js tague désormais 'internal' à la création desktop, et
   firestore.rules rend ce type IMMUABLE (seul l'admin plateforme peut le
   changer) et réserve l'affiliation (affiliation_requests +
   hospitalMembers) aux pharmacies internes (pharmacistAffiliationAllowed).

   Les comptes pharmacien créés AVANT ce chantier n'ont AUCUN
   pharmacyType. Les règles gardent un repli rétrocompatible EXPLICITE
   (pharmacyType absent → traité comme interne, donc autorisé à
   s'affilier) pour ne casser aucune pharmacie interne héritée. Ce script
   backfill le champ manquant à partir d'un signal FIABLE et
   DÉTERMINISTE — jamais une supposition arbitraire :

     INTERNE si (et seulement si) l'un de ces signaux serveur est vrai :
       - le compte porte déjà establishmentId ou hospitalId ;
       - il existe un hospitalMembers actif/approuvé pour cet uid ;
       - il existe une demande d'affiliation approuvée pour cet uid.
     EXTERNE sinon (aucun rattachement à un établissement) — c'est le cas
     par défaut d'une pharmacie indépendante mobile.

   Cette classification est SANS AMBIGUÏTÉ : un compte réellement affilié
   à un établissement présente toujours au moins un de ces signaux ; un
   compte indépendant n'en présente aucun. Le backfill ne fait donc que
   RENDRE EXPLICITE un fait déjà vrai côté serveur.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/migrate-pharmacy-type.mjs           # dry-run (rien n'est écrit)
     node scripts/migrate-pharmacy-type.mjs --apply    # applique le backfill
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
  console.log(`Usage: node scripts/migrate-pharmacy-type.mjs [--apply] [--help]

Sans --apply, mode dry-run par défaut : liste les comptes pharmacien
sans pharmacyType et le type qui serait posé (internal/external), sans
rien écrire. Avec --apply : écrit pharmacyType sur mc_accounts/{uid},
users/{uid} et pharmacies/{uid} (si présent) pour les seuls comptes
pharmacien qui n'ont pas encore ce champ. Un compte déjà tagué n'est
JAMAIS modifié (le type est immuable).`);
}

/* Classificateur PUR (testable sans Firestore) — décide le pharmacyType
   d'un compte pharmacien hérité à partir de signaux serveur fiables.
   Renvoie 'internal' dès qu'un rattachement à un établissement est
   avéré, 'external' sinon. */
function classifyPharmacyType(account, signals = {}) {
  const acc = account || {};
  const hasEstablishmentField =
    (acc.establishmentId != null && acc.establishmentId !== '') ||
    (acc.hospitalId != null && acc.hospitalId !== '');
  if (hasEstablishmentField) return 'internal';
  if (signals.hasActiveMembership === true) return 'internal';
  if (signals.hasApprovedAffiliation === true) return 'internal';
  return 'external';
}

function needsBackfill(account) {
  const v = account?.pharmacyType;
  return v === null || v === undefined || v === '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log(args.apply
    ? '⚠️  Mode --apply : écriture de pharmacyType sur les comptes pharmacien non tagués.'
    : '🔍 Mode dry-run (aucune écriture). Utilisez --apply pour appliquer le backfill.');

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
    .filter(a => a.role === 'pharmacist');

  // Index des affiliations pour les signaux serveur.
  const membersSnap = await db.collection('hospitalMembers').get();
  const activeMemberUids = new Set(
    membersSnap.docs
      .map(d => d.data())
      .filter(m => m && m.uid && ['active', 'approved'].includes(String(m.status || '').toLowerCase()))
      .map(m => m.uid)
  );
  const affReqSnap = await db.collection('affiliation_requests').get();
  const approvedAffiliationUids = new Set(
    affReqSnap.docs
      .map(d => d.data())
      .filter(r => r && r.requesterUid && String(r.status || '').toLowerCase() === 'approved')
      .map(r => r.requesterUid)
  );

  const toBackfill = pharmacists.filter(needsBackfill);
  console.log(`\n💊 Comptes pharmacien : ${pharmacists.length}, dont ${toBackfill.length} sans pharmacyType.`);
  if (toBackfill.length === 0) {
    console.log('✅ Tous les comptes pharmacien sont déjà tagués — rien à migrer.');
    return;
  }

  let internal = 0, external = 0, written = 0, writeErrors = 0;
  for (const acc of toBackfill) {
    const type = classifyPharmacyType(acc, {
      hasActiveMembership: activeMemberUids.has(acc.uid),
      hasApprovedAffiliation: approvedAffiliationUids.has(acc.uid),
    });
    if (type === 'internal') internal++; else external++;

    if (!args.apply) {
      console.log(`🔍 [dry-run] ${acc.uid} → pharmacyType:'${type}'`);
      continue;
    }
    // Écrit sur les trois miroirs de compte, quand ils existent.
    for (const collection of ['mc_accounts', 'users', 'pharmacies']) {
      try {
        const ref = db.collection(collection).doc(acc.uid);
        const snap = await ref.get();
        if (snap.exists) { await ref.update({ pharmacyType: type }); written++; }
      } catch (err) {
        writeErrors++;
        console.warn(`⚠️  Échec d'écriture ${collection}/${acc.uid} :`, err?.message || err);
      }
    }
  }

  console.log(`\n📊 Classification : ${internal} interne(s), ${external} externe(s).`);
  if (args.apply) {
    console.log(`📦 Migration terminée : ${written} document(s) mis à jour, ${writeErrors} échec(s).`);
  } else {
    console.log('\nRelancez avec --apply pour appliquer réellement.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Migration interrompue :', err); process.exit(1); });
}

export { classifyPharmacyType, needsBackfill };
