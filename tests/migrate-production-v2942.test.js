/* =====================================================
   Tests — Migration production v2.9.42 (chantier 9)

   Vérifie la LOGIQUE PURE de réconciliation establishmentId/hospital_id et la
   construction de l'entrée patient_directory, hors Firebase (le script ne
   touche jamais une vraie base ici). Garantit le caractère strictement additif
   et non destructif : jamais d'écrasement, jamais de conflit tranché seul.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');

let mod;
test('chargement du module de migration (ESM dynamique)', async () => {
  mod = await import('../scripts/migrate-production-v2942.mjs');
  assert.ok(mod.reconcileEstablishmentField && mod.buildDirectoryEntry && mod.parseArgs);
});

test('recopie establishmentId depuis hospital_id quand il manque', () => {
  const r = mod.reconcileEstablishmentField({ hospital_id: 'HOSP-1' });
  assert.strictEqual(r.action, 'fill_establishmentId');
  assert.deepStrictEqual(r.patch, { establishmentId: 'HOSP-1' });
});

test('recopie hospital_id depuis establishmentId quand il manque', () => {
  const r = mod.reconcileEstablishmentField({ establishmentId: 'HOSP-2' });
  assert.strictEqual(r.action, 'fill_hospital_id');
  assert.deepStrictEqual(r.patch, { hospital_id: 'HOSP-2' });
});

test('aucune écriture quand les deux champs sont présents et identiques', () => {
  const r = mod.reconcileEstablishmentField({ establishmentId: 'H', hospital_id: 'H' });
  assert.strictEqual(r.action, 'no_change');
  assert.deepStrictEqual(r.patch, {});
});

test('conflit signalé (jamais tranché) quand les deux diffèrent', () => {
  const r = mod.reconcileEstablishmentField({ establishmentId: 'A', hospital_id: 'B' });
  assert.strictEqual(r.action, 'conflict');
  assert.deepStrictEqual(r.patch, {}, 'un conflit ne produit AUCUNE écriture');
});

test('ambigu signalé quand aucun des deux champs n\'est présent', () => {
  const r = mod.reconcileEstablishmentField({ firstname: 'Jean' });
  assert.strictEqual(r.action, 'ambiguous');
  assert.deepStrictEqual(r.patch, {});
});

test('chaîne vide n\'est pas considérée comme une valeur d\'établissement', () => {
  const r = mod.reconcileEstablishmentField({ establishmentId: '', hospital_id: 'H' });
  assert.strictEqual(r.action, 'fill_establishmentId');
});

test('buildDirectoryEntry ne contient QUE de l\'identité administrative (aucun clinique)', () => {
  const entry = mod.buildDirectoryEntry({
    id: 'MC-1', firstname: 'Jean', lastname: 'Dupont', phone: '01',
    hospital_id: 'H', diagnosis: 'SECRET', medicines: ['x'], notes: 'clinique',
  });
  assert.strictEqual(entry.patientId, 'MC-1');
  assert.strictEqual(entry.establishmentId, 'H');
  assert.strictEqual(entry.hospital_id, 'H');
  // Jamais de contenu clinique.
  assert.strictEqual(entry.diagnosis, undefined);
  assert.strictEqual(entry.medicines, undefined);
  assert.strictEqual(entry.notes, undefined);
});

test('parseArgs : dry-run par défaut, drapeaux reconnus', () => {
  assert.deepStrictEqual(mod.parseArgs([]).apply, false);
  const a = mod.parseArgs(['--apply', '--i-have-a-backup', '--limit', '50', '--resume-from', 'MC-9', '--collection', 'mc_patients']);
  assert.strictEqual(a.apply, true);
  assert.strictEqual(a.backup, true);
  assert.strictEqual(a.limit, 50);
  assert.strictEqual(a.resumeFrom, 'MC-9');
  assert.strictEqual(a.collection, 'mc_patients');
});

test('ESTABLISHMENT_COLLECTIONS couvre les collections cliniques canoniques', () => {
  for (const c of ['mc_patients', 'mc_consultations', 'mc_prescriptions', 'mc_appointments', 'mc_lab_results', 'mc_admissions']) {
    assert.ok(mod.ESTABLISHMENT_COLLECTIONS.includes(c), `${c} doit être réconcilié`);
  }
});
