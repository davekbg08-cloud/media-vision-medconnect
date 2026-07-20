/* =====================================================
   Tests — scripts/backfill-patient-directory.mjs
   (audit "workflows mobile/desktop", section 7)

   Même limite assumée que tests/sync-account-security.test.js : ce
   script nécessite firebase-admin (dépendance volontairement non
   permanente) et de vrais identifiants Firebase pour un run réel —
   non disponibles en CI. Ces tests verrouillent l'aide CLI, le message
   d'erreur propre sans firebase-admin installé, et le comportement PUR
   de buildDirectoryEntry() (importable sans firebase-admin).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/backfill-patient-directory.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('backfill-patient-directory.mjs --help affiche l\'usage sans toucher Firebase', () => {
  const { code, stdout } = run(['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/backfill-patient-directory\.mjs/);
  assert.match(stdout, /dry-run/i);
});

test("backfill-patient-directory.mjs échoue proprement (message clair) quand firebase-admin n'est pas installé", () => {
  const { code, stderr } = run([]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test("backfill-patient-directory.mjs échoue proprement en mode --apply aussi, sans firebase-admin", () => {
  const { code, stderr } = run(['--apply']);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test('backfill-patient-directory.mjs : le mode dry-run est le défaut (pas de flag = pas de --apply)', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /apply: false/);
  assert.match(source, /if \(arg === '--apply'\) out\.apply = true;/);
});

test('backfill-patient-directory.mjs : une écriture réelle est toujours gardée par args.apply', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const writeIdx = source.indexOf(".collection('patient_directory').doc(patient.id).set(entry)");
  assert.ok(writeIdx !== -1, "l'écriture patient_directory doit exister");
  const before = source.slice(Math.max(0, writeIdx - 200), writeIdx);
  assert.match(before, /if \(!args\.apply\)/, "l'écriture réelle doit être précédée d'un garde dry-run");
});

test('backfill-patient-directory.mjs : ne réécrit jamais un document patient_directory déjà existant', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /existingIds\.has\(patient\.id\)/);
  assert.match(source, /skippedExisting\+\+/);
});

test('backfill-patient-directory.mjs : signale (sans écrire) les fiches ambiguës (id ou nom absent)', () => {
  const fs = require('fs');
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /flaggedAmbiguous\+\+/);
  assert.match(source, /traitement manuel/);
});

/* ── buildDirectoryEntry() : fonction pure, importable sans firebase-admin ── */
const { buildDirectoryEntry } = require('../scripts/backfill-patient-directory.mjs');

test('buildDirectoryEntry() ne produit jamais de champ clinique, même si la fiche source en contient', () => {
  const entry = buildDirectoryEntry({
    id: 'MC-2026-CD-TEST1', firstname: 'Jean', lastname: 'Kalala',
    dob: '1990-05-01', gender: 'M', phone: '+243800000000',
    establishmentId: 'HOSP-1',
    allergies: 'Pénicilline', chronic: 'Diabète', treatment: 'Insuline',
  });
  const keys = Object.keys(entry).sort();
  assert.deepStrictEqual(keys, [
    'administrativeStatus', 'createdAt', 'dob', 'establishmentId', 'firstname',
    'gender', 'hospital_id', 'lastname', 'patientId', 'phone', 'updatedAt',
  ]);
  assert.ok(!('allergies' in entry));
  assert.ok(!('chronic' in entry));
  assert.ok(!('treatment' in entry));
  assert.strictEqual(entry.patientId, 'MC-2026-CD-TEST1');
});

test('buildDirectoryEntry() retombe sur birthdate/hospital_id historiques quand dob/establishmentId sont absents', () => {
  const entry = buildDirectoryEntry({ id: 'MC-2026-CD-TEST2', birthdate: '1985-03-03', hospital_id: 'HOSP-2' });
  assert.strictEqual(entry.dob, '1985-03-03');
  assert.strictEqual(entry.establishmentId, 'HOSP-2');
});
