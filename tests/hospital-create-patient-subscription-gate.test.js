/* =====================================================
   Tests — contrôle d'abonnement à la création de patient sur desktop
   (flux normaux gatés, intake d'URGENCE exempté)

   Décision produit : sur desktop expiré, l'enregistrement d'un nouveau
   patient est bloqué (message clair) dans les flux NORMAUX — réception
   (hospital-reception.js), maternité (hospital-maternity.js), nouveau
   patient (hospital.js) — mais l'intake d'URGENCE (hospital-emergency.js)
   n'est JAMAIS coupé : il pose emergencyIntake:true (exempté côté règles,
   isEmergencyIntake) et n'appelle aucun contrôle d'abonnement.
   Exemption volontairement PARTIELLE : seule la création du patient est
   exemptée — tout le reste (passage aux urgences, consultation,
   ordonnance...) reste soumis à l'abonnement. Fonctions DOM/async :
   lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

test("URGENCES : la création de patient pose emergencyIntake:true et n'est PAS gatée par l'abonnement", () => {
  const src = read('js/hospital-emergency.js');
  const start = src.indexOf('if (!patient) {');
  const end = src.indexOf('const caseId', start);
  const block = src.slice(start, end);
  assert.match(block, /emergencyIntake:\s*true/, "l'intake d'urgence doit poser emergencyIntake:true");
  assert.ok(!block.includes('requireWritableSubscription'),
    "l'intake d'urgence ne doit JAMAIS appeler requireWritableSubscription (le soin d'urgence n'est pas coupé)");
});

for (const [label, file, addCallMarker] of [
  // Chantier sécurité (section 4) : réception appelle désormais
  // addPatientAndConfirmAtomic() (batch atomique réellement confirmé,
  // jamais fire-and-forget) au lieu de addPatient() — voir
  // js/db.js et le rapport du chantier "reception/affiliation sans
  // régression".
  ['réception', 'js/hospital-reception.js', 'window.DB.addPatientAndConfirmAtomic('],
  ['maternité', 'js/hospital-maternity.js', 'DB?.addPatient?.('],
]) {
  test(`${label} : la création de patient vérifie requireWritableSubscription('create_patient') AVANT la création`, () => {
    const src = read(file);
    const subIdx = src.indexOf("requireWritableSubscription('create_patient')");
    const addIdx = src.indexOf(addCallMarker);
    assert.ok(subIdx !== -1, `${label} : requireWritableSubscription('create_patient') doit être appelé`);
    assert.ok(addIdx !== -1, `${label} : ${addCallMarker} doit être appelé`);
    assert.ok(subIdx < addIdx, `${label} : le contrôle d'abonnement doit précéder la création du patient`);
    // Pas de marqueur d'urgence dans un flux normal.
    assert.ok(!src.slice(subIdx, addIdx + 120).includes('emergencyIntake'),
      `${label} : un flux normal ne doit jamais poser emergencyIntake`);
  });
}

test("nouveau patient (hospital.js) : requireWritableSubscription('create_patient') AVANT addPatientAndConfirm", () => {
  const src = read('js/hospital.js');
  const start = src.indexOf('async function saveNewPatient(');
  const end = src.indexOf('DB.addPatientAndConfirm(', start);
  const block = src.slice(start, end);
  assert.match(block, /requireWritableSubscription\('create_patient'\)/,
    "saveNewPatient doit vérifier l'abonnement avant de créer le patient");
  assert.match(block, /catch/, "un échec du contrôle doit être capté (message + arrêt)");
});
