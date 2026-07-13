/* =====================================================
   Tests — pré-contrôle d'abonnement avant création de rendez-vous
   (js/appointments.js save())

   Découvert en auditant le dépôt : le principe "desktop bloqué en
   écriture si abonnement expiré, mobile jamais coupé" n'était jamais
   appliqué à la création de rendez-vous, ni côté client ni (en
   pratique) côté règles — voir
   tests/firestore-rules/mc-appointments-create.rules.test.js et
   tests/appointment-source-device.test.js. save() dépend de trop
   d'éléments DOM/modules (App, DB, Network, CloudDB) pour une
   exécution complète en sandbox — comme pour
   tests/hospital-consult-subscription-gate.test.js (même dépôt,
   correctif voisin), on verrouille donc ce correctif par lecture de
   source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/appointments.js'), 'utf8');

function saveBody() {
  const start = src.indexOf('async function save(');
  assert.ok(start !== -1, 'save doit être une fonction async (nécessaire pour await CloudDB.requireWritableSubscription)');
  const end = src.indexOf('\n  function setStatus', start);
  assert.ok(end !== -1, 'fin de save introuvable');
  return src.slice(start, end);
}

test('save vérifie CloudDB.requireWritableSubscription AVANT toute écriture DB', () => {
  const body = saveBody();
  const subIdx = body.indexOf('CloudDB.requireWritableSubscription(');
  assert.ok(subIdx !== -1, 'requireWritableSubscription doit être appelé');
  const addAptIdx = body.indexOf('DB.addAppointment(');
  assert.ok(addAptIdx !== -1, 'DB.addAppointment doit toujours être appelé');
  assert.ok(subIdx < addAptIdx, "le contrôle d'abonnement doit précéder la création du rendez-vous");
});

test("un échec de requireWritableSubscription affiche un message et n'exécute jamais la suite (return dans le catch)", () => {
  const body = saveBody();
  const subIdx = body.indexOf('await CloudDB.requireWritableSubscription(');
  const catchIdx = body.indexOf('} catch (err) {', subIdx);
  assert.ok(catchIdx !== -1 && catchIdx < subIdx + 400, "un catch doit suivre de près l'appel à requireWritableSubscription");
  const catchBlockEnd = body.indexOf('}', catchIdx + '} catch (err) {'.length);
  const catchBody = body.slice(catchIdx, catchBlockEnd);
  assert.match(catchBody, /App\.toast\(/, "le message d'erreur doit être affiché à l'utilisateur");
  assert.match(catchBody, /return;/, "la fonction doit s'arrêter net si l'abonnement bloque l'action");
});

test("l'action type transmis est bien 'create_appointment' (celui déjà reconnu par ExchangeBridge.DESKTOP_BLOCKED_ACTIONS)", () => {
  const body = saveBody();
  assert.match(body, /CloudDB\.requireWritableSubscription\('create_appointment'\)/);
});
