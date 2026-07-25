/* =====================================================
   Tests — Listeners d'ordonnances par rôle
   Verrouille le correctif : après connexion, les médecins
   et infirmiers doivent avoir un listener mc_prescriptions
   (sinon leurs ordonnances ne se rechargent jamais). Le
   pharmacien garde son listener filtré. Test structurel
   (lecture du source de db.js).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dbSource = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');

// Isole le corps de setupUserScopedListeners.
function scopedBody() {
  const m = dbSource.match(/function setupUserScopedListeners\(\)\s*\{([\s\S]*?)\n  \}/);
  assert.ok(m, 'setupUserScopedListeners doit exister dans db.js');
  return m[1];
}

test('les ordonnances des médecins/infirmiers sont rechargées (scope établissement/created_by, chantier 1)', () => {
  const body = scopedBody();
  // Chantier 1 (v2.9.42) : le listener mc_prescriptions collection-entière
  // (rejeté par les règles) est remplacé par le rechargement query-safe des
  // rôles membres, qui inclut mc_prescriptions dans CLINICAL_COLLECTIONS.
  assert.match(body, /\['doctor', 'nurse', 'reception', 'lab', 'admin_hospital'\]\.includes\(user\.role\)/,
    'la branche des rôles membres (dont doctor/nurse) doit être présente');
  assert.match(body, /'mc_prescriptions'/,
    'mc_prescriptions doit faire partie des collections rechargées');
});

test('le pharmacien garde son listener mc_prescriptions filtré par pharmacyUid', () => {
  const body = scopedBody();
  assert.match(body, /role === 'pharmacist'/);
  const pharmaBranch = body.slice(body.indexOf("role === 'pharmacist'"));
  assert.match(pharmaBranch, /pharmacyUid/,
    'le pharmacien doit filtrer sur pharmacyUid');
});

test('la fusion utilise mergeStore (pas d\'écrasement du local)', () => {
  const body = scopedBody();
  assert.match(body, /mergeStore\(key, idField/,
    'les listeners scoped doivent fusionner via mergeStore');
});

test('le rafraîchissement de vue est branché (App.refreshIfCurrent)', () => {
  assert.match(dbSource, /refreshIfCurrent/,
    'db.js doit demander un rafraîchissement de vue après fusion');
  const appSource = fs.readFileSync(path.resolve(__dirname, '..', 'js/app.js'), 'utf8');
  assert.match(appSource, /function refreshIfCurrent/,
    'App.refreshIfCurrent doit exister');
});
