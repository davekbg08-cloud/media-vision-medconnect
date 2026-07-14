/* =====================================================
   Tests — pré-contrôle d'abonnement avant tout envoi d'ordonnance
   (js/network.js sendPrescriptionToPharmacy)

   Découvert en auditant le dépôt : l'action 'send_prescription_pharmacy'
   figure dans ExchangeBridge.DESKTOP_BLOCKED_ACTIONS mais n'était
   jamais invoquée — l'envoi d'une ordonnance depuis le desktop hôpital
   n'appliquait aucun contrôle d'abonnement (ni client, ni règles sur la
   collection canonique mc_prescriptions).

   Décision produit : bloquer l'envoi sur desktop expiré pour les DEUX
   chemins — dépôt dans l'espace du patient (pharmacyUid null) ET
   dispatch vers une pharmacie précise. Le mobile n'est jamais coupé
   (hospitalCanWriteFromDevice côté règles). Le contrôle est donc unique,
   en tête de fonction, avant tout chemin d'écriture.

   sendPrescriptionToPharmacy dépend de trop d'éléments DOM/modules pour
   une exécution complète en sandbox : on verrouille ce correctif par
   lecture de source (même approche que
   tests/appointments-subscription-gate.test.js). Voir aussi
   tests/firestore-rules/mc-prescriptions-pharmacy-dispatch-gate.rules.test.js
   pour la vérification côté règles serveur.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/network.js'), 'utf8');

function dispatchBody() {
  const start = src.indexOf('async function sendPrescriptionToPharmacy(');
  assert.ok(start !== -1, 'sendPrescriptionToPharmacy doit être une fonction async');
  const end = src.indexOf('PARTIE B/H — statuts ordonnance', start);
  assert.ok(end !== -1, 'fin de sendPrescriptionToPharmacy introuvable');
  return src.slice(start, end);
}

test("le contrôle d'abonnement précède TOUT chemin d'écriture (patient et pharmacie)", () => {
  const body = dispatchBody();
  const subIdx = body.indexOf("requireWritableSubscription?.('send_prescription_pharmacy')");
  assert.ok(subIdx !== -1, "requireWritableSubscription('send_prescription_pharmacy') doit être appelé");
  // Il doit précéder les DEUX écritures : le chemin patient (early
  // return) ET le dispatch pharmacie.
  const patientPathIdx = body.indexOf("if (!target || target === 'patient')");
  const dispatchWriteIdx = body.indexOf('pharmacyUid:  pharmacist.uid');
  assert.ok(patientPathIdx !== -1 && dispatchWriteIdx !== -1, 'les deux chemins doivent exister');
  assert.ok(subIdx < patientPathIdx, "le contrôle doit précéder le chemin patient");
  assert.ok(subIdx < dispatchWriteIdx, "le contrôle doit précéder le dispatch pharmacie");
});

test("un échec du contrôle affiche un message et interrompt (return dans le catch), sans écrire", () => {
  const body = dispatchBody();
  const subIdx = body.indexOf("requireWritableSubscription?.('send_prescription_pharmacy')");
  const catchIdx = body.indexOf('} catch (e) {', subIdx);
  assert.ok(catchIdx !== -1 && catchIdx < subIdx + 200, "un catch doit suivre de près l'appel au contrôle");
  const catchBody = body.slice(catchIdx, body.indexOf('const sourceDevice', catchIdx));
  assert.match(catchBody, /App\.toast\(/, "un message d'erreur doit être affiché");
  assert.match(catchBody, /return;/, "la fonction doit s'arrêter net si l'abonnement bloque l'envoi");
});

test('les DEUX écritures posent sourceDevice courant (nécessaire pour que la règle serveur gate le bon device)', () => {
  const body = dispatchBody();
  // Une seule source de vérité : const sourceDevice = ... currentSourceDevice()
  assert.match(body, /const sourceDevice =\s*window\.ExchangeBridge\?\.currentSourceDevice/,
    'sourceDevice doit être résolu depuis ExchangeBridge.currentSourceDevice()');
  // Chemin patient : la mise à jour inclut sourceDevice.
  const patientWriteIdx = body.indexOf("pharmacyUid: null, pharmacyName: null, status: 'sent', sourceDevice");
  assert.ok(patientWriteIdx !== -1, "le chemin patient doit poser sourceDevice sur son écriture");
  // Chemin pharmacie : la mise à jour inclut sourceDevice.
  const dispatchWriteIdx = body.indexOf('pharmacyUid:  pharmacist.uid');
  const payload = body.slice(dispatchWriteIdx, body.indexOf('});', dispatchWriteIdx));
  assert.match(payload, /sourceDevice,/, 'le dispatch pharmacie doit poser sourceDevice sur son écriture');
});
