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

   Correctif (audit sécurité, chantier "reception/affiliation sans
   régression") : la version précédente faisait confiance au SEUL
   document mc_accounts pour poser role/admin — un document mc_accounts
   forgé avec role:'admin' (avant le durcissement de firestore.rules,
   ou un vieux document résiduel) pouvait donc recevoir un VRAI custom
   claim admin:true. Ce script :
   - croise chaque compte candidat avec users/{authUid} (source jugée
     plus fiable, écrite par un chemin distinct) avant de poser un
     claim de rôle métier ;
   - ne pose JAMAIS admin:true à partir de mc_accounts.role — le claim
     admin est piloté EXCLUSIVEMENT par une allowlist fournie par le
     workflow (variable d'environnement ADMIN_UID_ALLOWLIST), jamais
     par une donnée écrite par un client ;
   - retire les claims métier (et l'éventuel admin:true résiduel) des
     comptes pending/rejected/suspended/incohérents, et de tout compte
     Firebase Auth n'ayant plus de document mc_accounts (deleted).

   PRÉREQUIS POUR EXÉCUTER (manuellement, hors CI) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     export ADMIN_UID_ALLOWLIST=uid1,uid2   # optionnel — voir plus bas
     node scripts/sync-account-security.mjs               # dry-run (rien n'est écrit)
     node scripts/sync-account-security.mjs --apply        # exécution réelle
   ===================================================== */

// Rôles métier standards pouvant recevoir un custom claim `role` —
// 'admin' EXCLU volontairement : ce script ne pose jamais ce rôle
// depuis mc_accounts (voir la gestion dédiée de l'allowlist plus bas).
const STANDARD_CLAIM_ROLES = [
  'patient', 'doctor', 'nurse', 'pharmacist', 'hospital', 'lab', 'reception', 'admin_hospital',
];

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
statut 'suspended', pose de vrais custom claims de rôle métier sur les
comptes 'approved'/'active' dont le profil users/{authUid} correspond,
retire les claims des comptes non conformes, et n'accorde/ne conserve
le claim admin que pour les uid listés dans ADMIN_UID_ALLOWLIST.

Variable d'environnement optionnelle :
  ADMIN_UID_ALLOWLIST  Liste d'UID Firebase séparés par des virgules,
                       seuls autorisés à conserver le custom claim
                       admin:true. Jamais lue depuis Firestore —
                       fournie explicitement par l'opérateur/le
                       workflow, jamais par un document éditable par
                       un client.`);
}

function parseAllowlist(raw) {
  return new Set(String(raw || '').split(',').map(s => s.trim()).filter(Boolean));
}

/* Détermine la valeur du claim admin à écrire pour un uid donné.
   Si l'allowlist est explicitement configurée (même vide), elle fait
   foi. Sinon (variable absente — opérateur n'a pas encore configuré le
   secret), on PRÉSERVE le claim admin déjà en place plutôt que de le
   remettre silencieusement à false — sans quoi la toute première
   exécution planifiée après ce correctif retirerait l'accès du seul
   vrai administrateur si personne n'a encore renseigné le secret. */
async function resolveAdminFlag(auth, uid, allowlistConfigured, allowlist) {
  if (allowlistConfigured) return allowlist.has(uid);
  try {
    const rec = await auth.getUser(uid);
    return rec.customClaims?.admin === true;
  } catch (_) {
    return false;
  }
}

/* Compare le compte mc_accounts au profil users/{authUid} correspondant.
   Retourne { ok: bool, reason: string|null }. */
function checkUsersConsistency(account, usersDoc) {
  if (!usersDoc) return { ok: false, reason: 'aucun profil users/{authUid} correspondant' };
  if (usersDoc.uid !== account.authUid) return { ok: false, reason: 'users.uid ne correspond pas à authUid' };
  if (usersDoc.authUid != null && usersDoc.authUid !== account.authUid) {
    return { ok: false, reason: 'users.authUid ne correspond pas à authUid' };
  }
  if (usersDoc.role !== account.role) return { ok: false, reason: `rôle incohérent (mc_accounts=${account.role}, users=${usersDoc.role})` };
  if (usersDoc.status !== account.status) return { ok: false, reason: `statut incohérent (mc_accounts=${account.status}, users=${usersDoc.status})` };
  return { ok: true, reason: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  // Correctif (audit) : distinguer "ADMIN_UID_ALLOWLIST non configurée
  // du tout" (opérateur n'a pas encore renseigné le secret — ne JAMAIS
  // toucher aux claims admin existants dans ce cas, sous peine de
  // retirer silencieusement l'accès du seul vrai administrateur à la
  // première exécution planifiée après ce correctif) de "configurée,
  // même vide" (choix explicite de l'opérateur, honoré tel quel).
  const allowlistConfigured = process.env.ADMIN_UID_ALLOWLIST !== undefined;
  const allowlist = parseAllowlist(process.env.ADMIN_UID_ALLOWLIST);

  console.log(args.apply
    ? '⚠️  Mode --apply : des refresh tokens vont être révoqués et des custom claims synchronisés.'
    : '🔍 Mode dry-run (aucun appel Admin SDK en écriture). Utilisez --apply pour exécuter réellement.');
  console.log(allowlistConfigured
    ? `   Allowlist admin : ${allowlist.size ? [...allowlist].join(', ') : '(vide — explicitement configurée sans aucun uid : tout claim admin existant sera retiré)'}`
    : '   Allowlist admin : NON CONFIGURÉE (ADMIN_UID_ALLOWLIST absente) — aucun claim admin existant ne sera modifié cette exécution, par sécurité.');

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

  // Pré-lecture groupée des profils users/{authUid} correspondants —
  // une seule passe, jamais un get() par compte dans la boucle
  // principale (coût Firestore prévisible, comme le reste du dépôt).
  const authUids = [...new Set(accounts.map(a => a.authUid).filter(Boolean))];
  const usersByUid = new Map();
  for (const uid of authUids) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) usersByUid.set(uid, userDoc.data());
    } catch (err) {
      console.warn(`⚠️  Lecture users/${uid} impossible :`, err?.message || err);
    }
  }

  const suspended = accounts.filter(a => a.status === 'suspended' && a.authUid);
  const revocable = { pending: 0, rejected: 0, suspended: 0, deleted: 0, inconsistent: 0 };

  let revoked = 0, revokeErrors = 0;
  let claimsGranted = 0, claimsCleared = 0, claimsErrors = 0;
  let skippedNoAuthUid = 0;

  for (const acc of accounts) {
    if (!acc.authUid) { skippedNoAuthUid++; continue; }

    const status = String(acc.status || '').toLowerCase();
    const usersDoc = usersByUid.get(acc.authUid) || null;
    const consistency = checkUsersConsistency(acc, usersDoc);

    // Correctif (audit) : jamais de claim de rôle métier pour role=admin
    // à partir de mc_accounts, même si le document est par ailleurs
    // cohérent avec un profil users — un vrai administrateur plateforme
    // n'a jamais de document mc_accounts (voir js/auth.js _doAdmin, qui
    // lit users/{uid} directement) ; un document mc_accounts portant
    // role:'admin' est donc systématiquement suspect et n'a plus le
    // droit d'être créé côté client depuis ce chantier (firestore.rules).
    const isSuspiciousAdminRole = acc.role === 'admin';
    const roleClaimEligible = !isSuspiciousAdminRole &&
      STANDARD_CLAIM_ROLES.includes(acc.role) &&
      ['approved', 'active'].includes(status) &&
      consistency.ok;

    if (isSuspiciousAdminRole) {
      console.log(`🚨 [pré-déploiement] mc_accounts/${acc.id} porte role:'admin' sans profil users validé habituel — ignoré, aucun claim ne sera posé depuis ce document.`);
    }
    if (!STANDARD_CLAIM_ROLES.includes(acc.role) && acc.role !== 'admin') {
      console.log(`🚨 [pré-déploiement] mc_accounts/${acc.id} porte un rôle inattendu (${acc.role}) — vérification manuelle recommandée.`);
    }

    if (roleClaimEligible) {
      if (!args.apply) {
        console.log(`🔍 [dry-run] claim ajouté/confirmé pour ${acc.id} (${acc.authUid}, role=${acc.role})`);
        continue;
      }
      try {
        const wantsAdmin = await resolveAdminFlag(auth, acc.authUid, allowlistConfigured, allowlist);
        await auth.setCustomUserClaims(acc.authUid, { role: acc.role, admin: wantsAdmin });
        claimsGranted++;
      } catch (err) {
        claimsErrors++;
        console.warn(`⚠️  Custom claims échoués pour ${acc.id} (${acc.authUid}) :`, err?.message || err);
      }
      continue;
    }

    // Compte non éligible à un claim métier : classer le motif pour le
    // rapport, puis retirer tout claim résiduel (jamais de faux
    // positif silencieux — voir mode dry-run détaillé ci-dessous).
    let reason;
    if (isSuspiciousAdminRole) reason = 'incohérence (role=admin)';
    else if (status === 'pending') { reason = 'pending'; revocable.pending++; }
    else if (status === 'rejected') { reason = 'rejected'; revocable.rejected++; }
    else if (status === 'suspended') { reason = 'suspended'; revocable.suspended++; }
    else if (!consistency.ok) { reason = `incohérence (${consistency.reason})`; revocable.inconsistent++; }
    else reason = `statut non éligible (${status || 'inconnu'})`;

    if (!args.apply) {
      console.log(`🔍 [dry-run] claim métier retiré/absent pour ${acc.id} (${acc.authUid}) — ${reason}`);
      continue;
    }
    try {
      const wantsAdmin = await resolveAdminFlag(auth, acc.authUid, allowlistConfigured, allowlist);
      await auth.setCustomUserClaims(acc.authUid, { role: null, admin: wantsAdmin });
      claimsCleared++;
    } catch (err) {
      claimsErrors++;
      console.warn(`⚠️  Retrait des claims échoué pour ${acc.id} (${acc.authUid}) :`, err?.message || err);
    }
  }

  // Révocation des refresh tokens des comptes suspendus (comportement
  // déjà existant, inchangé).
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

  // Correctif (audit) : réconciliation directe du claim admin sur TOUT
  // utilisateur Firebase Auth qui le porte déjà, indépendamment de
  // mc_accounts — ferme le cas d'un claim admin posé manuellement ou
  // par une exécution antérieure de ce script, resté actif alors que
  // l'uid n'est plus (ou n'a jamais été) dans l'allowlist. Jamais
  // l'inverse : ce script n'ACCORDE jamais admin à un uid absent de
  // l'allowlist, quel que soit son contenu Firestore.
  let adminClaimsRevoked = 0, adminReconcileErrors = 0, adminUsersScanned = 0;
  if (!allowlistConfigured) {
    console.log('⏭️  Réconciliation du claim admin ignorée : ADMIN_UID_ALLOWLIST non configurée (aucun claim admin existant ne sera modifié).');
  } else {
    try {
      let pageToken;
      do {
        const page = await auth.listUsers(1000, pageToken);
        for (const userRecord of page.users) {
          adminUsersScanned++;
          const claims = userRecord.customClaims || {};
          if (claims.admin === true && !allowlist.has(userRecord.uid)) {
            if (!args.apply) {
              console.log(`🔍 [dry-run] claim admin retiré (hors allowlist) pour ${userRecord.uid}`);
              continue;
            }
            try {
              await auth.setCustomUserClaims(userRecord.uid, { ...claims, admin: false });
              adminClaimsRevoked++;
            } catch (err) {
              adminReconcileErrors++;
              console.warn(`⚠️  Retrait du claim admin échoué pour ${userRecord.uid} :`, err?.message || err);
            }
          }
        }
        pageToken = page.pageToken;
      } while (pageToken);
    } catch (err) {
      console.warn('⚠️  Réconciliation du claim admin (listUsers) impossible :', err?.message || err);
    }
  }

  console.log(`\n📦 ${args.apply ? 'Synchronisation terminée' : 'Récapitulatif dry-run'} :`);
  console.log(`   Comptes mc_accounts analysés : ${accounts.length} (dont ${skippedNoAuthUid} sans authUid, ignorés).`);
  console.log(`   Claims métier ${args.apply ? `posés : ${claimsGranted}, retirés : ${claimsCleared}, échec(s) : ${claimsErrors}` : '(dry-run, aucune écriture)'}`);
  console.log(`   Motifs de retrait : pending=${revocable.pending}, rejected=${revocable.rejected}, suspended=${revocable.suspended}, incohérent=${revocable.inconsistent}.`);
  console.log(`   Révocations de session : ${args.apply ? `${revoked} réussie(s), ${revokeErrors} échec(s) sur` : ''} ${suspended.length} compte(s) suspendu(s).`);
  console.log(`   Réconciliation claim admin (hors mc_accounts) : ${adminUsersScanned} compte(s) Firebase Auth scanné(s), ${args.apply ? `${adminClaimsRevoked} claim(s) admin retiré(s), ${adminReconcileErrors} échec(s)` : 'dry-run'}.`);
  if (!args.apply) console.log('Relancez avec --apply pour appliquer réellement.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error('❌ Synchronisation interrompue :', err); process.exit(1); });
}
