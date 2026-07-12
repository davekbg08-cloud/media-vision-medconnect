/* =====================================================
   Tests — scripts/backup-firestore.mjs et scripts/restore-firestore.mjs

   Ces scripts nécessitent firebase-admin (dépendance volontairement
   non permanente, cf. scripts/migrate-*.mjs) et de vraies identifiants
   Firebase pour un export/import réel — non disponibles en CI. Ces
   tests verrouillent donc ce qui est testable sans ça : l'aide CLI,
   la validation des arguments, la liste des collections sauvegardées,
   et le mode --dry-run de la restauration (qui ne touche jamais
   Firestore ni ne requiert firebase-admin).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKUP_SCRIPT = path.resolve(REPO_ROOT, 'scripts/backup-firestore.mjs');
const RESTORE_SCRIPT = path.resolve(REPO_ROOT, 'scripts/restore-firestore.mjs');

function run(script, args) {
  try {
    const stdout = execFileSync('node', [script, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('backup-firestore.mjs --help affiche l\'usage sans toucher Firestore', () => {
  const { code, stdout } = run(BACKUP_SCRIPT, ['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/backup-firestore\.mjs/);
});

test('backup-firestore.mjs liste des collections applicatives connues (mc_accounts, mc_patients, auditLogs, ...)', () => {
  const source = fs.readFileSync(BACKUP_SCRIPT, 'utf8');
  for (const expected of ['mc_accounts', 'mc_patients', 'mc_consultations', 'mc_prescriptions', 'auditLogs', 'hospitalMembers', 'mc_consents']) {
    assert.ok(source.includes(`'${expected}'`), `BACKUP_COLLECTIONS doit inclure ${expected}`);
  }
});

test("backup-firestore.mjs échoue proprement (message clair) quand firebase-admin n'est pas installé", () => {
  const { code, stderr } = run(BACKUP_SCRIPT, []);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test('restore-firestore.mjs --help affiche l\'usage sans toucher Firestore', () => {
  const { code, stdout } = run(RESTORE_SCRIPT, ['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/restore-firestore\.mjs/);
});

test('restore-firestore.mjs refuse sans --from', () => {
  const { code, stderr } = run(RESTORE_SCRIPT, []);
  assert.strictEqual(code, 1);
  assert.match(stderr, /--from.*requis/i);
});

test('restore-firestore.mjs refuse un dossier --from inexistant', () => {
  const { code, stderr } = run(RESTORE_SCRIPT, ['--from', '/tmp/ce-dossier-nexiste-pas-medconnect']);
  assert.strictEqual(code, 1);
  assert.match(stderr, /introuvable/i);
});

test('restore-firestore.mjs : mode dry-run (par défaut) compte les documents sans toucher Firestore ni requérir firebase-admin', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medconnect-restore-test-'));
  try {
    const docs = [
      { id: 'PAT_MC-1', data: { role: 'patient' } },
      { id: 'PAT_MC-2', data: { role: 'patient' } },
    ];
    fs.writeFileSync(path.join(tmpDir, 'mc_accounts.ndjson'), docs.map(d => JSON.stringify(d)).join('\n') + '\n');

    const { code, stdout } = run(RESTORE_SCRIPT, ['--from', tmpDir]);
    assert.strictEqual(code, 0);
    assert.match(stdout, /dry-run/i);
    assert.match(stdout, /mc_accounts.*2 document/i);
    assert.match(stdout, /2 document\(s\) sur 1 collection\(s\)/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('restore-firestore.mjs : --collections restreint aux fichiers sélectionnés', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medconnect-restore-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'mc_accounts.ndjson'), JSON.stringify({ id: 'a', data: {} }) + '\n');
    fs.writeFileSync(path.join(tmpDir, 'auditLogs.ndjson'), JSON.stringify({ id: 'b', data: {} }) + '\n');

    const { code, stdout } = run(RESTORE_SCRIPT, ['--from', tmpDir, '--collections', 'mc_accounts']);
    assert.strictEqual(code, 0);
    assert.match(stdout, /mc_accounts/);
    assert.doesNotMatch(stdout, /auditLogs/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
