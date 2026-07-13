/* =====================================================
   Tests — nettoyage du compte Firebase Auth orphelin si l'écriture
   users/{authUid} échoue (js/hospital-auth.js register())

   Découvert en auditant le dépôt : la création du compte Firebase
   Auth et l'écriture users/{authUid} partageaient le même try/catch —
   un échec de la seconde (règle rejetée, coupure réseau) tombait dans
   le même catch SANS nettoyer le compte Firebase Auth fraîchement
   créé, le laissant orphelin (email squatté). À la relance,
   auth/email-already-in-use affichait à tort "Un établissement existe
   déjà" alors qu'aucun établissement n'a jamais été créé — même
   famille de bug que Auth._createPatientPin
   (tests/patient-pin-migration.test.js) et Auth._reg
   (tests/auth-registration.test.js). register() dépend de nombreux
   éléments DOM/modules (App, HospitalsRegistry) — comme pour ces
   correctifs voisins, on verrouille donc ce correctif par lecture de
   source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-auth.js'), 'utf8');

function registerBody() {
  const start = src.indexOf('async function register(');
  assert.ok(start !== -1, 'register doit exister dans hospital-auth.js');
  const end = src.indexOf('// 2) Document établissement', start);
  assert.ok(end !== -1, 'fin de la partie 1) de register introuvable');
  return src.slice(start, end);
}

test("la création du compte Firebase Auth et l'écriture users/{authUid} ont chacune leur propre try/catch", () => {
  const body = registerBody();
  const catchCount = (body.match(/} catch \(/g) || []).length;
  assert.strictEqual(catchCount, 2, 'deux catch distincts sont attendus : un pour createUserWithEmailAndPassword, un pour l\'écriture users/');
});

test("un échec de l'écriture users/{authUid} supprime le compte Firebase Auth fraîchement créé", () => {
  const body = registerBody();
  const usersWriteIdx = body.indexOf("firebaseDB.collection('users').doc(authUid).set(");
  assert.ok(usersWriteIdx !== -1, "l'écriture users/{authUid} doit exister");
  const catchIdx = body.indexOf('} catch (usersErr) {', usersWriteIdx);
  assert.ok(catchIdx !== -1, 'un catch dédié doit suivre cette écriture');
  const catchBlockEnd = body.indexOf('\n          }', catchIdx);
  const catchBody = body.slice(catchIdx, catchBlockEnd);
  assert.match(catchBody, /firebaseAuth\.currentUser\?\.delete\(\)/, 'le compte Firebase Auth orphelin doit être supprimé');
  const deleteIdx = catchBody.indexOf('firebaseAuth.currentUser?.delete()');
  const before = catchBody.slice(Math.max(0, deleteIdx - 40), deleteIdx);
  assert.match(before, /try\s*\{/, 'la suppression doit être protégée par un try/catch');
});

test("l'écriture users/{authUid} ne se déclenche que si authUid est bien posé (compte réellement créé)", () => {
  const body = registerBody();
  const usersWriteIdx = body.indexOf("firebaseDB.collection('users').doc(authUid).set(");
  const before = body.slice(Math.max(0, usersWriteIdx - 200), usersWriteIdx);
  assert.match(before, /if\s*\(authUid\s*&&/, 'la garde authUid doit précéder cette écriture');
});
