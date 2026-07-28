/* =====================================================
   Tests — détecteurs de transition métier (Phase 3, v2.9.42)

   Vérifie qu'on ne notifie QUE sur une vraie transition (jamais à chaque
   écriture), qu'on cible les bons destinataires, et que l'eventVersion est
   stable pour un même état (idempotence) mais change à chaque nouvelle
   transition.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../functions/notification-triggers-helpers');

/* ── Rendez-vous ────────────────────────────────────── */
test('rendez-vous créé → notifie patient + médecin', () => {
  const d = T.appointmentTransition(null, { patient_id: 'MC1', doctorUid: 'DR1', date: '2026-08-01', time: '09:00' });
  assert.strictEqual(d.eventType, 'appointment_created');
  assert.deepStrictEqual(d.targets, [{ role: 'patient', patientId: 'MC1' }, { role: 'doctor', uid: 'DR1' }]);
});

test('rendez-vous : changement de date → notifie ; ré-écriture identique → rien', () => {
  const before = { patient_id: 'MC1', date: '2026-08-01', time: '09:00', status: 'booked' };
  const afterNewDate = { patient_id: 'MC1', date: '2026-08-02', time: '09:00', status: 'booked' };
  assert.strictEqual(T.appointmentTransition(before, afterNewDate).eventType, 'appointment_updated');
  // Même valeurs ré-écrites (listener/migration) → aucune notification.
  assert.strictEqual(T.appointmentTransition(before, { ...before }), null);
});

test('rendez-vous annulé → notifie', () => {
  const before = { patient_id: 'MC1', status: 'booked' };
  const after = { patient_id: 'MC1', status: 'cancelled' };
  assert.strictEqual(T.appointmentTransition(before, after).eventType, 'appointment_cancelled');
});

/* ── Résultat labo ──────────────────────────────────── */
test('résultat labo : notifie UNIQUEMENT à la transition vers completed', () => {
  const pending = { patient_id: 'MC1', doctorUid: 'DR1', status: 'pending' };
  const done = { patient_id: 'MC1', doctorUid: 'DR1', status: 'completed' };
  assert.strictEqual(T.labResultTransition(pending, done).eventType, 'lab_result');
  // Déjà completed, ré-écrit → rien.
  assert.strictEqual(T.labResultTransition(done, { ...done }), null);
  // Toujours pending → rien.
  assert.strictEqual(T.labResultTransition(pending, { ...pending }), null);
});

test('résultat labo : inclut les médecins destinataires (resultRecipientUids)', () => {
  const d = T.labResultTransition(
    { status: 'pending' },
    { patient_id: 'MC1', status: 'finalized', resultRecipientUids: ['DR1', 'DR2'] });
  const docs = d.targets.filter(t => t.role === 'doctor').map(t => t.uid);
  assert.deepStrictEqual(docs.sort(), ['DR1', 'DR2']);
});

/* ── Ordonnance ─────────────────────────────────────── */
test('ordonnance créée → patient (+ pharmacie si ciblée d\'emblée)', () => {
  const d = T.prescriptionTransition(null, { patient_id: 'MC1', pharmacyUid: 'PH1' });
  assert.strictEqual(d.eventType, 'prescription_created');
  assert.deepStrictEqual(d.targets, [{ role: 'patient', patientId: 'MC1' }, { role: 'pharmacy', uid: 'PH1' }]);
});

test('ordonnance : apparition de pharmacyUid → notifie SEULEMENT la pharmacie', () => {
  const before = { patient_id: 'MC1' };
  const after = { patient_id: 'MC1', pharmacyUid: 'PH1' };
  const d = T.prescriptionTransition(before, after);
  assert.strictEqual(d.eventType, 'prescription_sent_pharmacy');
  assert.deepStrictEqual(d.targets, [{ role: 'pharmacy', uid: 'PH1' }]);
  // Ré-écriture même pharmacyUid → rien.
  assert.strictEqual(T.prescriptionTransition(after, { ...after }), null);
});

/* ── Admission ──────────────────────────────────────── */
test('admission : status → admitted puis → discharged notifient le patient', () => {
  assert.strictEqual(T.admissionTransition({ patient_id: 'MC1', status: 'pending' }, { patient_id: 'MC1', status: 'admitted' }).eventType, 'admission_confirmed');
  assert.strictEqual(T.admissionTransition({ patient_id: 'MC1', status: 'admitted' }, { patient_id: 'MC1', status: 'discharged' }).eventType, 'discharge_confirmed');
  // Statut inchangé → rien.
  assert.strictEqual(T.admissionTransition({ patient_id: 'MC1', status: 'admitted' }, { patient_id: 'MC1', status: 'admitted' }), null);
});

/* ── Affiliation ────────────────────────────────────── */
test('affiliation : pending → approved/rejected notifie le membre', () => {
  assert.strictEqual(T.affiliationTransition({ uid: 'U1', status: 'pending' }, { uid: 'U1', status: 'approved', role: 'doctor' }).eventType, 'affiliation_approved');
  assert.strictEqual(T.affiliationTransition({ uid: 'U1', status: 'pending' }, { uid: 'U1', status: 'rejected' }).eventType, 'affiliation_rejected');
  // Déjà approuvé, ré-écrit → rien.
  assert.strictEqual(T.affiliationTransition({ uid: 'U1', status: 'approved' }, { uid: 'U1', status: 'approved' }), null);
});

/* ── Idempotence de l'eventVersion ──────────────────── */
test('eventVersion stable pour un même état, différent pour une nouvelle transition', () => {
  const before = { patient_id: 'MC1', date: '2026-08-01', time: '09:00', status: 'booked' };
  const a1 = T.appointmentTransition(before, { ...before, date: '2026-08-02' });
  const a2 = T.appointmentTransition({ ...before, date: '2026-08-05' }, { ...before, date: '2026-08-02' });
  assert.strictEqual(a1.eventVersion, a2.eventVersion, 'même date cible → même eventVersion (idempotent)');
  const a3 = T.appointmentTransition(before, { ...before, date: '2026-08-09' });
  assert.notStrictEqual(a1.eventVersion, a3.eventVersion, 'date différente → eventVersion différent');
});
