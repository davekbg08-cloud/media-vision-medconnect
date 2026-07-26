/* =====================================================
   Tests — Fournisseurs push + préférences (Phase 5, v2.9.42)

   Helpers purs (préférences, heures silencieuses, canaux) testés directement ;
   garde-fous structurels du fournisseur d'envoi et de la mise en file (payload
   data-only sans clinique, erreurs 404/410 → permanentes, préférences
   respectées mais notification interne jamais bloquée).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('../functions/notification-helpers');

/* ── Préférences / canaux ───────────────────────────── */
test('shouldSendExternal : une alerte de sécurité/critique passe TOUJOURS', () => {
  assert.strictEqual(H.shouldSendExternal({ enabled: false }, 'security', 'normal'), true);
  assert.strictEqual(H.shouldSendExternal({ enabled: false }, 'lab_result', 'critical'), true);
});

test('shouldSendExternal : préférences globales et par canal respectées', () => {
  assert.strictEqual(H.shouldSendExternal({ enabled: false }, 'lab_result', 'normal'), false);
  assert.strictEqual(H.shouldSendExternal({ channels: { labResults: false } }, 'lab_result', 'normal'), false);
  assert.strictEqual(H.shouldSendExternal({ channels: { labResults: true } }, 'lab_result', 'normal'), true);
  // Défaut (pas de préférences) : autorisé.
  assert.strictEqual(H.shouldSendExternal(null, 'appointment', 'normal'), true);
});

test('isInQuietHours : intervalle simple et traversant minuit', () => {
  const at = (h, m) => new Date(2026, 6, 26, h, m);
  assert.strictEqual(H.isInQuietHours(at(23, 0), { start: '22:00', end: '07:00' }), true);
  assert.strictEqual(H.isInQuietHours(at(3, 0), { start: '22:00', end: '07:00' }), true);
  assert.strictEqual(H.isInQuietHours(at(12, 0), { start: '22:00', end: '07:00' }), false);
  assert.strictEqual(H.isInQuietHours(at(13, 0), { start: '12:00', end: '14:00' }), true);
  assert.strictEqual(H.isInQuietHours(at(15, 0), { start: '12:00', end: '14:00' }), false);
  // Absence de config → jamais silencieux.
  assert.strictEqual(H.isInQuietHours(at(3, 0), null), false);
});

test('shouldSendExternal : heures silencieuses suppriment le push non critique', () => {
  const night = new Date(2026, 6, 26, 2, 0);
  assert.strictEqual(H.shouldSendExternal({ quietHours: { start: '22:00', end: '07:00' } }, 'appointment', 'normal', night), false);
  // …mais pas une alerte critique.
  assert.strictEqual(H.shouldSendExternal({ quietHours: { start: '22:00', end: '07:00' } }, 'appointment', 'critical', night), true);
});

/* ── Fournisseur d'envoi (structurel) ───────────────── */
const prov = fs.readFileSync(path.resolve(__dirname, '..', 'functions/notification-providers.js'), 'utf8');

test('le message FCM est data-only et ne contient aucun champ médical', () => {
  // Pas de bloc `notification:` (titre/corps non contrôlés) ; uniquement data.
  assert.match(prov, /function buildDataMessage/);
  const body = prov.slice(prov.indexOf('function buildDataMessage'), prov.indexOf('function normalizeFcmError'));
  assert.match(body, /data:\s*\{/);
  assert.ok(!/notification:\s*\{/.test(body), 'jamais de bloc notification (titre/corps)');
  for (const forbidden of ['diagnosis', 'safePreview', 'patient', 'titleKey', 'bodyKey', 'medicines']) {
    assert.ok(!body.includes(forbidden), `le payload ne contient pas ${forbidden}`);
  }
});

test('Web Push : souscription absente ou 404/410 → code permanent (invalidation)', () => {
  assert.match(prov, /return \{ ok: false, code: '410' \}/, 'souscription absente → 410 (permanent)');
  assert.match(prov, /statusCode \|\| e\.status/, 'le statut HTTP du fournisseur est propagé');
});

test('Electron n\'émet pas de push serveur (écoute Firestore locale)', () => {
  assert.match(prov, /electron_running/);
  assert.match(prov, /deferred: true, code: 'electron_local_listener'/);
});

/* ── Mise en file (structurel) ──────────────────────── */
const notif = fs.readFileSync(path.resolve(__dirname, '..', 'functions/notifications.js'), 'utf8');

test('scheduleDelivery respecte les préférences mais ne bloque jamais la notification interne', () => {
  assert.match(notif, /async function scheduleDelivery/);
  assert.match(notif, /shouldSendExternal\(prefs, category, priority/);
  assert.match(notif, /where\('enabled', '==', true\)/, 'seuls les appareils actifs');
  assert.match(notif, /taskQueue\('deliverNotificationTask'\)/, 'une tâche par appareil');
  // La notification est créée AVANT scheduleDelivery (interne inconditionnelle).
  assert.ok(notif.indexOf('tx.set(ref, {') < notif.indexOf('scheduleDelivery(db'));
});
