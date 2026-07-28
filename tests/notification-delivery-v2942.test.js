/* =====================================================
   Tests — livraison de notifications (Phase 4, v2.9.42)

   Décisions pures (classification d'erreur, backoff, transition d'état,
   obsolescence) + garde-fous structurels du module de file/cron :
   jamais de faux « delivered », `queued` tant qu'aucun fournisseur, le cron
   ne supprime jamais.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../functions/notification-delivery-helpers');

test('classifyProviderError : 404/410/not-registered = permanent ; reste = temporaire', () => {
  for (const code of ['410', '404', 'not-registered', 'messaging/registration-token-not-registered']) {
    assert.strictEqual(D.classifyProviderError(code), 'permanent', code);
  }
  for (const code of ['unavailable', 'internal', 'quota-exceeded', null, undefined]) {
    assert.strictEqual(D.classifyProviderError(code), 'temporary', String(code));
  }
});

test('computeRetry : backoff exponentiel borné, s\'arrête à MAX_ATTEMPTS', () => {
  assert.deepStrictEqual(D.computeRetry(0), { shouldRetry: true, delaySeconds: 30 });
  assert.deepStrictEqual(D.computeRetry(1), { shouldRetry: true, delaySeconds: 60 });
  assert.deepStrictEqual(D.computeRetry(2), { shouldRetry: true, delaySeconds: 120 });
  // Plafond.
  assert.ok(D.computeRetry(20).shouldRetry === false, 'au-delà de MAX_ATTEMPTS : plus de retry');
  assert.strictEqual(D.computeRetry(D.MAX_ATTEMPTS).shouldRetry, false);
});

test('nextDeliveryState : succès = sent_to_provider (jamais delivered)', () => {
  const r = D.nextDeliveryState({ ok: true }, 0);
  assert.strictEqual(r.state, 'sent_to_provider');
  assert.strictEqual(r.shouldRetry, false);
});

test('nextDeliveryState : erreur permanente → failed_permanent + invalidation', () => {
  const r = D.nextDeliveryState({ ok: false, code: '410' }, 0);
  assert.strictEqual(r.state, 'failed_permanent');
  assert.strictEqual(r.invalidate, true);
  assert.strictEqual(r.shouldRetry, false);
});

test('nextDeliveryState : erreur temporaire → retry, puis abandon à MAX_ATTEMPTS', () => {
  const early = D.nextDeliveryState({ ok: false, code: 'unavailable' }, 1);
  assert.strictEqual(early.state, 'failed_temporary');
  assert.strictEqual(early.shouldRetry, true);
  const late = D.nextDeliveryState({ ok: false, code: 'unavailable' }, D.MAX_ATTEMPTS);
  assert.strictEqual(late.state, 'failed_permanent');
  assert.strictEqual(late.shouldRetry, false);
});

test('aucune transition ne produit jamais l\'état « delivered »', () => {
  const states = [
    D.nextDeliveryState({ ok: true }, 0).state,
    D.nextDeliveryState({ ok: false, code: '410' }, 0).state,
    D.nextDeliveryState({ ok: false, code: 'unavailable' }, 1).state,
  ];
  assert.ok(!states.includes('delivered'));
});

test('isStaleRegistration : trop d\'échecs OU trop ancien = obsolète', () => {
  const now = Date.now();
  assert.strictEqual(D.isStaleRegistration({ consecutiveFailures: 10 }, now), true);
  assert.strictEqual(D.isStaleRegistration({ consecutiveFailures: 2, lastSeenAt: now - 300 * 86400000 }, now), true);
  assert.strictEqual(D.isStaleRegistration({ consecutiveFailures: 2, lastSeenAt: now - 5 * 86400000 }, now), false);
  // Jamais vu : on ne devine pas.
  assert.strictEqual(D.isStaleRegistration({ consecutiveFailures: 0 }, now), false);
});

/* ── garde-fous structurels du module de file/cron ── */
const mod = fs.readFileSync(path.resolve(__dirname, '..', 'functions/notification-delivery.js'), 'utf8');

test('la tâche de livraison a un retryConfig et laisse `queued` sans fournisseur', () => {
  assert.match(mod, /onTaskDispatched/);
  assert.match(mod, /retryConfig:\s*\{[^}]*maxAttempts/);
  assert.match(mod, /deferred/, 'gère le cas fournisseur non configuré');
  assert.match(mod, /state:\s*'queued'/);
  assert.ok(!/state:\s*'delivered'/.test(mod), 'jamais delivered');
});

test('le cron de nettoyage désactive mais ne supprime jamais', () => {
  assert.match(mod, /cleanupStalePushRegistrations/);
  assert.match(mod, /onSchedule/);
  assert.match(mod, /enabled:\s*false/, 'désactive');
  assert.ok(!/\.delete\(\)/.test(mod), 'ne supprime jamais un document');
  assert.match(mod, /scanned=.*disabled=/, 'métriques agrégées uniquement');
});
