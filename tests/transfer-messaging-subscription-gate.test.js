/* =====================================================
   Tests — pré-contrôle d'abonnement avant messagerie pro→pro
   (js/transfer_ui_patch.js sendMessage())

   Découvert en auditant le dépôt : "✉️ Nouveau message" (boîte de
   réception, accessible depuis le desktop hôpital) permettait
   d'envoyer un message à un collègue sans AUCUN contrôle
   d'abonnement/plateforme — voir
   tests/firestore-rules/mc-messages-subscription-gate.rules.test.js
   pour la vérification côté règles. sendMessage() dépend de trop
   d'éléments DOM/modules (App, DB, Network, TransferService, CloudDB)
   pour une exécution complète en sandbox — comme pour
   tests/appointments-subscription-gate.test.js (même dépôt,
   correctif voisin), on verrouille donc ce correctif par lecture de
   source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/transfer_ui_patch.js'), 'utf8');

function sendMessageBody() {
  const start = src.indexOf('async function sendMessage(');
  assert.ok(start !== -1, 'sendMessage doit être une fonction async (nécessaire pour await CloudDB.requireWritableSubscription)');
  const end = src.indexOf('\n  function applyPatch', start);
  assert.ok(end !== -1, 'fin de sendMessage introuvable');
  return src.slice(start, end);
}

test('sendMessage ne soumet au contrôle abonnement que le trafic pro→pro (ni expéditeur ni destinataire patient)', () => {
  const body = sendMessageBody();
  assert.match(body, /senderRole\s*!==\s*'patient'\s*&&\s*role\s*!==\s*'patient'/,
    'la condition doit exclure tout message impliquant un patient, jamais bloqué');
});

test('sendMessage vérifie CloudDB.requireWritableSubscription AVANT toute création de transfert/notification', () => {
  const body = sendMessageBody();
  const subIdx = body.indexOf("CloudDB?.requireWritableSubscription?.(");
  assert.ok(subIdx !== -1, 'requireWritableSubscription doit être appelé');
  const transferIdx = body.indexOf('TransferService.transferObject(');
  const notifyIdx = body.indexOf('Network.notify(');
  assert.ok(transferIdx !== -1 && notifyIdx !== -1, 'les deux chemins d\'envoi doivent rester présents');
  assert.ok(subIdx < transferIdx && subIdx < notifyIdx,
    'le contrôle d\'abonnement doit précéder tout envoi de message');
});

test("un échec de requireWritableSubscription affiche un message et n'exécute jamais l'envoi (return dans le catch)", () => {
  const body = sendMessageBody();
  const subIdx = body.indexOf('await window.CloudDB?.requireWritableSubscription?.(');
  assert.ok(subIdx !== -1, 'l\'appel doit être awaité');
  const catchIdx = body.indexOf('} catch (err) {', subIdx);
  assert.ok(catchIdx !== -1 && catchIdx < subIdx + 300, 'un catch doit suivre de près l\'appel à requireWritableSubscription');
  const catchBlockEnd = body.indexOf('}', catchIdx + '} catch (err) {'.length);
  const catchBody = body.slice(catchIdx, catchBlockEnd);
  assert.match(catchBody, /App\.toast\(/, 'le message d\'erreur doit être affiché à l\'utilisateur');
  assert.match(catchBody, /return;/, 'la fonction doit s\'arrêter net si l\'abonnement bloque l\'action');
});

test("l'action type dépend de la priorité : 'send_message_urgent' si urgent, 'send_message_professional' sinon", () => {
  const body = sendMessageBody();
  assert.match(body, /priority === 'urgent' \? 'send_message_urgent' : 'send_message_professional'/);
});

test('hospitalId est résolu via CloudDB.getActiveHospitalId() et transmis à TransferService/Network.notify', () => {
  const body = sendMessageBody();
  assert.match(body, /CloudDB\?\.getActiveHospitalId\?\.\(\)/);
  assert.match(body, /metadata:\s*\{\s*source:\s*'network_compose',\s*hospitalId\s*\}/);
  assert.match(body, /Network\.notify\(\{[\s\S]*?hospitalId,?[\s\S]*?\}\)/);
});
