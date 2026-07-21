/* =====================================================
   Tests — classificateur de migration pharmacyType
   (chantier v2.9.34 — règle IMPÉRATIVE pharmacie)

   Vérifie que classifyPharmacyType() déduit un type FIABLE et
   DÉTERMINISTE pour les comptes pharmacien hérités (sans pharmacyType) :
   INTERNE dès qu'un rattachement à un établissement est avéré
   (establishmentId/hospitalId sur le compte, hospitalMembers actif, ou
   affiliation approuvée) ; EXTERNE sinon.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyPharmacyType, needsBackfill } = require('../scripts/migrate-pharmacy-type.mjs');

test('classifyPharmacyType : establishmentId sur le compte ⇒ interne', () => {
  assert.strictEqual(classifyPharmacyType({ establishmentId: 'HOSP-1' }), 'internal');
});

test('classifyPharmacyType : hospitalId sur le compte ⇒ interne', () => {
  assert.strictEqual(classifyPharmacyType({ hospitalId: 'HOSP-1' }), 'internal');
});

test('classifyPharmacyType : hospitalMembers actif ⇒ interne', () => {
  assert.strictEqual(classifyPharmacyType({}, { hasActiveMembership: true }), 'internal');
});

test('classifyPharmacyType : affiliation approuvée ⇒ interne', () => {
  assert.strictEqual(classifyPharmacyType({}, { hasApprovedAffiliation: true }), 'internal');
});

test('classifyPharmacyType : aucun rattachement ⇒ externe (indépendante mobile)', () => {
  assert.strictEqual(classifyPharmacyType({}, {}), 'external');
});

test('classifyPharmacyType : establishmentId vide n\'est pas un rattachement ⇒ externe', () => {
  assert.strictEqual(classifyPharmacyType({ establishmentId: '', hospitalId: '' }, {}), 'external');
});

test('classifyPharmacyType : compte nul est traité comme externe (défensif)', () => {
  assert.strictEqual(classifyPharmacyType(null, {}), 'external');
});

test('needsBackfill : vrai si pharmacyType absent/vide, faux si déjà tagué', () => {
  assert.strictEqual(needsBackfill({}), true);
  assert.strictEqual(needsBackfill({ pharmacyType: '' }), true);
  assert.strictEqual(needsBackfill({ pharmacyType: null }), true);
  assert.strictEqual(needsBackfill({ pharmacyType: 'internal' }), false);
  assert.strictEqual(needsBackfill({ pharmacyType: 'external' }), false);
});
