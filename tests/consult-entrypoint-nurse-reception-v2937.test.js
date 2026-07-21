/* =====================================================
   Tests — Chantier v2.9.37 (retours utilisateur desktop)
   Couvre les 4 correctifs :
   ① Point d'entrée visible « + Nouvelle consultation » (choix du
      patient) sur les pages Consultations et Ordonnances — la création
      d'ordonnance passe toujours par une consultation.
   ② L'infirmière n'a plus accès à « Réception / Accueil ».
   ③ L'infirmière possède la capacité create_patient (crée la fiche).
   ④ Message pharmacie calme au timeout d'affiliation (récupérable),
      distinct d'un vrai refus.

   Modules purs (capabilities/permissions) chargés réellement ;
   hospital.js / auth.js vérifiés par analyse de source (mêmes
   dépendances DOM que nurse-doctor-flow.test.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadIntoWindow } = require('./helper');

const capWin = loadIntoWindow(['js/hospital-capabilities.js']);
const CAP = capWin.HospitalCapabilities;

const permWin = loadIntoWindow(['js/hospital-permissions.js']);
const PERM = permWin.HospitalPermissions;

const hospitalSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital.js'), 'utf8');
const authSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');

/* ── ③ Infirmière : create_patient ─────────────────── */
test('③ l\'infirmière POSSÈDE la capacité create_patient (elle crée la fiche d\'accueil)', () => {
  assert.strictEqual(CAP.can('nurse', 'create_patient'), true);
});

test('③ create_patient reste refusé aux rôles qui ne créent pas de patient (lab, pharmacist)', () => {
  assert.strictEqual(CAP.can('lab', 'create_patient'), false);
  assert.strictEqual(CAP.can('pharmacist', 'create_patient'), false);
});

test('③ l\'infirmière ne gagne AUCUN droit médical au passage (prescribe/decide_transfer/create_consultation restent refusés)', () => {
  assert.strictEqual(CAP.can('nurse', 'prescribe'), false);
  assert.strictEqual(CAP.can('nurse', 'decide_transfer'), false);
  assert.strictEqual(CAP.can('nurse', 'create_consultation'), false);
});

/* ── ② Infirmière : plus de Réception ───────────────── */
test('② la route "reception" n\'est plus accessible à l\'infirmière', () => {
  assert.strictEqual(PERM.canAccess('nurse', 'reception'), false);
});

test('② la réception reste accessible au rôle reception et à l\'admin', () => {
  assert.strictEqual(PERM.canAccess('reception', 'reception'), true);
  assert.strictEqual(PERM.canAccess('admin', 'reception'), true);
  assert.strictEqual(PERM.canAccess('admin_hospital', 'reception'), true);
});

test('② l\'infirmière conserve ses accès de soins (dashboard, patients, records, beds, lab, prescriptions)', () => {
  for (const route of ['dashboard', 'patients', 'records', 'beds', 'lab', 'prescriptions']) {
    assert.strictEqual(PERM.canAccess('nurse', route), true, `nurse doit garder l'accès à ${route}`);
  }
});

test('② le menu desktop de l\'infirmière ne contient plus "Réception / Accueil"', () => {
  const keys = PERM.visibleMenuFor('nurse').map(m => m.key);
  assert.ok(!keys.includes('reception'), 'le menu infirmière ne doit plus proposer reception');
  assert.ok(keys.includes('dashboard'), 'le menu infirmière doit toujours proposer le tableau de bord');
  assert.ok(keys.includes('patients'), 'le menu infirmière doit toujours proposer Patients');
});

/* ── ① Point d'entrée « Nouvelle consultation » ─────── */
test('① hospital.js définit openConsultPatientPicker, gardé par create_consultation', () => {
  assert.match(hospitalSrc, /function openConsultPatientPicker\(\)/);
  const start = hospitalSrc.indexOf('function openConsultPatientPicker()');
  const body = hospitalSrc.slice(start, start + 700);
  assert.match(body, /can\?\.\(Auth\.getUser\(\)\?\.role, 'create_consultation'\)/,
    'le sélecteur doit refuser un rôle sans create_consultation');
});

test('① openConsultPatientPicker ouvre bien la consultation du patient choisi (openConsult)', () => {
  const start = hospitalSrc.indexOf('function consultPickerRow(');
  const body = hospitalSrc.slice(start, start + 500);
  assert.match(body, /HospitalPortal\.openConsult\('/,
    'chaque ligne du sélecteur doit démarrer openConsult pour le patient');
});

test('① la page Consultations affiche un bouton "+ Nouvelle consultation" gardé par create_consultation', () => {
  const start = hospitalSrc.indexOf('function renderConsultations(');
  const body = hospitalSrc.slice(start, start + 1600);
  assert.match(body, /can\?\.\(Auth\.getUser\(\)\?\.role, 'create_consultation'\)/);
  assert.match(body, /HospitalPortal\.openConsultPatientPicker\(\)/);
});

test('① la page Ordonnances affiche aussi un bouton "+ Nouvelle consultation" gardé par create_consultation', () => {
  const start = hospitalSrc.indexOf('function renderPrescriptions(');
  const body = hospitalSrc.slice(start, start + 1600);
  assert.match(body, /can\?\.\(Auth\.getUser\(\)\?\.role, 'create_consultation'\)/);
  assert.match(body, /HospitalPortal\.openConsultPatientPicker\(\)/);
});

test('① openConsultPatientPicker et filterConsultPicker sont exportés par HospitalPortal', () => {
  assert.match(hospitalSrc, /openConsultPatientPicker,\s*filterConsultPicker,/);
});

/* ── ④ Message pharmacie calme au timeout ──────────── */
test('④ le message "affiliation a expiré" (alarmant) a disparu de auth.js', () => {
  assert.doesNotMatch(authSrc, /la confirmation de l'affiliation a expiré/,
    'le message alarmant ne doit plus exister');
});

test('④ le timeout est traité comme récupérable (couleur neutre --accent, pas --danger)', () => {
  const idx = authSrc.indexOf("if (affiliationReason === 'timeout')");
  assert.ok(idx !== -1, 'un branchement dédié au timeout doit exister');
  const body = authSrc.slice(idx, idx + 700);
  assert.match(body, /var\(--accent\)/, 'le timeout doit utiliser une couleur neutre, pas rouge');
  assert.match(body, /sera transmise automatiquement/, 'le message doit rassurer : envoi automatique au retour du réseau');
  assert.match(body, /compte est bien créé/i, 'le message doit confirmer que le compte est créé');
});

test('④ les vrais échecs (établissement introuvable, permission refusée) restent en rouge --danger', () => {
  const idx = authSrc.indexOf("if (affiliationReason === 'timeout')");
  const body = authSrc.slice(idx, idx + 1200);
  assert.match(body, /establishment_not_found:/);
  assert.match(body, /permission_denied:/);
  assert.match(body, /var\(--danger\)/, 'les vrais échecs gardent le rouge');
});
