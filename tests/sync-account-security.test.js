/* =====================================================
   Tests — scripts/sync-account-security.mjs

   Même limite assumée que tests/backup-restore-firestore.test.js :
   ce script nécessite firebase-admin (dépendance volontairement non
   permanente) et de vrais identifiants Firebase pour un run réel —
   non disponibles en CI. Ces tests verrouillent donc l'aide CLI, la
   validation des arguments, et le message d'erreur propre sans
   firebase-admin installé.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/sync-account-security.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('sync-account-security.mjs --help affiche l\'usage sans toucher Firebase', () => {
  const { code, stdout } = run(['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/sync-account-security\.mjs/);
  assert.match(stdout, /dry-run/i);
});

test("sync-account-security.mjs échoue proprement (message clair) quand firebase-admin n'est pas installé", () => {
  const { code, stderr } = run([]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test("sync-account-security.mjs échoue proprement en mode --apply aussi, sans firebase-admin", () => {
  const { code, stderr } = run(['--apply']);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test('sync-account-security.mjs documente les deux critères (suspended → révocation, approved/active → custom claims)', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /status === 'suspended'/);
  assert.match(source, /'approved', 'active'/);
  assert.match(source, /revokeRefreshTokens/);
  assert.match(source, /setCustomUserClaims/);
});
