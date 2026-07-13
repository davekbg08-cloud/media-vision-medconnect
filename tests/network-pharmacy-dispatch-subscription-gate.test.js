/* =====================================================
   Tests — pré-contrôle d'abonnement avant dispatch d'une ordonnance
   vers une pharmacie précise (js/network.js sendPrescriptionToPharmacy)

   Découvert en auditant le dépôt : l'action 'send_prescription_pharmacy'
   figure dans ExchangeBridge.DESKTOP_BLOCKED_ACTIONS mais n'était
   jamais invoquée — l'envoi d'une ordonnance vers une pharmacie précise
   depuis le desktop hôpital n'appliquait aucun contrôle d'abonnement
   (ni client, ni règles sur la collection canonique mc_prescriptions).
   Décision produit : bloquer ce dispatch sur desktop expiré, MAIS
   laisser le chemin "patient" toujours ouvert (le patient récupère son
   ordonnance dans son espace et la présente où il veut — le soin n'est
   jamais coupé). sendPrescriptionToPharmacy dépend de trop d'éléments
   DOM/modules pour une exécution complète en sandbox : on verrouille
   donc ce correctif par lecture de source (même approche que
   tests/appointments-subscription-gate.test.js).

   Voir aussi tests/firestore-rules/mc-prescriptions-pharmacy-dispatch-gate.rules.test.js
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

// Le bloc du chemin "patient" (early return) — doit rester exempt de
// tout contrôle d'abonnement.
function patientPathBlock(body) {
  const start = body.indexOf("if (!target || target === 'patient')");
  assert.ok(start !== -1, 'bloc du chemin patient introuvable');
  // Jusqu'au commentaire "Pharmacie précise".
  const end = body.indexOf('Pharmacie précise', start);
  assert.ok(end !== -1, 'fin du bloc patient introuvable');
  return body.slice(start, end);
}

test("le dispatch vers une pharmacie précise vérifie requireWritableSubscription AVANT l'écriture", () => {
  const body = dispatchBody();
  const subIdx = body.indexOf("requireWritableSubscription?.('send_prescription_pharmacy')");
  assert.ok(subIdx !== -1, "requireWritableSubscription('send_prescription_pharmacy') doit être appelé");
  // L'écriture de dispatch = updatePrescriptionAndConfirm avec pharmacyUid: pharmacist.uid
  const dispatchWriteIdx = body.indexOf('pharmacyUid:  pharmacist.uid');
  assert.ok(dispatchWriteIdx !== -1, 'le dispatch doit écrire pharmacyUid: pharmacist.uid');
  assert.ok(subIdx < dispatchWriteIdx, "le contrôle d'abonnement doit précéder l'écriture du dispatch");
});

test("un échec du contrôle affiche un message et interrompt (return dans le catch), sans écrire", () => {
  const body = dispatchBody();
  const subIdx = body.indexOf("requireWritableSubscription?.('send_prescription_pharmacy')");
  const catchIdx = body.indexOf('} catch (e) {', subIdx);
  assert.ok(catchIdx !== -1 && catchIdx < subIdx + 200, "un catch doit suivre de près l'appel au contrôle");
  const catchBody = body.slice(catchIdx, body.indexOf('const result', catchIdx));
  assert.match(catchBody, /App\.toast\(/, "un message d'erreur doit être affiché");
  assert.match(catchBody, /return;/, "la fonction doit s'arrêter net si l'abonnement bloque le dispatch");
});

test('le dispatch pose sourceDevice courant (nécessaire pour que la règle serveur gate le bon device)', () => {
  const body = dispatchBody();
  const dispatchWriteIdx = body.indexOf('pharmacyUid:  pharmacist.uid');
  const payload = body.slice(dispatchWriteIdx, body.indexOf('});', dispatchWriteIdx));
  assert.match(payload, /sourceDevice:\s*window\.ExchangeBridge\?\.currentSourceDevice/,
    'le payload du dispatch doit poser sourceDevice depuis ExchangeBridge.currentSourceDevice()');
});

test("le chemin 'patient' n'est JAMAIS soumis au contrôle d'abonnement (soin jamais coupé)", () => {
  const body = dispatchBody();
  const patientBlock = patientPathBlock(body);
  assert.ok(patientBlock.includes("pharmacyUid: null"), 'le chemin patient écrit bien pharmacyUid: null');
  assert.ok(!patientBlock.includes('requireWritableSubscription'),
    "le chemin patient ne doit contenir aucun contrôle d'abonnement");
});
