/* =====================================================
   Tests — admin.js suspend() vérifie le résultat de l'écriture
   critique (comme approve()/reject())

   Découvert en auditant le dépôt : contrairement à approve()/reject(),
   suspend() n'attendait ni ne vérifiait le résultat de
   pushRegistrationCloud() — un échec silencieux laissait l'admin
   croire le compte suspendu alors que users/{uid}.status (lu par
   accountStatusOk() côté règles) pouvait rester inchangé côté serveur.
   suspend() dépend de App/DB/confirm() (DOM) pour une exécution
   complète — comme pour d'autres correctifs voisins de ce dépôt, on
   verrouille donc ce correctif par lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function suspendBody() {
  const start = src.indexOf('async function suspend(');
  assert.ok(start !== -1, 'suspend doit être une fonction async (nécessaire pour await pushRegistrationCloud)');
  const end = src.indexOf('\n  function openDetail', start);
  assert.ok(end !== -1, 'fin de suspend introuvable');
  return src.slice(start, end);
}

test('suspend awaite pushRegistrationCloud et vérifie son résultat (const ok = await ...)', () => {
  const body = suspendBody();
  assert.match(body, /const ok = await pushRegistrationCloud\(/, 'le résultat de l\'écriture critique doit être vérifié, comme approve()/reject()');
});

test("suspend affiche un message d'erreur si l'écriture cloud n'est pas confirmée", () => {
  const body = suspendBody();
  const okIdx = body.indexOf('const ok = await pushRegistrationCloud(');
  const after = body.slice(okIdx, okIdx + 300);
  assert.match(after, /if\s*\(!ok\)\s*App\.toast\(/, 'un échec de confirmation cloud doit être signalé à l\'admin');
});
