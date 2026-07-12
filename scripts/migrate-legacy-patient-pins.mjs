#!/usr/bin/env node
/* =====================================================
   MIGRATION MANUELLE — nettoyage des PIN patients hérités (PARTIE B)

   ⚠️ NE PAS EXÉCUTER AUTOMATIQUEMENT. À lancer manuellement par le
   propriétaire du projet, avec un accès Firebase Admin (service
   account), après avoir lu ce fichier en entier.

   CONTEXTE : depuis ce chantier de sécurisation, js/auth.js
   (Auth._createPatientPin / Auth._doPatient) migre organiquement les
   comptes patient vers Firebase Authentication à chaque connexion
   réussie — mais cette migration se fait CÔTÉ CLIENT et est bloquée
   par les Firestore Rules pour les comptes qui n'ont pas encore de
   session Firebase Auth authentifiée avec le bon uid (voir
   firestore.rules, mc_accounts.update : réservé à l'admin ou au
   propriétaire du document par uid — un patient migrant depuis un
   ancien compte n'a pas encore cet uid tant que la création Firebase
   Auth n'a pas réussi EN LIGNE). Résultat : un compte patient créé
   avant ce chantier, qui ne se reconnecte jamais après le déploiement,
   garde indéfiniment son champ `password` en clair dans mc_accounts
   (collection en lecture publique) — c'est le SEUL cas que ce script
   traite.

   CE QUE FAIT CE SCRIPT (avec les privilèges Admin SDK, qui
   contournent les Firestore Rules comme le fait déjà l'app côté
   serveur) :
   1. Liste les documents mc_accounts avec role == 'patient' ET un
      champ `password` encore présent.
   2. Pour chacun, crée (ou réutilise si déjà créé) un utilisateur
      Firebase Authentication avec l'email synthétique
      patient-{id}@patients.medconnect.internal et l'ANCIEN mot de
      passe en clair comme mot de passe (complété à 6 caractères si
      besoin, même logique que js/auth.js::_toFirebasePassword) —
      AUCUNE valeur n'est jamais affichée dans les logs de ce script.
   3. Une fois le compte Firebase Auth confirmé créé, met à jour le
      document Firestore : ajoute `authUid`, SUPPRIME `password`.
   4. Journalise chaque id traité (jamais la valeur du PIN) dans un
      fichier JSON local, pour audit.

   Après exécution, plus AUCUN document mc_accounts ne doit contenir
   de champ password/pin — vérifiable avec :
     node scripts/check-secrets.mjs
   (qui scanne le dépôt, pas Firestore — pour vérifier Firestore
   lui-même, utiliser une requête Admin SDK équivalente en lecture
   seule, non fournie ici pour rester dans le périmètre "script de
   migration", pas "outil d'audit continu de la base").

   PRÉREQUIS :
     npm install firebase-admin --no-save
     export GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
     node scripts/migrate-legacy-patient-pins.mjs --dry-run
     node scripts/migrate-legacy-patient-pins.mjs --apply
   ===================================================== */
import { writeFileSync } from 'node:fs';

const DRY_RUN = !process.argv.includes('--apply');

function syntheticEmail(patientId) {
  return `patient-${String(patientId).toLowerCase().replace(/[^a-z0-9]/g, '')}@patients.medconnect.internal`;
}
function toFirebasePassword(pin) {
  return pin.length >= 6 ? pin : pin.padEnd(6, '0');
}

async function main() {
  console.log(DRY_RUN
    ? '🔍 Mode dry-run (aucune écriture, aucun compte Firebase Auth créé).'
    : '⚠️  Mode --apply : des comptes Firebase Auth vont être créés et mc_accounts modifié.');

  let initializeApp, applicationDefault, getApps, getFirestore, FieldValue, getAuth;
  try {
    // firebase-admin v14+ a retiré l'ancienne API groupée
    // (admin.firestore(), admin.auth(), admin.credential.applicationDefault())
    // — il faut désormais importer les sous-modules ESM directement
    // (bug réel, jamais détecté car ce script n'a jamais été exécuté
    // contre une vraie base, cf. commentaire en tête de fichier).
    ({ initializeApp, applicationDefault, getApps } = await import('firebase-admin/app'));
    ({ getFirestore, FieldValue } = await import('firebase-admin/firestore'));
    ({ getAuth } = await import('firebase-admin/auth'));
  } catch {
    console.error('❌ firebase-admin introuvable. Installez-le d\'abord : npm install firebase-admin --no-save');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({ credential: applicationDefault() });
  }
  const db = getFirestore();
  const auth = getAuth();

  const snap = await db.collection('mc_accounts')
    .where('role', '==', 'patient')
    .get();

  const legacy = snap.docs.filter(d => d.data().password !== undefined);
  console.log(`🔎 ${legacy.length} compte(s) patient avec PIN en clair détecté(s) sur ${snap.size} au total.`);

  const journal = [];
  for (const doc of legacy) {
    const data = doc.data();
    const id = data.patient_id || doc.id.replace(/^PAT_/, '');
    const email = syntheticEmail(id);
    const pin = toFirebasePassword(String(data.password));

    if (DRY_RUN) {
      journal.push({ docId: doc.id, action: 'would_migrate' });
      continue;
    }

    try {
      let userRecord;
      try {
        userRecord = await auth.createUser({ email, password: pin });
      } catch (err) {
        if (err.code === 'auth/email-already-exists') {
          userRecord = await auth.getUserByEmail(email);
        } else {
          throw err;
        }
      }
      await db.collection('mc_accounts').doc(doc.id).set(
        { authUid: userRecord.uid, email, password: FieldValue.delete() },
        { merge: true }
      );
      journal.push({ docId: doc.id, action: 'migrated' });
    } catch (err) {
      console.error(`❌ Échec migration ${doc.id} :`, err.message);
      journal.push({ docId: doc.id, action: 'failed', error: err.message });
    }
  }

  const journalPath = `migration-journal-patient-pins-${Date.now()}.json`;
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  console.log(`📝 Journal écrit : ${journalPath} (${journal.length} entrées, aucune valeur de PIN)`);
  console.log(DRY_RUN ? '✅ Dry-run terminé.' : '✅ Migration appliquée.');
}

main().catch(e => { console.error('❌ Échec du script :', e); process.exit(1); });
