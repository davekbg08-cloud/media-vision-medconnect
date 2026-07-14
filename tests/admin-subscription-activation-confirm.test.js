/* =====================================================
   Tests — l'activation d'abonnement confirme la validation de
   l'établissement (js/admin.js activateSubscription)

   Signalé par le client : le bouton d'activation d'abonnement « ne
   confirme pas et garde le même statut », source de confusion.
   Diagnostic : la validation de l'établissement (status 'active') se
   faisait via updateHospital → saveHospitals (push cloud NON attendu),
   alors que les écritures subscriptions/{id} et users/{authUid} étaient
   awaitées. Si la propagation cloud de l'établissement échouait,
   l'écouteur establishments (remplacement intégral du snapshot)
   repoussait l'ancien statut 'pending' — le badge « à valider »
   persistait et l'admin croyait que rien n'avait changé. Correctif :
   l'écriture establishments/{id}.status = 'active' est désormais
   AWAITÉE et confirmée, avec un retour explicite (succès vs non
   confirmé). Fonction DOM/async : lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function activateBody() {
  const start = src.indexOf('async function activateSubscription(');
  assert.ok(start !== -1, 'activateSubscription introuvable');
  const end = src.indexOf('async function deactivateSubscription(', start);
  assert.ok(end !== -1, 'fin de activateSubscription introuvable');
  return src.slice(start, end);
}

test("la validation de l'établissement (status 'active') est AWAITÉE côté cloud (plus fire-and-forget)", () => {
  const body = activateBody();
  assert.match(body,
    /await firebaseDB\.collection\('establishments'\)\.doc\(hospitalId\)\.set\(\{ status: 'active' \}, \{ merge: true \}\)/,
    "establishments/{id}.status='active' doit être écrit et attendu (await) pour confirmer la validation");
});

test("l'issue de la confirmation est suivie (establishmentConfirmed) et distingue succès vs non confirmé", () => {
  const body = activateBody();
  assert.match(body, /let establishmentConfirmed = true;/, 'un indicateur de confirmation doit exister');
  assert.match(body, /establishmentConfirmed = false;/, "l'échec de la confirmation doit être capté");
  // Le toast final doit dépendre de cet indicateur (branche succès + branche avertissement).
  const gateIdx = body.indexOf('if (establishmentConfirmed) {');
  assert.ok(gateIdx !== -1, 'le message final doit dépendre de establishmentConfirmed');
  const tail = body.slice(gateIdx);
  assert.match(tail, /App\.toast\([^)]*✅/, 'un message de succès doit exister quand la validation est confirmée');
  assert.match(tail, /'warning'/, "un avertissement doit être affiché quand la validation n'est pas confirmée");
});
