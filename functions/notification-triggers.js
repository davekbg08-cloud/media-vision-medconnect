/* =====================================================
   MedConnect — Déclencheurs métier de notifications (Phase 3, v2.9.42)

   Cloud Functions v2 sur les collections CANONIQUES. Chaque trigger :
   1. lit before/after, délègue la DÉTECTION de transition à la logique pure
      (notification-triggers-helpers) — jamais une notification à chaque
      écriture, seulement sur une vraie transition ;
   2. résout les `targets` en recipientUid Firebase (patientId →
      mc_accounts/PAT_{id}.authUid ; doctor/pharmacy/staff = uid déjà Firebase) ;
   3. appelle enqueueNotification (idempotent par deduplicationKey).

   Aucun contenu médical n'entre dans la notification : seulement des clés de
   libellé (titleKey/bodyKey) neutres.
   ===================================================== */

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { enqueueNotification } = require('./notifications');
const T = require('./notification-triggers-helpers');

const REGION = process.env.MEDCONNECT_FUNCTIONS_REGION || 'europe-west1';
const TRIGGER_OPTS = { region: REGION, memory: '256MiB', minInstances: 0, maxInstances: 10 };

// Libellés NEUTRES par type d'événement (aucune donnée médicale). Le client
// traduit ces clés ; le corps reste générique (« un nouveau résultat est
// disponible », jamais la valeur).
const LABELS = {
  appointment_created:       ['notif.appointment.created.title', 'notif.appointment.created.body'],
  appointment_updated:       ['notif.appointment.updated.title', 'notif.appointment.updated.body'],
  appointment_cancelled:     ['notif.appointment.cancelled.title', 'notif.appointment.cancelled.body'],
  lab_result:                ['notif.lab.ready.title', 'notif.lab.ready.body'],
  prescription_created:      ['notif.prescription.created.title', 'notif.prescription.created.body'],
  prescription_sent_pharmacy:['notif.prescription.pharmacy.title', 'notif.prescription.pharmacy.body'],
  admission_confirmed:       ['notif.admission.confirmed.title', 'notif.admission.confirmed.body'],
  discharge_confirmed:       ['notif.discharge.confirmed.title', 'notif.discharge.confirmed.body'],
  affiliation_approved:      ['notif.affiliation.approved.title', 'notif.affiliation.approved.body'],
  affiliation_rejected:      ['notif.affiliation.rejected.title', 'notif.affiliation.rejected.body'],
};

/* Résout un target en recipientUid Firebase. Retourne null si introuvable
   (jamais d'envoi à un destinataire non résolu). */
async function resolveTarget(db, target) {
  if (target.uid) return { recipientUid: target.uid, recipientRole: target.role };
  if (target.role === 'patient' && target.patientId) {
    const snap = await db.collection('mc_accounts').doc('PAT_' + String(target.patientId).toUpperCase()).get();
    const authUid = snap.exists ? snap.data().authUid : null;
    return authUid ? { recipientUid: authUid, recipientRole: 'patient' } : null;
  }
  return null;
}

/* Traite une transition détectée : résout les destinataires et met en file. */
async function handleTransition(descriptor, doc) {
  if (!descriptor) return;
  const db = getFirestore();
  const [titleKey, bodyKey] = LABELS[descriptor.eventType] || ['notif.generic.title', 'notif.generic.body'];
  const recipients = [];
  for (const target of descriptor.targets) {
    const r = await resolveTarget(db, target);
    if (r) recipients.push({ ...r, titleKey, bodyKey, category: descriptor.category, priority: descriptor.priority, sourceType: descriptor.sourceType });
  }
  if (!recipients.length) return;
  await enqueueNotification({
    eventId: `${descriptor.eventType}:${doc.id}:${descriptor.eventVersion}`,
    eventType: descriptor.eventType,
    sourceCollection: doc.collection,
    sourceDocumentId: doc.id,
    hospitalId: doc.data.establishmentId || doc.data.hospital_id || doc.data.hospitalId || null,
    category: descriptor.category,
    priority: descriptor.priority,
    eventVersion: descriptor.eventVersion,
    recipients,
  });
}

// Construit un trigger onDocumentWritten pour une collection + un détecteur.
function makeTrigger(collection, detector) {
  return onDocumentWritten({ document: `${collection}/{docId}`, ...TRIGGER_OPTS }, async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return; // suppression : pas de notification
    const descriptor = detector(before, after);
    await handleTransition(descriptor, { id: event.params.docId, collection, data: after });
  });
}

exports.onAppointmentWritten = makeTrigger('mc_appointments', T.appointmentTransition);
exports.onLabResultWritten = makeTrigger('mc_lab_results', T.labResultTransition);
exports.onPrescriptionWritten = makeTrigger('mc_prescriptions', T.prescriptionTransition);
exports.onAdmissionWritten = makeTrigger('mc_admissions', T.admissionTransition);
exports.onAffiliationWritten = makeTrigger('hospitalMembers', T.affiliationTransition);
