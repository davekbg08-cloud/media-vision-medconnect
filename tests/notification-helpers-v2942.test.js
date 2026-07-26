/* =====================================================
   Tests — helpers purs du système de notifications (Phase 2, v2.9.42)

   Logique sans Firebase (functions/notification-helpers.js) : idempotence de
   l'identifiant, deep link sûr (anti open-redirect), payload push expurgé,
   liste de champs stricte des préférences.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../functions/notification-helpers');

test('la deduplicationKey combine type+source+doc+destinataire+version', () => {
  const k = H.makeDeduplicationKey({
    eventType: 'lab_result', sourceCollection: 'mc_lab_results',
    sourceDocumentId: 'L1', recipientUid: 'U1', eventVersion: 2,
  });
  assert.strictEqual(k, 'lab_result|mc_lab_results|L1|U1|2');
});

test('l\'identifiant de notification est DÉTERMINISTE (idempotence)', () => {
  const k = 'lab_result|mc_lab_results|L1|U1|0';
  const a = H.notificationIdFromDedup(k);
  const b = H.notificationIdFromDedup(k);
  assert.strictEqual(a, b, 'même clé → même id (pas de doublon au rejeu)');
  assert.match(a, /^ntf_[0-9a-f]{32}$/);
  // Une clé différente → un id différent.
  assert.notStrictEqual(a, H.notificationIdFromDedup('lab_result|mc_lab_results|L1|U2|0'));
});

test('le deep link est TOUJOURS interne et pointe d\'abord vers la notification', () => {
  const dl = H.buildSafeDeepLink('lab_result', 'lab_result', 'ntf_abc');
  assert.strictEqual(dl.primary, '/notifications/ntf_abc');
  assert.strictEqual(dl.category, '/lab');
  // Jamais une URL absolue, même si le type est inconnu.
  const dl2 = H.buildSafeDeepLink('inconnu', 'inconnu', 'ntf_x');
  assert.strictEqual(dl2.primary, '/notifications/ntf_x');
  assert.strictEqual(dl2.category, null);
  assert.ok(!/^https?:/.test(dl.primary) && !/^https?:/.test(dl2.primary), 'jamais d\'URL absolue');
});

test('le payload push est EXPURGÉ (jamais de contenu médical ni safePreview)', () => {
  const notif = {
    notificationId: 'ntf_abc', category: 'lab_result', priority: 'high',
    deepLink: { primary: '/notifications/ntf_abc' },
    // Champs qui NE DOIVENT PAS fuiter :
    titleKey: 'x', bodyKey: 'y', safePreview: 'z', recipientUid: 'U1',
    sourceDocumentId: 'L1', diagnosis: 'SECRET',
  };
  const p = H.sanitizePushPayload(notif);
  assert.deepStrictEqual(Object.keys(p).sort(), ['category', 'deepLink', 'notificationId', 'priority']);
  assert.strictEqual(p.diagnosis, undefined);
  assert.strictEqual(p.safePreview, undefined);
  assert.strictEqual(p.recipientUid, undefined);
  assert.strictEqual(p.titleKey, undefined);
  assert.ok(!JSON.stringify(p).includes('SECRET'));
});

test('normalizePreferences n\'écrit que les champs autorisés', () => {
  const prefs = H.normalizePreferences({
    enabled: true, language: 'fr', soundEnabled: false,
    channels: { labResults: true, messages: false, INCONNU: true },
    // champs interdits ignorés :
    uid: 'PIRATE', isAdmin: true, arbitraire: 42,
  });
  assert.strictEqual(prefs.enabled, true);
  assert.strictEqual(prefs.language, 'fr');
  assert.strictEqual(prefs.soundEnabled, false);
  assert.strictEqual(prefs.channels.labResults, true);
  assert.strictEqual(prefs.channels.messages, false);
  assert.strictEqual(prefs.channels.INCONNU, undefined, 'canal inconnu ignoré');
  assert.strictEqual(prefs.uid, undefined, 'uid jamais écrit via les préférences');
  assert.strictEqual(prefs.isAdmin, undefined);
  assert.strictEqual(prefs.arbitraire, undefined);
});

test('les fournisseurs reconnus couvrent tous les canaux d\'envoi prévus', () => {
  for (const p of ['fcm_android_native', 'fcm_web', 'webpush_ios', 'webpush_safari', 'electron_running']) {
    assert.ok(H.VALID_PROVIDERS.includes(p), `${p} doit être un fournisseur reconnu`);
  }
});
