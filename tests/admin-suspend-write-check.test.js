/* =====================================================
   Tests — admin.js suspend() vérifie le résultat de l'écriture
   critique (comme approve()/reject())

   Découvert en auditant le dépôt : contrairement à approve()/reject(),
   suspend() n'attendait ni ne vérifiait le résultat de
   pushRegistrationCloud() — un échec silencieux laissait l'admin
   croire le compte suspendu alors que users/{uid}.status (lu par
   accountStatusOk() côté règles) pouvait rester inchangé côté serveur.

   Chantier lab/reception (section 14) : suspend() a été renforcée avec
   un verrou anti-double-clic, un état visuel de bouton, un délai
   maximal (pushRegistrationCloudDetailed, avec timeout) et ne mute
   plus le cache local avant confirmation. suspend() dépend de App/DB/
   confirm() (DOM) pour une exécution complète — comme pour d'autres
   correctifs voisins de ce dépôt, on verrouille donc ce correctif par
   lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function suspendBody() {
  const start = src.indexOf('async function suspend(');
  assert.ok(start !== -1, 'suspend doit être une fonction async (nécessaire pour await la confirmation cloud)');
  const end = src.indexOf('\n  function openDetail', start);
  assert.ok(end !== -1, 'fin de suspend introuvable');
  return src.slice(start, end);
}

test('suspend awaite pushRegistrationCloudDetailed et vérifie son résultat', () => {
  const body = suspendBody();
  assert.match(body, /const result = await pushRegistrationCloudDetailed\(/, 'le résultat détaillé de l\'écriture critique doit être vérifié, comme approve()/reject()');
});

test("suspend affiche un message d'erreur si l'écriture cloud n'est pas confirmée, sans muter le cache local avant", () => {
  const body = suspendBody();
  const okIdx = body.indexOf('const result = await pushRegistrationCloudDetailed(');
  const after = body.slice(okIdx, okIdx + 400);
  assert.match(after, /if\s*\(!result\.ok\)\s*\{/, 'un échec de confirmation cloud doit être signalé à l\'admin');
  assert.match(after, /App\.toast\(.*error.*\)/s, 'un message d\'erreur doit être affiché en cas d\'échec');
  // Le cache local (DB.saveAccounts) ne doit être mis à jour qu'APRÈS
  // le contrôle result.ok — jamais avant, sous peine de faux succès local.
  const saveIdx = body.indexOf('DB.saveAccounts(accounts)');
  assert.ok(saveIdx > okIdx, 'DB.saveAccounts doit intervenir après la vérification du résultat cloud');
});

test('suspend pose un verrou anti-double-clic via _lockActionButton avant le premier await', () => {
  const body = suspendBody();
  assert.match(body, /_lockActionButton\(event,/, 'suspend doit verrouiller le bouton dès le clic');
  assert.match(body, /if\s*\(btn === 'locked'\)\s*return;/, 'un second clic pendant le traitement doit être ignoré');
});

test('suspend restaure le bouton dans un bloc finally', () => {
  const body = suspendBody();
  assert.match(body, /finally\s*\{\s*_unlockActionButton\(btn\);/, 'le bouton doit être réactivé dans un finally, succès ou échec');
});
