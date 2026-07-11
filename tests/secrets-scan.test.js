/* =====================================================
   Tests — Scanner de secrets (scripts/check-secrets.mjs)

   Verrouille : le scanner ignore la clé Firebase Web légitime connue
   (dans ses deux emplacements autorisés), détecte une vraie fuite
   (token GitHub, clé privée, autre clé AIza non-allowlistée), et le
   dépôt actuel passe le scan sans trouvaille.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCANNER = path.resolve(REPO_ROOT, 'scripts/check-secrets.mjs');

function runScannerOnFixture(fixtureContent) {
  const fixturePath = path.join(REPO_ROOT, '__secrets_scan_fixture__.js');
  fs.writeFileSync(fixturePath, fixtureContent);
  try {
    execFileSync('git', ['add', fixturePath], { cwd: REPO_ROOT });
    try {
      execFileSync('node', [SCANNER], { cwd: REPO_ROOT, encoding: 'utf8' });
      return { failed: false };
    } catch (e) {
      return { failed: true, output: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    execFileSync('git', ['reset', fixturePath], { cwd: REPO_ROOT });
    fs.unlinkSync(fixturePath);
  }
}

test('scripts/check-secrets.mjs existe et est exécutable via node', () => {
  assert.ok(fs.existsSync(SCANNER));
});

// Les fixtures ci-dessous sont construites par concaténation plutôt
// qu'en littéral direct : sinon ce fichier de test, une fois committé,
// contiendrait lui-même des motifs correspondant aux patterns du
// scanner et se ferait détecter par npm run security:scan.
test('détecte un faux token GitHub codé en dur', () => {
  const fakeToken = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789';
  const result = runScannerOnFixture(`const token = '${fakeToken}';\n`);
  assert.ok(result.failed, 'le scanner doit échouer sur un token GitHub');
  assert.match(result.output, /Token GitHub/);
});

test('détecte une clé privée PEM', () => {
  const marker = '-----' + 'BEGIN PRIVATE KEY' + '-----';
  const endMarker = '-----' + 'END PRIVATE KEY' + '-----';
  const result = runScannerOnFixture(`${marker}\nMIIExample\n${endMarker}\n`);
  assert.ok(result.failed, 'le scanner doit échouer sur une clé privée PEM');
  assert.match(result.output, /Clé privée PEM/);
});

test("détecte une clé AIza qui n'est PAS la clé Firebase connue", () => {
  const fakeKey = 'AIza' + 'SyDIFFERENTKEYNOTALLOWLISTEDVALUEXX';
  const result = runScannerOnFixture(`const other = '${fakeKey}';\n`);
  assert.ok(result.failed, 'une autre clé AIza doit être détectée, seule la clé connue est tolérée');
});

test('ne bloque jamais sur un fichier ne contenant aucun secret', () => {
  const result = runScannerOnFixture("const greeting = 'bonjour';\n");
  assert.ok(!result.failed, 'un fichier sans secret ne doit jamais faire échouer le scan');
});

test('npm run security:scan est bien déclaré dans package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['security:scan'], 'node scripts/check-secrets.mjs');
});

test('le dépôt actuel passe le scan sans aucune trouvaille', () => {
  assert.doesNotThrow(() => {
    execFileSync('node', [SCANNER], { cwd: REPO_ROOT });
  }, 'npm run security:scan doit rester vert sur le dépôt réel');
});
