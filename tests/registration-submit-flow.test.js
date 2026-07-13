/* =====================================================
   Tests — nettoyage du compte Firebase Auth orphelin
   (js/registration-submit-flow.js submitRegistration)

   Même famille que le correctif patient (Auth._createPatientPin,
   tests/patient-pin-migration.test.js) : createUserWithEmailAndPassword
   crée un vrai compte Firebase Auth AVANT l'écriture Firestore
   (writeRegistrationToFirestore, batch.commit — sans file de réessai
   ici, contrairement à Auth._reg). Si cette écriture échoue après
   coup, le compte restait orphelin indéfiniment, verrouillant le
   candidat (auth/email-already-in-use lors d'une nouvelle tentative,
   alors qu'aucune demande n'existe réellement côté serveur).

   js/registration-submit-flow.js patche Auth._registerRole et dépend
   de nombreux éléments DOM (renderStatusScreen, setSubmitting...) —
   comme pour tests/auth-registration.test.js (même fichier, correctif
   voisin), on verrouille ce correctif par lecture de source plutôt que
   par exécution complète, pattern déjà établi dans ce dépôt pour cette
   zone du code.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/registration-submit-flow.js'), 'utf8');

function submitRegistrationBody() {
  const start = src.indexOf('async function submitRegistration(');
  assert.ok(start !== -1, 'submitRegistration doit exister');
  const end = src.indexOf('\n  // Conserve l\'implémentation d\'origine', start);
  assert.ok(end !== -1, 'fin de submitRegistration introuvable');
  return src.slice(start, end);
}

test("credential est déclaré hors du try, visible dans le catch englobant", () => {
  const body = submitRegistrationBody();
  const tryIdx = body.indexOf('try {');
  const credentialDeclIdx = body.indexOf('let credential;');
  assert.ok(credentialDeclIdx !== -1, 'let credential; doit exister');
  assert.ok(credentialDeclIdx < tryIdx, 'credential doit être déclaré AVANT le try englobant, pas à l\'intérieur (sinon invisible dans le catch)');
});

test("le catch englobant supprime le compte Firebase Auth orphelin (credential.user.delete())", () => {
  const body = submitRegistrationBody();
  // Dernier bloc catch (...) { ... } avant le finally.
  const catchIdx = body.lastIndexOf('} catch (err) {');
  assert.ok(catchIdx !== -1, 'un catch englobant doit exister');
  const finallyIdx = body.indexOf('} finally {', catchIdx);
  const catchBody = body.slice(catchIdx, finallyIdx === -1 ? undefined : finallyIdx);
  assert.match(catchBody, /credential\?\.user/, 'le catch doit vérifier la présence du compte Firebase Auth créé');
  assert.match(catchBody, /credential\.user\.delete\(\)/, 'le catch doit supprimer le compte Firebase Auth orphelin');
  // Le nettoyage doit être protégé (ne doit jamais lui-même faire
  // planter l'affichage du message d'erreur réel).
  const deleteIdx = catchBody.indexOf('credential.user.delete()');
  const before = catchBody.slice(Math.max(0, deleteIdx - 40), deleteIdx);
  assert.match(before, /try\s*\{/, 'la suppression doit être protégée par un try/catch');
});

test("le nettoyage ne masque jamais le message d'erreur réel affiché à l'utilisateur", () => {
  const body = submitRegistrationBody();
  const catchIdx = body.lastIndexOf('} catch (err) {');
  const finallyIdx = body.indexOf('} finally {', catchIdx);
  const catchBody = body.slice(catchIdx, finallyIdx === -1 ? undefined : finallyIdx);
  assert.match(catchBody, /showError\(`❌ Impossible d.envoyer la demande/, 'le message d\'erreur réel doit toujours être affiché après le nettoyage');
});
