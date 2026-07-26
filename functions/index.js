/* =====================================================
   MedConnect — Cloud Functions (chantiers 6 & 7, v2.9.42)

   OBJECTIF : retirer les deux dépendances du client à la LECTURE PUBLIQUE de
   mc_accounts (allow read: if true) et au code de premier accès patient
   lisible côté client. Ces vérifications passent côté SERVEUR, où l'Admin SDK
   lit ce qu'il faut sans jamais exposer la collection.

   Trois fonctions « callable » (2e génération), App Check EXIGÉ, config
   ÉCONOME (chantier 12 / réduction coût Blaze) : minInstances=0 (aucune
   instance chaude facturée au repos), 256 MiB, région unique.

   - authLookup           : résout l'existence + le routage minimal d'un compte
                            (par numéro pro, ou par numéro de fiche patient)
                            SANS renvoyer le contenu de la collection.
   - claimPatientAccount  : lie mc_accounts/PAT_{patientId} à l'uid Firebase de
                            l'appelant APRÈS vérification serveur du code de
                            premier accès — le code n'a plus besoin d'être
                            lisible publiquement.
   - setVerifiedClientType: pose un custom claim clientType (desktop/mobile)
                            vérifié à l'enrôlement, pour ne plus dépendre du
                            sourceDevice envoyé par le client (jamais une preuve
                            de sécurité — chantier 7).

   ⚠️ Ces fonctions doivent être DÉPLOYÉES et VALIDÉES avant de fermer la
   lecture publique de mc_accounts dans firestore.rules. Tant que ce n'est pas
   fait, le client conserve son chemin actuel en repli (feature-detection, voir
   js/auth.js). Voir docs/DEPLOYMENT_v2.9.42.md.
   ===================================================== */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

initializeApp();

// Région unique (coût). europe-west1 par défaut ; ajustable via variable
// d'environnement au déploiement sans toucher au code.
const REGION = process.env.MEDCONNECT_FUNCTIONS_REGION || 'europe-west1';

// Options communes ÉCONOMES : aucune instance chaude au repos (pas de
// facturation à vide), mémoire minimale suffisante, App Check obligatoire.
const CALL_OPTS = {
  region: REGION,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 10,
  enforceAppCheck: true, // rejette tout appel sans jeton App Check valide
};

const PROFESSIONAL_FIELD = { doctor: 'order_num', nurse: 'matricule', pharmacist: 'order_num' };
const ROLE_COLLECTION = { doctor: 'doctors', nurse: 'nurses', pharmacist: 'pharmacies' };

/* Projection MINIMALE renvoyée au client : juste de quoi enchaîner la
   connexion Firebase Auth. Jamais le document entier, jamais un autre compte,
   jamais de champ clinique. */
function minimalAccountView(id, data, fallbackRole) {
  return {
    exists: true,
    uid: data.uid || id,
    role: data.role || fallbackRole || null,
    status: data.status || 'pending',
    email: data.email || '', // e-mail technique de session (jamais affiché)
  };
}

/* authLookup — résout un compte sans exposer mc_accounts.
   Entrée : { role, professionalNumber } (professionnel) OU { patientId }.
   Sortie : { exists:false } ou minimalAccountView. */
exports.authLookup = onCall(CALL_OPTS, async (request) => {
  const db = getFirestore();
  const { role, professionalNumber, patientId } = request.data || {};

  // Cas patient : document adressé directement (PAT_{patientId}).
  if (patientId) {
    const id = 'PAT_' + String(patientId).toUpperCase();
    const snap = await db.collection('mc_accounts').doc(id).get();
    if (!snap.exists) return { exists: false };
    return minimalAccountView(snap.id, snap.data(), 'patient');
  }

  // Cas professionnel : numéro d'ordre / matricule.
  if (!role || !professionalNumber) {
    throw new HttpsError('invalid-argument', 'role et professionalNumber requis (ou patientId).');
  }
  const field = PROFESSIONAL_FIELD[role];
  if (!field) throw new HttpsError('invalid-argument', 'Rôle professionnel non pris en charge.');
  const num = String(professionalNumber).toUpperCase();

  // Ordre : collection de rôle → users → mc_accounts (même ordre que le
  // client historique), mais côté serveur, sans lecture publique.
  const roleCol = ROLE_COLLECTION[role];
  if (roleCol) {
    const s = await db.collection(roleCol).where(field, '==', num).limit(1).get();
    if (!s.empty) return minimalAccountView(s.docs[0].id, s.docs[0].data(), role);
  }
  const su = await db.collection('users').where('role', '==', role).where(field, '==', num).limit(1).get();
  if (!su.empty) return minimalAccountView(su.docs[0].id, su.docs[0].data(), role);
  const sa = await db.collection('mc_accounts').where('role', '==', role).where(field, '==', num).limit(1).get();
  if (!sa.empty) return minimalAccountView(sa.docs[0].id, sa.docs[0].data(), role);

  return { exists: false };
});

