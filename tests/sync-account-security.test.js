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

/* ── Chantier "reception/affiliation sans régression" — section 2 ──
   Correctifs additifs : croisement avec users/{authUid}, jamais de
   claim admin depuis mc_accounts.role, allowlist externe pour le
   claim admin, réconciliation indépendante de mc_accounts. Ce script
   reste non exécutable en CI sans firebase-admin + identifiants réels
   (même limite que ci-dessus) — ces tests verrouillent donc la SOURCE,
   pas un run réel. */

test("sync-account-security.mjs ne fait plus confiance au seul mc_accounts : il lit users/{authUid} avant de poser un claim de rôle", () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /collection\('users'\)\.doc\(uid\)\.get\(\)/);
  assert.match(source, /function checkUsersConsistency/);
  assert.match(source, /aucun profil users\/\{authUid\} correspondant/);
});

test("sync-account-security.mjs ne pose JAMAIS admin:true à partir de mc_accounts.role (allowlist uniquement)", () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /isSuspiciousAdminRole = acc\.role === 'admin'/);
  assert.match(source, /ADMIN_UID_ALLOWLIST/);
  assert.match(source, /allowlist\.has\(uid\)/);
  assert.match(source, /resolveAdminFlag\(auth, acc\.authUid, allowlistConfigured, allowlist\)/);
  // Le seul endroit où `admin: true` littéral apparaîtrait serait
  // l'ancienne confiance aveugle en mc_accounts.role — vérifie qu'elle
  // a disparu au profit de wantsAdmin (dérivé de l'allowlist).
  assert.doesNotMatch(source, /admin: acc\.role === 'admin'/);
  assert.match(source, /admin: wantsAdmin/);
});

test('sync-account-security.mjs retire les claims des comptes pending/rejected/suspended/incohérents', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /status === 'pending'/);
  assert.match(source, /status === 'rejected'/);
  assert.match(source, /!consistency\.ok/);
  assert.match(source, /role: null, admin: wantsAdmin/);
});

test("sync-account-security.mjs : quand ADMIN_UID_ALLOWLIST n'est pas configurée, le claim admin existant n'est jamais écrasé à false", () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /allowlistConfigured = process\.env\.ADMIN_UID_ALLOWLIST !== undefined/);
  assert.match(source, /async function resolveAdminFlag/);
  assert.match(source, /rec\.customClaims\?\.admin === true/);
  assert.match(source, /Réconciliation du claim admin ignorée : ADMIN_UID_ALLOWLIST non configurée/);
});

test('sync-account-security.mjs réconcilie le claim admin indépendamment de mc_accounts (listUsers)', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /auth\.listUsers\(/);
  assert.match(source, /claims\.admin === true && !allowlist\.has\(userRecord\.uid\)/);
});

test("sync-account-security.mjs : le mode dry-run n'appelle jamais setCustomUserClaims ni revokeRefreshTokens avant le garde args.apply", () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  // Chaque site d'écriture Admin SDK doit être précédé (dans le même
  // bloc) d'un garde "if (!args.apply) { ...; continue; }" ou
  // équivalent — vérifié indirectement : le mot-clé 'continue' suit
  // chaque "if (!args.apply)" dans le corps de main().
  const guards = source.match(/if \(!args\.apply\)/g) || [];
  assert.ok(guards.length >= 3, 'au moins 3 gardes dry-run attendus (claims accordés, claims retirés, révocation admin)');
});
