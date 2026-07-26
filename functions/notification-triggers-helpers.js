/* =====================================================
   MedConnect — Détection de transitions métier (Phase 3, v2.9.42)

   Logique PURE (sans Firebase) : à partir de `before`/`after` d'un document
   canonique, décide s'il y a une VRAIE transition à notifier, qui notifier, et
   avec quelle `eventVersion` (jeton déterministe de l'état déclencheur → le
   même état ré-écrit ne re-notifie jamais ; une nouvelle transition produit une
   nouvelle notification).

   Chaque détecteur retourne `null` (rien à notifier) ou :
     { eventType, category, priority, sourceType, eventVersion,
       targets: [{ role, patientId?|uid? }] }
   Les `targets` sont résolus en `recipientUid` (Firebase) par le wrapper Cloud
   Function (patientId → mc_accounts/PAT_{id}.authUid ; uid déjà Firebase).
   ===================================================== */

function s(v) { return v == null ? '' : String(v); }
function changed(a, b, key) { return s(a && a[key]) !== s(b && b[key]); }

/* Rendez-vous (mc_appointments) : création, changement date/heure, annulation. */
function appointmentTransition(before, after) {
  if (!after) return null;
  const patientId = after.patient_id || after.patientId || null;
  const doctorUid = after.doctorUid || after.doctor_uid || null;
  const targets = [];
  if (patientId) targets.push({ role: 'patient', patientId });
  if (doctorUid) targets.push({ role: 'doctor', uid: doctorUid });
  if (!targets.length) return null;

  if (!before) {
    return mk('appointment_created', 'appointments', 'normal', 'appointment', 'created', targets);
  }
  const statusAfter = s(after.status).toLowerCase();
  if (changed(before, after, 'status') && ['cancelled', 'canceled', 'annulé'].includes(statusAfter)) {
    return mk('appointment_cancelled', 'appointments', 'normal', 'appointment', 'cancelled:' + statusAfter, targets);
  }
  if (changed(before, after, 'date') || changed(before, after, 'time')) {
    return mk('appointment_updated', 'appointments', 'normal', 'appointment',
      'when:' + s(after.date) + 'T' + s(after.time), targets);
  }
  return null;
}

/* Résultat de laboratoire (mc_lab_results) : notifier UNIQUEMENT au passage
   du statut vers completed/finalized. */
const LAB_DONE = ['completed', 'finalized', 'final', 'finalisé', 'terminé', 'done'];
function labResultTransition(before, after) {
  if (!after) return null;
  const nowDone = LAB_DONE.includes(s(after.status).toLowerCase());
  const wasDone = before && LAB_DONE.includes(s(before.status).toLowerCase());
  if (!nowDone || wasDone) return null; // seulement la TRANSITION vers "fini"
  const targets = [];
  const patientId = after.patient_id || after.patientId;
  if (patientId) targets.push({ role: 'patient', patientId });
  // Médecin(s) destinataires du résultat.
  const docs = new Set([after.doctorUid, after.doctor_uid, ...(after.resultRecipientUids || [])].filter(Boolean));
  for (const uid of docs) targets.push({ role: 'doctor', uid });
  if (!targets.length) return null;
  return mk('lab_result', 'labResults', 'high', 'lab_result', 'completed:' + s(after.status), targets);
}

/* Ordonnance (mc_prescriptions) : nouvelle ordonnance pour le patient ;
   apparition/changement de pharmacyUid → notifier LA pharmacie ciblée. */
function prescriptionTransition(before, after) {
  if (!after) return null;
  const patientId = after.patient_id || after.patientId || null;
  const pharmacyUid = after.pharmacyUid || null;

  if (!before) {
    const targets = [];
    if (patientId) targets.push({ role: 'patient', patientId });
    if (pharmacyUid) targets.push({ role: 'pharmacy', uid: pharmacyUid });
    if (!targets.length) return null;
    return mk('prescription_created', 'prescriptions', 'normal', 'prescription', 'created', targets);
  }
  // pharmacyUid apparaît ou change vers une nouvelle pharmacie.
  if (pharmacyUid && changed(before, after, 'pharmacyUid')) {
    return mk('prescription_sent_pharmacy', 'prescriptions', 'normal', 'prescription',
      'pharmacy:' + s(pharmacyUid), [{ role: 'pharmacy', uid: pharmacyUid }]);
  }
  return null;
}

/* Admission (mc_admissions) : status → admitted (admission) / discharged (sortie). */
function admissionTransition(before, after) {
  if (!after) return null;
  const statusAfter = s(after.status).toLowerCase();
  const statusBefore = before ? s(before.status).toLowerCase() : '';
  if (statusAfter === statusBefore) return null;
  const patientId = after.patient_id || after.patientId || null;
  if (!patientId) return null;
  if (statusAfter === 'admitted' || statusAfter === 'admis') {
    return mk('admission_confirmed', 'admissions', 'normal', 'admission', 'admitted',
      [{ role: 'patient', patientId }]);
  }
  if (statusAfter === 'discharged' || statusAfter === 'sorti') {
    return mk('discharge_confirmed', 'admissions', 'normal', 'admission', 'discharged',
      [{ role: 'patient', patientId }]);
  }
  return null;
}

/* Affiliation (hospitalMembers) : pending → approved/rejected → notifier le
   membre concerné (uid). */
function affiliationTransition(before, after) {
  if (!after || !before) return null;
  const wasPending = s(before.status).toLowerCase() === 'pending';
  const now = s(after.status).toLowerCase();
  if (!wasPending || !['approved', 'active', 'rejected', 'refused'].includes(now)) return null;
  const uid = after.uid || null;
  if (!uid) return null;
  const approved = ['approved', 'active'].includes(now);
  return mk(approved ? 'affiliation_approved' : 'affiliation_rejected', 'account', 'normal',
    'affiliation', 'status:' + now, [{ role: after.role || 'staff', uid }]);
}

function mk(eventType, category, priority, sourceType, eventVersion, targets) {
  return { eventType, category, priority, sourceType, eventVersion, targets };
}

module.exports = {
  appointmentTransition, labResultTransition, prescriptionTransition,
  admissionTransition, affiliationTransition,
};