/* checkAgentDuplicate — détecte, côté serveur, un compte professionnel EXISTANT
   (avec authUid réel) portant le même matricule / numéro d'ordre / e-mail, sans
   exposer la collection mc_accounts au client. Utilisé à l'inscription d'un
   agent (lab/reception/pro) pour éviter les doublons. App Check exigé ; aucune
   donnée de compte n'est renvoyée, seulement l'existence d'un conflit.

   Entrée : { role, matricule?, professionalNumber?, email? }.
   Sortie : { conflict: boolean }. */
exports.checkAgentDuplicate = onCall(CALL_OPTS, async (request) => {
  const db = getFirestore();
  const d = request.data || {};
  const role = String(d.role || '');
  if (!role) throw new HttpsError('invalid-argument', 'role requis.');
  const num = (d.matricule || d.professionalNumber) ? String(d.matricule || d.professionalNumber).toUpperCase() : null;
  const email = d.email ? String(d.email).trim().toLowerCase() : null;
  const hasReal = (snap) => snap.docs.some(doc => doc.data() && doc.data().authUid);

  if (num) {
    for (const field of ['matricule', 'professionalNumber']) {
      const s = await db.collection('mc_accounts').where('role', '==', role).where(field, '==', num).limit(5).get();
      if (hasReal(s)) return { conflict: true };
    }
  }
  if (email) {
    const s = await db.collection('mc_accounts').where('role', '==', role).where('email', '==', email).limit(5).get();
    if (hasReal(s)) return { conflict: true };
  }
  return { conflict: false };
});

/* claimPatientAccount — lie le compte patient à l'appelant après vérification
   SERVEUR du code de premier accès. L'appelant doit être authentifié (il a
   déjà une session Firebase Auth, créée à partir du PIN). Le code de premier
   accès n'a donc plus besoin d'être lisible publiquement.

   Entrée : { patientId, firstAccessCode }.
   Sortie : { ok:true, claimed:true } | HttpsError. */
exports.claimPatientAccount = onCall(CALL_OPTS, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Session requise pour lier le compte.');
  }
  const authUid = request.auth.uid;
  const patientId = String((request.data || {}).patientId || '').toUpperCase();
  const code = String((request.data || {}).firstAccessCode || '');
  if (!patientId || !code) throw new HttpsError('invalid-argument', 'patientId et firstAccessCode requis.');

  const db = getFirestore();
  const accId = 'PAT_' + patientId;

  return db.runTransaction(async (tx) => {
    // 1) Le compte est-il déjà lié ? (idempotent / anti-préemption)
    const accRef = db.collection('mc_accounts').doc(accId);
    const accSnap = await tx.get(accRef);
    if (accSnap.exists && accSnap.data().authUid) {
      if (accSnap.data().authUid === authUid) return { ok: true, claimed: true, already: true };
      throw new HttpsError('already-exists', 'Ce compte patient est déjà lié à un autre appareil.');
    }

    // 2) Vérifier le code de premier accès contre la fiche patient (Admin SDK :
    //    lecture serveur, jamais exposée au client). On accepte la fiche
    //    canonique mc_patients ou l'annuaire patient_directory.
    let expected = null, established = null, fiche = null;
    const p = await tx.get(db.collection('mc_patients').doc(patientId));
    if (p.exists) { fiche = p.data(); expected = fiche.firstAccessCode || fiche.accessCode || null; established = fiche.establishmentId || fiche.hospital_id || null; }
    if (expected == null) {
      const d = await tx.get(db.collection('patient_directory').doc(patientId));
      if (d.exists) { expected = d.data().firstAccessCode || d.data().accessCode || null; established = d.data().establishmentId || d.data().hospital_id || null; }
    }
    if (expected == null) throw new HttpsError('not-found', 'Fiche patient introuvable ou sans code de premier accès.');
    if (String(expected) !== code) throw new HttpsError('permission-denied', 'Code de premier accès invalide.');

    // 3) Lier : créer/mettre à jour mc_accounts/PAT_{id} avec l'uid réel.
    tx.set(accRef, {
      uid: accId, role: 'patient', patient_id: patientId,
      authUid, establishmentId: established || null,
      status: 'approved', claimedAt: new Date().toISOString(),
    }, { merge: true });
    return { ok: true, claimed: true };
  });
});

