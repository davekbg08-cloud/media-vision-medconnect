/* =====================================================
   Tests — Récupération cloud des fiches patient (chantier v2.9.41)

   Bug confirmé (photos utilisateur) : une fiche visible côté médecin
   « disparaît » après déconnexion/reconnexion, et le patient obtient
   « Numéro de fiche introuvable » depuis son téléphone. Cause : le seul
   chemin de lecture cloud de mc_patients était un listener collection-
   entière rejeté par les règles ; après la purge du cache au logout, plus
   rien ne rechargeait les fiches. Correctif : listeners FILTRÉS
   (établissement + created_by), outbox préservée si non confirmée, et
   login patient qui n'exige plus le cache local.

   Ces tests verrouillent le comportement au niveau SOURCE (les modules
   dépendent de Firebase/navigateur, non instanciables en pur Node) —
   même style que les autres tests de câblage du projet. La branche de
   règles correspondante est validée séparément à l'émulateur
   (tests/firestore-rules/patient-own-fiche-read.rules.test.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const db = read('js/db.js');
const auth = read('js/auth.js');

/* ── db.js : listeners patients filtrés ─────────────── */

test('setupUserScopedListeners recharge mc_patients par établissement ET par created_by', () => {
  const block = db.slice(db.indexOf('function setupUserScopedListeners'));
  assert.match(block, /collection\('mc_patients'\)\.where\('establishmentId', '==', estId\)/,
    'listener filtré par establishmentId attendu');
  assert.match(block, /collection\('mc_patients'\)\.where\('created_by', '==', user\.uid\)/,
    'listener filet created_by attendu');
});

test('les listeners patients sont réservés aux rôles membres (pas patient/pharmacien seuls)', () => {
  const block = db.slice(db.indexOf('function setupUserScopedListeners'));
  assert.match(block, /\['doctor', 'nurse', 'reception', 'lab', 'admin_hospital'\]\.includes\(user\.role\)/);
});

test('les établissements du membre sont énumérés (courant + affiliations)', () => {
  const block = db.slice(db.indexOf('function setupUserScopedListeners'));
  assert.match(block, /getCurrentHospital\?\.\(\)/);
  assert.match(block, /getDoctorHospitals\?\.\(user\.uid\)/);
});

test('le listener GLOBAL mc_patients est conservé (admin) et documenté comme tel', () => {
  const block = db.slice(db.indexOf('function setupRealtimeListeners'), db.indexOf('function setupUserScopedListeners'));
  assert.match(block, /collection\('mc_patients'\)/);
  assert.match(block, /admin/i);
});

test('mc_patients déclenche un rafraîchissement de la vue patients', () => {
  assert.match(db, /mc_patients:\s*'patients'/);
});

/* ── auth.js : outbox préservée au logout ───────────── */

test('logout ne purge PLUS mc_cloud_outbox dans la liste des clés médicales', () => {
  const block = auth.slice(auth.indexOf('async function logout'), auth.indexOf('function showLogin'));
  const medicalKeys = block.slice(block.indexOf('MEDICAL_KEYS = ['), block.indexOf('];', block.indexOf('MEDICAL_KEYS = [')));
  assert.ok(!/mc_cloud_outbox/.test(medicalKeys), 'mc_cloud_outbox ne doit plus figurer dans MEDICAL_KEYS');
});

test('logout ne supprime l\'outbox que si elle est vide (outboxCount === 0)', () => {
  const block = auth.slice(auth.indexOf('async function logout'), auth.indexOf('function showLogin'));
  assert.match(block, /outboxCount\?\.\(\)/);
  assert.match(block, /=== 0\) localStorage\.removeItem\('mc_cloud_outbox'\)/);
});

/* ── auth.js : login patient sans dépendance au cache local ── */

test('_hydratePatientRecordAfterAuth existe et relit mc_patients après authentification', () => {
  assert.match(auth, /async function _hydratePatientRecordAfterAuth\(id\)/);
  const fn = auth.slice(auth.indexOf('async function _hydratePatientRecordAfterAuth'));
  assert.match(fn, /collection\('mc_patients'\)\.doc\(id\)\.get\(\)/);
});

test('_doPatient authentifie d\'abord (compte) et ne bloque plus sur « fiche introuvable »', () => {
  const fn = auth.slice(auth.indexOf('async function _doPatient'), auth.indexOf('async function _createPatientPin'));
  // Plus de message d'erreur bloquant sur la fiche avant l'authentification
  assert.ok(!/Numéro de fiche introuvable/.test(fn), 'plus de blocage « fiche introuvable » dans _doPatient');
  // La rehydratation post-auth est appelée
  assert.match(fn, /_hydratePatientRecordAfterAuth\(id\)/);
});

test('_createPatientPin ne dépend plus du cache local et gère un nom provisoire', () => {
  const fn = auth.slice(auth.indexOf('async function _createPatientPin'), auth.indexOf('async function _doProfessional'));
  // Plus de garde bloquante « return » sur l'absence de fiche locale : la
  // validité est vérifiée côté serveur (criticalOk). On vérifie qu'aucun
  // _err(...introuvable...) actif ne subsiste (la mention en commentaire est
  // tolérée) et que le nom provisoire + la rehydratation sont en place.
  assert.ok(!/_err\([^)]*introuvable/.test(fn), 'plus d\'erreur bloquante « introuvable » active dans _createPatientPin');
  assert.ok(fn.includes('patient ? `${patient.firstname} ${patient.lastname}` : id'),
    'nom provisoire = numéro de fiche si fiche absente du cache');
  assert.match(fn, /_hydratePatientRecordAfterAuth\(id\)/);
});
