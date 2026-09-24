/* =====================================================
   Tests — Correctifs synchronisation / admin (v2.9.50)

   1. Libellé « Local uniquement » à tort pour l'admin connecté au cloud.
   2. Identifiants d'affiliation hérités (AFF{horodatage}) : les règles ne
      retrouvaient pas l'affiliation approuvée → auto-guérison
      hospitalMembers refusée à chaque connexion. Migration admin.
   3. Rejeu manuel d'une écriture bloquée réservé à son AUTEUR (un admin
      ne peut plus rejouer, avec ses droits, l'écriture refusée d'un
      médecin sur un poste partagé).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const db = read('js/db.js');
const settings = read('js/settings.js');
const cfg = read('js/firebase-config.js');
const reg = read('js/hospitals_registry.js');
const app = read('js/app.js');

test('la session admin restaurée depuis le cloud porte cloudSynced: true', () => {
  const i = cfg.indexOf('restoredFromCloud: true,');
  assert.ok(i > 0);
  assert.match(cfg.slice(i, i + 300), /cloudSynced: true,/);
});

// --- 3. Propriétaire de l'opération ---
function ownerFn(authUid, appUid) {
  const start = db.indexOf('  function _currentIdentity()');
  const end = db.indexOf("  /** Rejeu MANUEL d'UNE opération précise");
  const src = db.slice(start, end);
  const firebaseAuth = authUid ? { currentUser: { uid: authUid } } : null;
  const window = { Auth: { getUser: () => (appUid ? { uid: appUid } : null) } };
  // eslint-disable-next-line no-new-func
  return new Function('firebaseAuth', 'window', src + '\nreturn isOutboxEntryOwnedByCurrentUser;')(firebaseAuth, window);
}

test("rejeu manuel : l'auteur (ownerAuthUid) peut rejouer, un autre compte non", () => {
  assert.strictEqual(ownerFn('DOC1', 'DOC1')({ ownerAuthUid: 'DOC1' }), true);
  assert.strictEqual(ownerFn('ADMIN', 'admin_x')({ ownerAuthUid: 'DOC1' }), false);
  assert.strictEqual(ownerFn(null, null)({ ownerAuthUid: 'DOC1' }), false);
});

test('rejeu manuel : entrée ancienne sans ownerAuthUid → comparée à l’uid applicatif', () => {
  assert.strictEqual(ownerFn('X', 'PAT_1')({ accountUid: 'PAT_1' }), true);
  assert.strictEqual(ownerFn('X', 'admin_x')({ userUid: 'PAT_1' }), false);
  assert.strictEqual(ownerFn('X', 'admin_x')({}), true);
});

test('retryOutboxOperation et retryBlockedOutbox appliquent le contrôle d’auteur', () => {
  const one = db.slice(db.indexOf('async function retryOutboxOperation'), db.indexOf('async function retryBlockedOutbox'));
  assert.match(one, /if \(!isOutboxEntryOwnedByCurrentUser\(e\)\) return \{ ok: false, reason: 'not_owner' \};/);
  assert.ok(one.indexOf('not_owner') < one.indexOf('_replayEntry'), 'contrôle AVANT le rejeu');
  const all = db.slice(db.indexOf('async function retryBlockedOutbox'), db.indexOf('function removeOutboxOperation'));
  assert.match(all, /if \(!isOutboxEntryOwnedByCurrentUser\(e\)\) \{ skippedOtherUser\+\+; remaining\.push\(e\); continue; \}/);
  assert.match(all, /skippedOtherUser \};/);
});

test("l'inspecteur explique le refus (not_owner) et les opérations d'un autre compte ignorées", () => {
  assert.match(settings, /r\?\.reason === 'not_owner'/);
  assert.match(settings, /skippedOtherUser/);
});

// --- 2. Migration des identifiants d'affiliation ---
function loadMigration(docs, user = { role: 'admin' }) {
  const start = reg.indexOf('  let _legacyAffMigrationDone = false;');
  const end = reg.indexOf('  /* ── SOURCES DE VÉRITÉ DIRECTES');
  const src = reg.slice(start, end);
  const ops = [];
  const cloud = new Map(Object.entries(docs));
  const firebaseDB = {
    collection: (col) => ({
      get: async () => ({ docs: [...cloud].map(([id, d]) => ({ id, data: () => d })) }),
      doc: (id) => ({ col, id }),
    }),
    batch: () => {
      const pending = [];
      return {
        set: (ref, data) => pending.push(['set', ref.id, data]),
        delete: (ref) => pending.push(['delete', ref.id]),
        commit: async () => { pending.forEach(p => { ops.push(p); if (p[0] === 'set') cloud.set(p[1], p[2]); else cloud.delete(p[1]); }); },
      };
    },
  };
  const local = {};
  const env = {
    window: { Auth: { getUser: () => user } },
    firebaseDB,
    console: { info() {}, warn() {} },
    now: () => '2026-09-24T00:00:00.000Z',
    load: (k) => local[k] || [],
    store: (k, v) => { local[k] = v; },
    normalizeRequest: (r) => r,
    mergeById: (items) => items,
    REQ_KEY: 'affiliation_requests', LEGACY_REQ_KEY: 'mc_affiliations',
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(...Object.keys(env), src + '\nreturn migrateLegacyAffiliationIds;')(...Object.values(env));
  return { fn, ops, cloud };
}

test('migration : ancien ID copié vers AFF_{uid}_{étab} puis supprimé (batch)', async () => {
  const { fn, ops, cloud } = loadMigration({
    AFF1781974823303: { requesterUid: 'U1', establishmentId: 'E1', status: 'approved' },
    AFF_U2_E2: { requesterUid: 'U2', establishmentId: 'E2', status: 'approved' },
  });
  const r = await fn();
  assert.strictEqual(r.migrated, 1);
  assert.ok(cloud.has('AFF_U1_E1') && !cloud.has('AFF1781974823303'));
  assert.strictEqual(cloud.get('AFF_U1_E1').requestId, 'AFF_U1_E1');
  assert.strictEqual(cloud.get('AFF_U1_E1').migratedFromId, 'AFF1781974823303');
  assert.strictEqual(cloud.get('AFF_U1_E1').status, 'approved');
  assert.deepStrictEqual(ops.map(o => o[0] + ':' + o[1]), ['set:AFF_U1_E1', 'delete:AFF1781974823303']);
});

test('migration : ne JAMAIS écraser un document canonique existant', async () => {
  const { fn, ops } = loadMigration({
    AFF999: { requesterUid: 'U1', establishmentId: 'E1', status: 'approved' },
    AFF_U1_E1: { requesterUid: 'U1', establishmentId: 'E1', status: 'pending' },
  });
  const r = await fn();
  assert.strictEqual(r.migrated, 0);
  assert.strictEqual(r.skipped, 1);
  assert.strictEqual(ops.length, 0);
});

test('migration : réservée à l’admin plateforme', async () => {
  const { fn, ops } = loadMigration({ AFF1: { requesterUid: 'U1', establishmentId: 'E1' } }, { role: 'doctor' });
  await fn();
  assert.strictEqual(ops.length, 0);
});

test('migration lancée après la connexion admin, de façon non bloquante', () => {
  assert.match(app, /if \(user\.role === 'admin'\) \{\s*setTimeout\(\(\) => \{\s*try \{ window\.HospitalsRegistry\?\.migrateLegacyAffiliationIds\?\.\(\);/);
  assert.match(reg, /migrateLegacyAffiliationIds,/);
});
