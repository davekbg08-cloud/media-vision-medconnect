/* =====================================================
   Tests — scripts/encrypt-backup.mjs + workflow de sauvegarde chiffré
   (chantier "reception/affiliation sans régression", section 12/13)

   Bug confirmé (audit) : le workflow publiait l'export Firestore
   NDJSON en clair comme artefact GitHub Actions (retenu 90 jours) —
   des données patient/compte complètes restaient accessibles à
   quiconque a un accès lecture au dépôt. Corrigé par
   scripts/encrypt-backup.mjs (gpg symétrique AES256) + réduction de la
   rétention à 30 jours + manifeste public non sensible.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/encrypt-backup.mjs');
const WORKFLOW = path.resolve(REPO_ROOT, '.github/workflows/backup-firestore.yml');

function run(args, env = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test("encrypt-backup.mjs --help affiche l'usage sans rien chiffrer", () => {
  const { code, stdout } = run(['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/encrypt-backup\.mjs/);
  assert.match(stdout, /AES256/);
});

test('encrypt-backup.mjs refuse sans --in', () => {
  const { code, stderr } = run(['--out', '/tmp/x.tar.gz.gpg'], { FIRESTORE_BACKUP_ENCRYPTION_KEY: 'k' });
  assert.strictEqual(code, 1);
  assert.match(stderr, /--in.*requis/i);
});

test('encrypt-backup.mjs refuse sans --out', () => {
  const { code, stderr } = run(['--in', '/tmp'], { FIRESTORE_BACKUP_ENCRYPTION_KEY: 'k' });
  assert.strictEqual(code, 1);
  assert.match(stderr, /--out.*requis/i);
});

test("encrypt-backup.mjs refuse quand FIRESTORE_BACKUP_ENCRYPTION_KEY n'est pas définie (jamais un export non chiffré silencieux)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medconnect-encrypt-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'mc_accounts.ndjson'), JSON.stringify({ id: 'a', data: {} }) + '\n');
    const env = { ...process.env };
    delete env.FIRESTORE_BACKUP_ENCRYPTION_KEY;
    let result;
    try {
      const stdout = execFileSync('node', [SCRIPT, '--in', tmpDir, '--out', path.join(tmpDir, 'out.gpg')], { encoding: 'utf8', env });
      result = { code: 0, stdout, stderr: '' };
    } catch (e) {
      result = { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
    }
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr, /FIRESTORE_BACKUP_ENCRYPTION_KEY/);
    assert.ok(!fs.existsSync(path.join(tmpDir, 'out.gpg')), 'aucune archive ne doit être produite sans passphrase');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("encrypt-backup.mjs : round-trip réel — chiffre puis déchiffre (gpg), contenu identique", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'medconnect-encrypt-test-'));
  try {
    const docs = [{ id: 'PAT_MC-1', data: { role: 'patient', firstname: 'Test' } }];
    fs.writeFileSync(path.join(tmpDir, 'mc_accounts.ndjson'), docs.map(d => JSON.stringify(d)).join('\n') + '\n');
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify({ collections: { mc_accounts: { count: 1, ok: true } } }));

    const outPath = path.join(tmpDir, 'backup.tar.gz.gpg');
    const { code, stdout } = run(['--in', tmpDir, '--out', outPath, '--version', '9.9.9'], { FIRESTORE_BACKUP_ENCRYPTION_KEY: 'test-passphrase' });
    assert.strictEqual(code, 0, stdout);
    assert.ok(fs.existsSync(outPath), "l'archive chiffrée doit exister");
    assert.ok(fs.existsSync(`${outPath}.manifest.json`), 'le manifeste public doit exister');

    const publicManifest = JSON.parse(fs.readFileSync(`${outPath}.manifest.json`, 'utf8'));
    assert.strictEqual(publicManifest.version, '9.9.9');
    assert.strictEqual(publicManifest.collectionDocumentCount, 1);
    assert.strictEqual(publicManifest.encrypted, true);
    assert.match(publicManifest.checksumSha256, /^[0-9a-f]{64}$/);
    // Le manifeste public ne doit JAMAIS contenir de contenu patient/compte.
    const manifestStr = JSON.stringify(publicManifest);
    assert.doesNotMatch(manifestStr, /Test|patient|PAT_MC-1/);

    // Le contenu en clair ne doit JAMAIS apparaître tel quel dans
    // l'archive chiffrée (vérification best-effort, pas une preuve
    // cryptographique formelle mais détecterait un chiffrement cassé).
    const encryptedBytes = fs.readFileSync(outPath);
    assert.ok(!encryptedBytes.includes('PAT_MC-1'), "l'archive chiffrée ne doit jamais contenir l'identifiant patient en clair");

    // Déchiffrement réel (gpg) : round-trip complet.
    const decryptedTar = path.join(tmpDir, 'decrypted.tar.gz');
    execFileSync('gpg', ['--batch', '--yes', '--decrypt', '--passphrase', 'test-passphrase', '--output', decryptedTar, outPath]);
    const decryptedDir = path.join(tmpDir, 'decrypted-out');
    fs.mkdirSync(decryptedDir);
    execFileSync('tar', ['-xzf', decryptedTar, '-C', decryptedDir]);
    const restoredContent = fs.readFileSync(path.join(decryptedDir, 'mc_accounts.ndjson'), 'utf8');
    assert.match(restoredContent, /PAT_MC-1/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup-firestore.yml : chiffre désormais la sauvegarde avant publication (jamais de NDJSON en clair)', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(source, /encrypt-backup\.mjs/);
  assert.match(source, /FIRESTORE_BACKUP_ENCRYPTION_KEY/);
  assert.match(source, /rm -rf backup-output/, "l'export en clair doit être supprimé avant publication");
});

test("backup-firestore.yml : ne publie plus le dossier backup-output (NDJSON) en clair comme artefact", () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  const uploadStep = source.slice(source.indexOf('actions/upload-artifact'));
  assert.doesNotMatch(uploadStep, /path: backup-output\n/, "l'artefact ne doit plus pointer directement sur le dossier NDJSON en clair");
  assert.match(uploadStep, /backup-output\.tar\.gz\.gpg/);
});

test('backup-firestore.yml : rétention réduite de 90 à 30 jours', () => {
  const source = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(source, /retention-days: 30/);
  assert.doesNotMatch(source, /retention-days: 90/);
});
