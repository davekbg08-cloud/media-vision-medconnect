#!/usr/bin/env node
/* =====================================================
   SYNCHRONISATION SÉCURITÉ DES COMPTES — révocation de session
   + custom claims (points "révocation de session" et "custom claims"
   de l'audit)

   Ferme, à coût nul (Admin SDK, gratuit sur le plan Spark, aucune
   Cloud Function), les deux dernières limites documentées :
   1. Un compte suspendu (`status: 'suspended'`) perd déjà l'accès aux
      DONNÉES Firestore en quasi temps réel (accountStatusOk(),
      firestore.rules) — mais son jeton Firebase Auth restait valide
      jusqu'à expiration naturelle. Ce script révoque réellement les
      refresh tokens des comptes suspendus.
   2. `firestore.rules` lit déjà request.auth.token.get('role', null)
      et .get('admin', false) EN OR avec la vérification Firestore —
      mais aucun custom claim n'était jamais posé (setCustomUserClaims
      n'était appelé nulle part dans ce dépôt). Ce script pose de
      vrais custom claims pour les comptes actifs/approuvés.

   Honnêteté : ceci n'est PAS une révocation instantanée façon Cloud
   Function réactive — ce script est conçu pour tourner périodiquement
   (voir .github/workflows/sync-account-security.yml, toutes les
   30 min). Voir docs/SESSION_REVOCATION_SYNC.md pour la nuance
   complète.

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/sync-account-security.mjs               # dry-run (rien n'est écrit)
     node scripts/sync-account-security.mjs --apply        # exécution réelle
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
  console.log(`Usage: node scripts/sync-account-security.mjs [--apply] [--help]

Sans --apply, mode dry-run par défaut : affiche ce qui SERAIT fait
(révocations + synchronisations de claims) sans appeler l'Admin SDK.
Avec --apply : révoque les refresh tokens des comptes mc_accounts au
statut 'suspended', et pose de vrais custom claims (role, admin) sur
les comptes 'approved'/'active'.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  console.log(args.apply
    ? '⚠️  Mode --apply : des refresh tokens vont être révoqués et des custom claims posés.'
    : '🔍 Mode dry-run (aucun appel Admin SDK). Utilisez --apply pour exécuter réellement.');

  let initializeApp, applicationDefault, getApps, getFirestore, getAuth;
  try {
    // Même API modulaire que scripts/backup-firestore.mjs (firebase-admin
    // v14+ a retiré l'ancienne API groupée, cf. correctif PR #7).
    ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
    ({ getFirestore } = await import('firebase-admin/firestore'));
    ({ getAuth } = await import('firebase-admin/auth'));
  } catch {
    console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() });
  }
  // La lecture Firestore reste identique en dry-run (elle est sans
  // risque, contrairement aux appels d'écriture Admin Auth) — même
  // principe que scripts/restore-firestore.mjs, dont le dry-run lit
  // réellement les fichiers de sauvegarde sans jamais écrire.
  const db = getFirestore();
  const auth = getAuth();

  const snap = await db.collection('mc_accounts').get();
  const accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const suspended = accounts.filter(a => a.status === 'suspended' && a.authUid);
  const active = accounts.filter(a => ['approved', 'active'].includes(a.status) && a.authUid && a.role);

  let revoked = 0, revokeErrors = 0, claimsSynced = 0, claimsErrors = 0;

  for (const acc of suspended) {
    if (!args.apply) { console.log(`🔍 [dry-run] révoquerait ${acc.id} (${acc.authUid})`); continue; }
    try {
      await auth.revokeRefreshTokens(acc.authUid);
      revoked++;
    } catch (err) {
      revokeErrors++;
      console.warn(`⚠️  Révocation échouée pour ${acc.id} (${acc.authUid}) :`, err?.message || err);
    }
  }

  for (const acc of active) {
    if (!args.apply) { console.log(`🔍 [dry-run] synchroniserait les claims de ${acc.id} (${acc.authUid}, role=${acc.role})`); continue; }
    try {
      await auth.setCustomUserClaims(acc.authUid, { role: acc.role, admin: acc.role === 'admin' });
      claimsSynced++;
    } catch (err) {
      claimsErrors++;
      console.warn(`⚠️  Custom claims échoués pour ${acc.id} (${acc.authUid}) :`, err?.message || err);
    }
  }

  console.log(`\n📦 ${args.apply ? 'Synchronisation terminée' : 'Récapitulatif dry-run'} :`);
  console.log(`   Révocations : ${args.apply ? `${revoked} réussie(s), ${revokeErrors} échec(s) sur` : ''} ${suspended.length} compte(s) suspendu(s).`);
  console.log(`   Custom claims : ${args.apply ? `${claimsSynced} réussi(s), ${claimsErrors} échec(s) sur` : ''} ${active.length} compte(s) actif(s)/approuvé(s).`);
  if (!args.apply) console.log('Relancez avec --apply pour appliquer réellement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Synchronisation interrompue :', err); process.exit(1); });
}
