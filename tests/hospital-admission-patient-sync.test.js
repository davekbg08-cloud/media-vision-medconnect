/* =====================================================
   Tests — hospital-beds.js/hospital-reception.js écrivent bien le
   miroir mc_admissions (patient_id mappé depuis le numéro MC)

   Voir tests/db-admissions-mirror.test.js pour le miroir lui-même et
   tests/timeline-admissions-wiring.test.js pour le câblage côté
   interface patient.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const bedsSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-beds.js'), 'utf8');
const receptionSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-reception.js'), 'utf8');

// Correctif (audit "workflows mobile/desktop", section 12) : saveAdmission()
// n'écrit plus l'admission via CloudDB.createDoc() + un updateDoc('beds')
// séparé (race condition — double réservation possible du même lit) mais
// via CloudDB.assignBedTransaction(), une vraie transaction Firestore qui
// relit le lit au moment de l'écriture. Le miroir mc_admissions doit
// toujours suivre APRÈS la confirmation réelle de cette transaction.
test('hospital-beds.js saveAdmission() écrit le miroir mc_admissions APRÈS la transaction d\'attribution du lit', () => {
  const start = bedsSrc.indexOf('async function saveAdmission(');
  assert.ok(start !== -1);
  const end = bedsSrc.indexOf('\n  async function discharge', start);
  const body = bedsSrc.slice(start, end);
  const txIdx = body.indexOf('CloudDB.assignBedTransaction(');
  assert.ok(txIdx !== -1, "l'admission doit passer par une transaction d'attribution du lit");
  const mirrorIdx = body.indexOf('DB.addAdmissionRecord(');
  assert.ok(mirrorIdx !== -1, 'le miroir mc_admissions doit être écrit');
  assert.ok(txIdx < mirrorIdx, 'le miroir doit être écrit après la transaction');
  assert.match(body.slice(mirrorIdx, body.indexOf(');', mirrorIdx)), /patient_id:\s*mc/,
    'patient_id doit être mappé depuis le numéro MC saisi');
});

// Chantier sécurité (section 6, pré-admission) : bug confirmé —
// réception (rôle sans admit_patient/manage_beds) créait auparavant
// directement l'admission ET le miroir mc_admissions ici même. La
// sélection d'un lit par la réception ne crée plus qu'une PRÉ-ADMISSION
// (receptionVisit, status 'pre_admission') — jamais d'admissions/miroir
// mc_admissions depuis ce fichier. C'est désormais
// HospitalBedsModule.confirmAdmission() (js/hospital-beds.js, écran
// "Lits", réservé à doctor/nurse/admin_hospital/admin) qui crée
// l'admission ET écrit le miroir, une fois la pré-admission confirmée.
test('hospital-reception.js NE crée PLUS directement d\'admission (pré-admission uniquement, voir section 6)', () => {
  assert.ok(!receptionSrc.includes("CloudDB.createDoc('admissions'"),
    "hospital-reception.js ne doit plus créer directement de document admissions");
  assert.match(receptionSrc, /status = 'pre_admission'/,
    "la sélection d'un lit par la réception doit créer une pré-admission, pas une admission directe");
});

// Correctif (audit "workflows mobile/desktop", section 12) : même
// correctif que saveAdmission() — le batch atomique classique (lecture
// du lit puis batch séparé) est remplacé par assignBedTransaction(),
// qui relit le lit DANS la transaction et échoue entièrement si son
// statut n'est plus 'free'.
test('hospital-beds.js confirmAdmission() écrit le miroir mc_admissions APRÈS la transaction d\'attribution du lit (pré-admission confirmée)', () => {
  const start = bedsSrc.indexOf('async function confirmAdmission(');
  assert.ok(start !== -1, 'confirmAdmission doit exister');
  const end = bedsSrc.indexOf('\n  // Lit demandé indisponible', start);
  const body = bedsSrc.slice(start, end !== -1 ? end : undefined);
  const txIdx = body.indexOf('CloudDB.assignBedTransaction(');
  assert.ok(txIdx !== -1, "l'admission doit passer par une transaction d'attribution du lit");
  const mirrorIdx = body.indexOf('DB.addAdmissionRecord(');
  assert.ok(mirrorIdx !== -1, 'le miroir mc_admissions doit être écrit');
  assert.ok(txIdx < mirrorIdx, 'le miroir doit être écrit après la transaction');
  assert.match(body.slice(mirrorIdx, body.indexOf('});', mirrorIdx)), /patient_id:\s*visit\.patientMc/,
    'patient_id doit être mappé depuis le numéro MC de la visite');
});
