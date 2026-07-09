/* =====================================================
   Tests — Synchronisation des collections de demandes
   Verrouille le correctif : sans ces collections dans la
   sync Firestore→local, une demande créée sur desktop
   n'apparaissait jamais sur le mobile admin.
   C'est un test de garde structurel (lecture du source).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const dbSource = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');

// Extrait le bloc `const collections = [ ... ];` de syncFromFirebase.
function syncedCollections() {
  const m = dbSource.match(/const collections = \[([\s\S]*?)\];/);
  assert.ok(m, 'le tableau collections doit exister dans db.js');
  return m[1];
}

test('affiliation_requests est synchronisé (demandes d\'affiliation)', () => {
  assert.match(syncedCollections(), /'affiliation_requests'/);
});

test('registration_requests est synchronisé (demandes de compte)', () => {
  assert.match(syncedCollections(), /'registration_requests'/);
});

test('establishments est synchronisé (inscriptions hôpital desktop)', () => {
  assert.match(syncedCollections(), /'establishments'/);
});

test('les alias miroir mc_affiliations / mc_hospitals restent synchronisés', () => {
  const c = syncedCollections();
  assert.match(c, /'mc_affiliations'/);
  assert.match(c, /'mc_hospitals'/);
});

test('ces collections sont dans la whitelist de vidage (source de vérité serveur)', () => {
  const m = dbSource.match(/EMPTY_WIPE_WHITELIST = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(m, 'EMPTY_WIPE_WHITELIST doit exister');
  const wl = m[1];
  assert.match(wl, /'registration_requests'/);
  assert.match(wl, /'affiliation_requests'/);
  assert.match(wl, /'establishments'/);
});
