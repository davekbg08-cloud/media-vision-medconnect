/* =====================================================
   Tests — pré-contrôle d'abonnement avant création de consultation
   (js/hospital.js saveConsult)

   Découvert en auditant le dépôt : le principe "desktop bloqué en
   écriture si abonnement expiré, mobile jamais coupé" n'était jamais
   appliqué à la création de consultation/ordonnance, ni côté règles
   (voir tests/firestore-rules/subscription-device-gate.rules.test.js)
   ni côté client. saveConsult() dépend de trop d'éléments DOM/modules
   (Auth, DB, Network, HospitalCapabilities, HospitalsRegistry,
   CloudDB) pour une exécution complète en sandbox — comme pour
   tests/auth-registration.test.js et
   tests/registration-submit-flow.test.js (même dépôt, correctifs
   voisins), on verrouille donc ce correctif par lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital.js'), 'utf8');

function saveConsultBody() {
  const start = src.indexOf('async function saveConsult(');
  assert.ok(start !== -1, 'saveConsult doit être une fonction async (nécessaire pour await CloudDB.requireWritableSubscription)');
  const end = src.indexOf('\n  /* ── PARTIE E/F', start);
  assert.ok(end !== -1, 'fin de saveConsult introuvable');
  return src.slice(start, end);
}

test('saveConsult vérifie CloudDB.requireWritableSubscription AVANT toute lecture du formulaire / écriture DB', () => {
  const body = saveConsultBody();
  const subIdx = body.indexOf('CloudDB.requireWritableSubscription(');
  assert.ok(subIdx !== -1, 'requireWritableSubscription doit être appelé');
  const addConsultIdx = body.indexOf('DB.addConsultation(');
  assert.ok(addConsultIdx !== -1, 'DB.addConsultation doit toujours être appelé');
  assert.ok(subIdx < addConsultIdx, 'le contrôle d\'abonnement doit précéder la création de la consultation');
});

test("un échec de requireWritableSubscription affiche un message et n'exécute jamais la suite (return dans le catch)", () => {
  const body = saveConsultBody();
  const subIdx = body.indexOf('await CloudDB.requireWritableSubscription(');
  const catchIdx = body.indexOf('} catch (err) {', subIdx);
  assert.ok(catchIdx !== -1 && catchIdx < subIdx + 400, 'un catch doit suivre de près l\'appel à requireWritableSubscription');
  const catchBlockEnd = body.indexOf('}', catchIdx + '} catch (err) {'.length);
  const catchBody = body.slice(catchIdx, catchBlockEnd);
  assert.match(catchBody, /App\.toast\(/, 'le message d\'erreur doit être affiché à l\'utilisateur');
  assert.match(catchBody, /return;/, 'la fonction doit s\'arrêter net si l\'abonnement bloque l\'action');
});

test("l'appel guardHospitalAction('create_consultation') reste la toute première garde (rôle vérifié avant abonnement)", () => {
  const body = saveConsultBody();
  const roleGuardIdx = body.indexOf("guardHospitalAction?.('create_consultation')");
  const subIdx = body.indexOf('CloudDB.requireWritableSubscription(');
  assert.ok(roleGuardIdx !== -1 && subIdx !== -1 && roleGuardIdx < subIdx, 'le rôle doit être vérifié avant le contrôle d\'abonnement');
});
