/* =====================================================
   Tests — synchronisation des résultats labo desktop → patient
   (js/hospital-lab.js saveResult())

   Découvert en auditant le dépôt : un résultat de laboratoire saisi
   côté desktop hôpital (collections labRequests/labResults, notifiées
   uniquement au médecin demandeur via listener doctorUid) n'atteignait
   JAMAIS mc_lab_results, la seule collection lue par la vue labo du
   patient (js/lab.js renderForPatient, filtrée sur patient_id) — deux
   systèmes totalement déconnectés. Voir aussi
   tests/firestore-rules/mc-lab-results-write.rules.test.js pour la
   vérification côté règles. saveResult() dépend de trop d'éléments
   DOM/modules (App, DB, CloudDB, HospitalCapabilities,
   HospitalDesktopUI) pour une exécution complète en sandbox — comme
   pour tests/hospital-consult-subscription-gate.test.js (même dépôt,
   correctif voisin), on verrouille donc ce correctif par lecture de
   source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-lab.js'), 'utf8');

function saveResultBody() {
  const start = src.indexOf('async function saveResult(');
  assert.ok(start !== -1, 'saveResult doit exister dans hospital-lab.js');
  const end = src.indexOf('\n  return { render,', start);
  assert.ok(end !== -1, 'fin de saveResult introuvable');
  return src.slice(start, end);
}

test('saveResult écrit le miroir mc_lab_results APRÈS la création de labResults', () => {
  const body = saveResultBody();
  const labResultsIdx = body.indexOf("CloudDB.createDoc('labResults'");
  assert.ok(labResultsIdx !== -1, 'labResults doit toujours être créé');
  const mirrorIdx = body.indexOf('DB.addLabResult(');
  assert.ok(mirrorIdx !== -1, 'DB.addLabResult doit être appelé pour le miroir patient');
  assert.ok(labResultsIdx < mirrorIdx, 'le miroir doit être écrit après labResults');
});

test('le miroir mappe patientMc (labRequests/labResults) vers patient_id (mc_lab_results, lu par le patient)', () => {
  const body = saveResultBody();
  const mirrorIdx = body.indexOf('DB.addLabResult(');
  const mirrorCall = body.slice(mirrorIdx, body.indexOf(');', mirrorIdx));
  assert.match(mirrorCall, /patient_id:\s*req\.patientMc/, 'patient_id doit être mappé depuis req.patientMc (même format MC-xxx que la fiche patient)');
});

test('le miroir tente de résoudre patient_uid depuis le cache patient local (best-effort, sans nouvel aller-retour réseau)', () => {
  const body = saveResultBody();
  assert.match(body, /window\.DB\.getPatients\?\.\(\)\.find\(p => p\.id === req\.patientMc\)/,
    'doit réutiliser DB.getPatients() déjà chargé localement, pas un nouvel appel Firestore');
  const mirrorIdx = body.indexOf('DB.addLabResult(');
  const mirrorCall = body.slice(mirrorIdx, body.indexOf(');', mirrorIdx));
  assert.match(mirrorCall, /patient_uid:\s*patient\?\.patient_uid \|\| patient\?\.patientAuthUid/);
});
