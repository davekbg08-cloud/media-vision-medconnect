/* =====================================================
   Tests — Inscription laboratoire / réception (auth.js _reg)

   Bug corrigé : _reg() vérifiait TOUJOURS lab/reception avec
   ACL.isNurseVerified(num), un registre qui ne contient jamais
   leurs numéros → inscription bloquée à 100% pour ces deux rôles.
   _reg() n'est pas exportée par Auth (fonction interne appelée par
   _regLab/_regReception, qui lisent des champs DOM) : on verrouille
   donc le correctif par lecture de source, comme tests/sync.test.js
   le fait déjà pour un autre correctif structurel de ce type.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');

// Isole le corps de _reg() pour ne pas se faire piéger par un autre
// appel à ACL.isNurseVerified ailleurs dans le fichier.
function regBody() {
  const start = src.indexOf('async function _reg(');
  assert.ok(start !== -1, '_reg doit exister dans auth.js');
  const end = src.indexOf('\n  async function _regDoctor', start);
  assert.ok(end !== -1, 'fin de _reg introuvable');
  return src.slice(start, end);
}

test('lab et reception ne sont plus vérifiés via ACL.isNurseVerified()', () => {
  const body = regBody();
  assert.match(body, /role === 'lab' \|\| role === 'reception'/, '_reg doit traiter lab/reception explicitement');
  // La ligne qui appelle isNurseVerified doit être dans la branche
  // 'nurse' uniquement, jamais dans un repli générique (ternaire
  // "sinon") qui engloberait aussi lab/reception.
  const nurseVerifiedCalls = body.match(/ACL\.isNurseVerified\(num\)/g) || [];
  assert.strictEqual(nurseVerifiedCalls.length, 1, 'isNurseVerified ne doit être appelé qu\'une fois, pour le rôle nurse');
  const idx = body.indexOf('ACL.isNurseVerified(num)');
  const before = body.slice(Math.max(0, idx - 120), idx);
  assert.match(before, /role === 'nurse'/, 'le seul appel à isNurseVerified doit être dans la branche role === \'nurse\'');
});

test('lab et reception sont acceptés sans blocage registre (verified = true, pas de recherche dans le registre infirmier)', () => {
  const body = regBody();
  const idx = body.indexOf("role === 'lab' || role === 'reception'");
  const branch = body.slice(idx, idx + 200);
  assert.match(branch, /verified\s*=\s*true/, 'lab/reception doivent être acceptés sans vérification de registre');
  assert.doesNotMatch(branch, /getVerifiedNurses|getVerifiedDoctors|getVerifiedPharmacists/, 'aucun registre existant ne doit être consulté pour lab/reception');
});

test('_regLab et _regReception existent et appellent _reg avec le bon rôle', () => {
  assert.match(src, /_reg\(num, pass, pass2, 'lab',/, '_regLab doit appeler _reg avec role="lab"');
  assert.match(src, /_reg\(num, pass, pass2, 'reception',/, '_regReception doit appeler _reg avec role="reception"');
});

test('les comptes créés par _reg restent status=pending et sont poussés vers users/mc_accounts', () => {
  const body = regBody();
  assert.match(body, /status:\s*'pending'/, 'le compte créé doit être en attente de validation admin');
  assert.match(body, /createRegistrationRequest/, 'une demande d\'inscription (registration_requests) doit être créée');
  assert.match(body, /\['mc_accounts', finalAccount\.uid, finalAccount\]/, 'écriture critique vers mc_accounts');
  assert.match(body, /\['users', finalAccount\.uid, finalAccount\]/, 'écriture vers users');
});

/* =====================================================
   Correctif (audit) : compte Firebase Auth orphelin si l'écriture
   critique échoue après création — même famille que
   Auth._createPatientPin (tests/patient-pin-migration.test.js) et
   registration-submit-flow.js submitRegistration
   (tests/registration-submit-flow.test.js), mais _reg() (labo/
   réception) ne l'avait jamais eu.
   ===================================================== */
test("_reg supprime le compte Firebase Auth si la synchronisation cloud critique échoue (finalAccount.authUid présent)", () => {
  const body = regBody();
  const criticalOkIdx = body.indexOf('const criticalOk =');
  assert.ok(criticalOkIdx !== -1, 'criticalOk doit être calculé');
  const ifIdx = body.indexOf('if (!criticalOk) {', criticalOkIdx);
  assert.ok(ifIdx !== -1, 'un bloc if (!criticalOk) doit suivre');
  const ifBlockEnd = body.indexOf('\n    }', ifIdx);
  const ifBody = body.slice(ifIdx, ifBlockEnd);
  assert.match(ifBody, /if\s*\(finalAccount\.authUid\)/, 'le nettoyage ne doit se déclencher que si un NOUVEAU compte a été créé (authUid posé)');
  assert.match(ifBody, /firebaseAuth\.currentUser\?\.delete\(\)/, 'le compte Firebase Auth orphelin doit être supprimé');
  const deleteIdx = ifBody.indexOf('firebaseAuth.currentUser?.delete()');
  const before = ifBody.slice(Math.max(0, deleteIdx - 40), deleteIdx);
  assert.match(before, /try\s*\{/, 'la suppression doit être protégée par un try/catch, ne jamais faire planter le message d\'erreur réel');
});

test("_reg n'essaie de nettoyer que si finalAccount.authUid est posé (pas le cas auth/email-already-in-use, qui ne modifie pas authUid)", () => {
  const body = regBody();
  const createIdx = body.indexOf('const finalAccount = await _createFirebaseUser(');
  assert.ok(createIdx !== -1);
  // _createFirebaseUser (fonction voisine) ne pose authUid que sur un
  // succès de création réelle — sur auth/email-already-in-use, elle
  // retourne le compte sans modification (pas de authUid ajouté).
  const fnStart = src.indexOf('async function _createFirebaseUser(');
  const fnEnd = src.indexOf('\n  async function _reg(', fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  assert.match(fnBody, /email-already-in-use/);
  const branchIdx = fnBody.indexOf('email-already-in-use');
  const branchEnd = fnBody.indexOf('return', branchIdx);
  const returnLine = fnBody.slice(branchEnd, fnBody.indexOf('\n', branchEnd));
  assert.doesNotMatch(returnLine, /authUid/, 'le repli auth/email-already-in-use ne doit jamais poser authUid — sinon le nettoyage supprimerait un compte préexistant d\'un tiers');
});
