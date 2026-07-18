/* =====================================================
   Tests — synchronisation des résultats labo desktop → patient
   (js/hospital-lab.js saveResult())

   Découvert en auditant le dépôt : un résultat de laboratoire saisi
   côté desktop hôpital (collections labRequests/labResults, notifiées
   au médecin/infirmier demandeur via resultRecipientUids) n'atteignait
   JAMAIS mc_lab_results, la seule collection lue par la vue labo du
   patient (js/lab.js renderForPatient, filtrée sur patient_id) — deux
   systèmes totalement déconnectés.

   Mise à jour (chantier "modales laboratoire", section 9) : les 3
   écritures (labRequests/labResults/mc_lab_results) se faisaient
   auparavant en 3 appels Firestore INDÉPENDANTS (CloudDB.createDoc +
   DB.addLabResult) — un échec après le premier pouvait laisser une
   demande "completed" SANS labResults/mc_lab_results. Elles sont
   désormais réunies dans un seul batch Firestore atomique
   (DB.pushBatchAndReportDetailed) : soit les trois existent, soit
   aucune n'est modifiée. Voir aussi
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

test('saveResult écrit les trois documents (labRequests, labResults, mc_lab_results) dans un seul batch atomique', () => {
  const body = saveResultBody();
  const batchIdx = body.indexOf('DB.pushBatchAndReportDetailed(');
  assert.ok(batchIdx !== -1, 'DB.pushBatchAndReportDetailed doit être utilisé (écriture atomique)');
  const batchCall = body.slice(batchIdx, body.indexOf('], {', batchIdx));
  assert.match(batchCall, /\['labRequests', requestId,/, 'le batch doit inclure labRequests');
  assert.match(batchCall, /\['labResults', resultId,/, 'le batch doit inclure labResults');
  assert.match(batchCall, /\['mc_lab_results', resultId,/, 'le batch doit inclure mc_lab_results');
  // Les 3 écritures indépendantes de l'ancienne implémentation ne
  // doivent plus exister — sinon un échec partiel redeviendrait possible.
  assert.ok(!/CloudDB\.createDoc\('labResults'/.test(body), 'labResults ne doit plus être créé hors du batch');
  assert.ok(!/DB\.addLabResult\(/.test(body), 'l\'ancien mécanisme non atomique (DB.addLabResult) ne doit plus être utilisé');
});

test('saveResult : un échec du batch (report.ok === false) empêche tout succès annoncé et referme la demande sur son ancien statut', () => {
  const body = saveResultBody();
  assert.match(body, /if \(!report\.ok\)/, 'le résultat du batch doit être vérifié avant tout message de succès');
  const guardIdx = body.indexOf('if (!report.ok)');
  const guardBlock = body.slice(guardIdx, body.indexOf('return false;', guardIdx));
  assert.match(guardBlock, /NON enregistré/, "message d'échec explicite, jamais une fausse réussite");
  // App.closeModal()/App.toast('Résultat enregistré.') ne doivent
  // apparaître qu'APRÈS la vérification de report.ok, jamais avant.
  const successIdx = body.indexOf("App.toast('Résultat enregistré.')");
  assert.ok(successIdx > guardIdx, 'le message de succès doit venir après la vérification du batch');
});

test('le miroir mc_lab_results mappe patientMc (labRequests/labResults) vers patient_id (lu par le patient)', () => {
  const body = saveResultBody();
  const mirrorIdx = body.indexOf("['mc_lab_results', resultId,");
  const mirrorCall = body.slice(mirrorIdx, body.indexOf('}],', mirrorIdx));
  assert.match(mirrorCall, /patient_id:\s*req\.patientMc/, 'patient_id doit être mappé depuis req.patientMc (même format MC-xxx que la fiche patient)');
});

test('le miroir mc_lab_results tente de résoudre patient_uid depuis le cache patient local (best-effort, sans nouvel aller-retour réseau)', () => {
  const body = saveResultBody();
  assert.match(body, /window\.DB\?\.getPatients\?\.\(\)\?\.find\(p => p\.id === req\.patientMc\)/,
    'doit réutiliser DB.getPatients() déjà chargé localement, pas un nouvel appel Firestore');
});

test('labResults inclut resultRecipientUids (demandeur + médecin responsable) — jamais seulement doctorUid', () => {
  const body = saveResultBody();
  const labResultsIdx = body.indexOf("['labResults', resultId,");
  const labResultsCall = body.slice(labResultsIdx, body.indexOf('}],', labResultsIdx));
  assert.match(labResultsCall, /resultRecipientUids/, 'resultRecipientUids doit être posé sur labResults');
});
