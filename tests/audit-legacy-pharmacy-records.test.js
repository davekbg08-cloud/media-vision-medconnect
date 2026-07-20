/* =====================================================
   Tests — scripts/audit-legacy-pharmacy-records.mjs
   (audit "workflows mobile/desktop", section 19)

   Même limite assumée que tests/backfill-patient-directory.test.js : ce
   script nécessite firebase-admin (dépendance volontairement non
   permanente) et de vrais identifiants Firebase pour un run réel — non
   disponibles en CI. Ces tests verrouillent l'aide CLI, le message
   d'erreur propre sans firebase-admin installé, le comportement PUR de
   isOrphan() (importable sans firebase-admin), et — par lecture de
   source — la règle centrale du script : ne JAMAIS deviner
   l'attribution d'un document orphelin quand plusieurs pharmaciens
   existent (aucune écriture possible dans ce cas, même avec --apply).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.resolve(REPO_ROOT, 'scripts/audit-legacy-pharmacy-records.mjs');

function run(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('audit-legacy-pharmacy-records.mjs --help affiche l\'usage sans toucher Firebase', () => {
  const { code, stdout } = run(['--help']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Usage: node scripts\/audit-legacy-pharmacy-records\.mjs/);
  assert.match(stdout, /dry-run/i);
  assert.match(stdout, /un seul pharmacien/i);
});

test("audit-legacy-pharmacy-records.mjs échoue proprement (message clair) quand firebase-admin n'est pas installé", () => {
  const { code, stderr } = run([]);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test("audit-legacy-pharmacy-records.mjs échoue proprement en mode --apply aussi, sans firebase-admin", () => {
  const { code, stderr } = run(['--apply']);
  assert.strictEqual(code, 1);
  assert.match(stderr, /firebase-admin introuvable/i);
});

test('audit-legacy-pharmacy-records.mjs : le mode dry-run est le défaut (pas de flag = pas de --apply)', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /apply: false/);
  assert.match(source, /if \(arg === '--apply'\) out\.apply = true;/);
});

test("audit-legacy-pharmacy-records.mjs : n'écrit JAMAIS pharmacyUid quand plusieurs pharmaciens actifs existent, même avec --apply", () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const branchIdx = source.indexOf('if (pharmacists.length !== 1)');
  assert.ok(branchIdx !== -1, 'le script doit distinguer explicitement le cas "plusieurs pharmaciens"');
  const branchEnd = source.indexOf('\n  }', branchIdx);
  const branchBody = source.slice(branchIdx, branchEnd);
  assert.doesNotMatch(branchBody, /\.update\(/, 'aucune écriture ne doit avoir lieu dans la branche ambiguë');
  assert.match(branchBody, /réconciliation MANUELLE|traitement manuel|réconciliation manuelle/i);
});

test('audit-legacy-pharmacy-records.mjs : une écriture réelle (update pharmacyUid) est toujours gardée par args.apply', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const writeIdx = source.indexOf(".update({ pharmacyUid: owner.uid })");
  assert.ok(writeIdx !== -1, "l'écriture pharmacyUid doit exister");
  const before = source.slice(0, writeIdx);
  assert.match(before, /if \(!args\.apply\)\s*\{[\s\S]*?return;[\s\S]*?\}/, "l'écriture réelle doit être précédée d'un garde dry-run (return avant la boucle d'écriture)");
});

test('audit-legacy-pharmacy-records.mjs : ne propose une attribution automatique QUE si pharmacists.length === 1', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const ownerIdx = source.indexOf('const owner = pharmacists[0];');
  assert.ok(ownerIdx !== -1);
  // La ligne juste avant doit être le "return" de la branche ambiguë,
  // jamais atteinte si pharmacists.length !== 1.
  const before = source.slice(Math.max(0, ownerIdx - 30), ownerIdx);
  assert.match(before, /return;/);
});

test("audit-legacy-pharmacy-records.mjs : signale qu'aucun document orphelin ne nécessite plus le repli legacy quand totalOrphans === 0", () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /totalOrphans === 0/);
  assert.match(source, /pharmacyOwnsOrLegacy.*peut être retiré/);
});

/* ── isOrphan() : fonction pure, importable sans firebase-admin ── */
const { isOrphan } = require('../scripts/audit-legacy-pharmacy-records.mjs');

test('isOrphan() : un document sans pharmacyUid (absent, null, ou vide) est considéré orphelin', () => {
  assert.strictEqual(isOrphan({}), true);
  assert.strictEqual(isOrphan({ pharmacyUid: null }), true);
  assert.strictEqual(isOrphan({ pharmacyUid: '' }), true);
});

test('isOrphan() : un document avec un pharmacyUid non vide n\'est jamais orphelin', () => {
  assert.strictEqual(isOrphan({ pharmacyUid: 'pharm-1' }), false);
});