/* setVerifiedClientType — pose un custom claim clientType vérifié (chantier 7).
   Le type d'appareil (desktop/mobile) n'est plus une simple assertion du client
   (sourceDevice, jamais une preuve) : il est fixé une fois pour l'utilisateur,
   côté serveur, et exploitable par les règles via le jeton. Idempotent ; ne
   permet jamais de se requalifier librement une fois posé. */
exports.setVerifiedClientType = onCall(CALL_OPTS, async (request) => {
  if (!request.auth || !request.auth.uid) throw new HttpsError('unauthenticated', 'Session requise.');
  const uid = request.auth.uid;
  const requested = String((request.data || {}).clientType || '');
  if (!['desktop', 'mobile'].includes(requested)) throw new HttpsError('invalid-argument', 'clientType invalide.');

  const auth = getAuth();
  const user = await auth.getUser(uid);
  const existing = (user.customClaims || {}).clientType || null;
  if (existing && existing !== requested) {
    // Déjà fixé à une autre valeur : jamais réécrit silencieusement.
    throw new HttpsError('failed-precondition', 'clientType déjà défini pour ce compte.');
  }
  if (!existing) {
    await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), clientType: requested });
  }
  return { ok: true, clientType: requested };
});

/* ═══════════════════════════════════════════════════════════
   SYSTÈME DE NOTIFICATIONS (v2.9.42, Phase 2)
   Le module ./notifications est requis APRÈS initializeApp() : ses fonctions
   résolvent getFirestore()/getAuth() paresseusement (jamais au chargement).
   Les callables sont re-exportées au niveau racine (requis par le déploiement).
   ═══════════════════════════════════════════════════════════ */
const notifications = require('./notifications');
exports.registerPushDevice = notifications.registerPushDevice;
exports.unregisterPushDevice = notifications.unregisterPushDevice;
exports.updateNotificationPreferences = notifications.updateNotificationPreferences;
exports.markNotificationRead = notifications.markNotificationRead;
exports.sendTestNotification = notifications.sendTestNotification;

// Déclencheurs métier (Phase 3) : notifications sur transitions réelles des
// collections canoniques (rendez-vous, résultats labo, ordonnances, admissions,
// affiliations). Idempotents par deduplicationKey.
const notificationTriggers = require('./notification-triggers');
exports.onAppointmentWritten = notificationTriggers.onAppointmentWritten;
exports.onLabResultWritten = notificationTriggers.onLabResultWritten;
exports.onPrescriptionWritten = notificationTriggers.onPrescriptionWritten;
exports.onAdmissionWritten = notificationTriggers.onAdmissionWritten;
exports.onAffiliationWritten = notificationTriggers.onAffiliationWritten;

// File d'envoi + nettoyage (Phase 4) : consommateur de tâches de livraison
// (retry natif Task Queue) et cron quotidien de désactivation des
// installations obsolètes. L'envoi réel aux fournisseurs arrive en Phase 5.
const notificationDelivery = require('./notification-delivery');
exports.deliverNotificationTask = notificationDelivery.deliverNotificationTask;
exports.cleanupStalePushRegistrations = notificationDelivery.cleanupStalePushRegistrations;
