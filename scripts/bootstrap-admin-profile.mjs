#!/usr/bin/env node
/* =====================================================
   BOOTSTRAP DU PROFIL ADMINISTRATEUR PLATEFORME

   Crée (ou complète) le document Firestore `users/{uid}` avec
   role:"admin" / status:"approved" pour un administrateur plateforme,
   à partir de son ADRESSE E-MAIL. L'UID est résolu côté serveur via
   Firebase Auth (getUserByEmail) — jamais saisi à la main, donc aucune
   erreur de transcription possible.

   POURQUOI : la connexion administrateur (js/firebase-config.js,
   MedConnectAdminCloud.login) exige un document users/{uid} avec
   role:"admin". Ce document ne peut PAS être créé en self-service
   depuis l'app (sécurité : firestore.rules exclut 'admin' des rôles
   auto-créables). Il doit donc être posé une fois par le propriétaire
   du projet, via l'Admin SDK (qui contourne les règles) — soit à la
   main dans la console, soit par ce script.

   SÉCURITÉ :
   - N'accorde JAMAIS un custom claim admin (ça reste piloté
     exclusivement par ADMIN_UID_ALLOWLIST dans
     scripts/sync-account-security.mjs). Ce script n'écrit QUE le
     document de profil users/{uid} que la connexion admin relit.
   - Écriture en `merge:true` : ne détruit aucun autre champ existant.
   - Nécessite GOOGLE_APPLICATION_CREDENTIALS (clé de service, jamais
     dans le dépôt) et une adresse cible explicite (ADMIN_EMAIL).
   - Sans --apply : simple simulation (dry-run), n'écrit rien.

   USAGE (local) :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     export ADMIN_EMAIL="admin@exemple.com"      # requis
     export ADMIN_NAME="Administrateur"          # optionnel
     node scripts/bootstrap-admin-profile.mjs --apply

   Voir aussi .github/workflows/bootstrap-admin-profile.yml (exécution
   en CI avec le secret FIREBASE_SERVICE_ACCOUNT_JSON, sans jamais
   exposer la clé).
   ===================================================== */

const APPLY = process.argv.includes('--apply');
const email = (process.env.ADMIN_EMAIL || '').trim();
const name = (process.env.ADMIN_NAME || 'Administrateur').trim();

if (!email) {
  console.error('❌ ADMIN_EMAIL requis (adresse e-mail du compte administrateur à configurer).');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('❌ GOOGLE_APPLICATION_CREDENTIALS requis (chemin vers la clé de service Firebase).');
  process.exit(1);
}

let initializeApp, applicationDefault, getApps, getFirestore, getAuth, FieldValue;
try {
  // Même API modulaire que scripts/backup-firestore.mjs / sync-account-security.mjs
  ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
  ({ getFirestore, FieldValue } = await import('firebase-admin/firestore'));
  ({ getAuth } = await import('firebase-admin/auth'));
} catch {
  console.error("❌ firebase-admin introuvable. Installez-le d'abord : npm install firebase-admin --no-save");
  process.exit(1);
}

if (!getApps().length) initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const auth = getAuth();

console.log(`🔐 Bootstrap profil administrateur — cible : ${email}`);
console.log(`   Mode : ${APPLY ? 'APPLICATION (écriture réelle)' : 'SIMULATION (dry-run, aucune écriture)'}`);

let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  console.error(`❌ Aucun compte Firebase Auth pour ${email} (${err?.code || err?.message || err}).`);
  console.error('   Créez d\'abord le compte (l\'admin doit s\'être connecté au moins une fois), puis relancez.');
  process.exit(1);
}

const uid = user.uid;
console.log(`   UID résolu : ${uid}`);

const ref = db.collection('users').doc(uid);
const before = await ref.get();
if (before.exists) {
  const d = before.data() || {};
  console.log(`   users/${uid} existe déjà (role=${d.role || '∅'}, status=${d.status || '∅'}) — fusion des champs admin.`);
} else {
  console.log(`   users/${uid} absent — création.`);
}

const profile = {
  uid,
  authUid: uid,
  email,
  role: 'admin',
  status: 'approved',
  name,
  updatedAt: new Date().toISOString(),
};

if (!APPLY) {
  console.log('   [dry-run] Document qui SERAIT écrit :', JSON.stringify(profile));
  console.log('ℹ️  Relancez avec --apply pour écrire réellement.');
  process.exit(0);
}

// merge:true — ne détruit aucun autre champ éventuellement présent.
await ref.set({ ...profile, createdAt: before.exists ? (before.data()?.createdAt || FieldValue.serverTimestamp()) : FieldValue.serverTimestamp() }, { merge: true });

const after = await ref.get();
const a = after.data() || {};
if (a.role === 'admin' && ['approved', 'active'].includes(String(a.status || '').toLowerCase())) {
  console.log(`✅ Profil administrateur configuré : users/${uid} (role=admin, status=${a.status}).`);
  console.log('   L\'administrateur peut maintenant se connecter (relancer l\'app pour charger la dernière version).');
  process.exit(0);
}
console.error('❌ Écriture effectuée mais relecture incohérente :', JSON.stringify(a));
process.exit(1);
