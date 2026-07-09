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
