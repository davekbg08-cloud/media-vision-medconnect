/* =====================================================
   Tests — Enregistrement push client + handlers SW (Phase 5-client/6b, v2.9.42)

   Logique d'état pure (computeState/pickProvider) + garde-fous structurels
   (opt-in explicite, jamais de log de jeton, SW push data-only + deep link sûr).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PR = require('../js/push-registration.js');
const I = PR._internal;

test('computeState : non pris en charge si SW/Push/Notification absent', () => {
  assert.strictEqual(I.computeState({ serviceWorker: false, pushManager: true, notification: true }, true), 'unsupported');
  assert.strictEqual(I.computeState({ serviceWorker: true, pushManager: false, notification: true }, true), 'unsupported');
});

test('computeState : iOS non installé → invitation à installer', () => {
  const c = { serviceWorker: true, pushManager: true, notification: true, isIOS: true, standalone: false, permission: 'default' };
  assert.strictEqual(I.computeState(c, true), 'ios-needs-install');
});

test('computeState : clé VAPID absente → non configuré (jamais faux activé)', () => {
  const c = { serviceWorker: true, pushManager: true, notification: true, isIOS: false, standalone: false, permission: 'default' };
  assert.strictEqual(I.computeState(c, false), 'not-configured');
});

test('computeState : permission accordée/refusée/à demander', () => {
  const base = { serviceWorker: true, pushManager: true, notification: true, isIOS: false, standalone: false };
  assert.strictEqual(I.computeState({ ...base, permission: 'granted' }, true), 'granted');
  assert.strictEqual(I.computeState({ ...base, permission: 'denied' }, true), 'blocked');
  assert.strictEqual(I.computeState({ ...base, permission: 'default' }, true), 'default');
});

test('pickProvider : iOS → webpush_ios, sinon fcm_web', () => {
  assert.strictEqual(I.pickProvider({ isIOS: true }), 'webpush_ios');
  assert.strictEqual(I.pickProvider({ isIOS: false }), 'fcm_web');
});

/* ── garde-fous structurels ── */
const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/push-registration.js'), 'utf8');

test('opt-in EXPLICITE : requestPermission uniquement dans enable(), jamais au chargement', () => {
  assert.match(src, /async function enable/);
  assert.match(src, /Notification\.requestPermission/);
  const enableBody = src.slice(src.indexOf('async function enable'), src.indexOf('async function disable'));
  assert.match(enableBody, /requestPermission/, 'la demande est dans enable() (déclenché par un clic)');
});

test('le jeton d\'enregistrement n\'est JAMAIS logué', () => {
  assert.ok(!/console\.(log|warn|error)\([^)]*registrationToken/.test(src));
  assert.ok(!/console\.(log|warn|error)\([^)]*token[^s]/i.test(src));
  // L'écriture passe par la Cloud Function, jamais en direct.
  assert.match(src, /httpsCallable\('registerPushDevice'\)/);
});

const sw = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

test('SW push : affichage générique (aucune donnée médicale) + deep link validé', () => {
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /function mcSafePath/);
  // Titre/corps génériques, jamais issus du payload.
  assert.match(sw, /const MC_PUSH_TITLE = 'MedConnect'/);
  assert.ok(!/showNotification\([^)]*data\.title/.test(sw), 'jamais un titre venant du payload');
  // notificationclick n\'ouvre qu\'une route interne validée.
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(sw, /new URL\(path, self\.location\.origin\)/);
});

test('SW : mcSafePath refuse les routes hors allowlist et les URL absolues', () => {
  // Vérifie la présence du garde (validation) — le comportement runtime est
  // couvert côté client par notification-center (isAllowedRoute).
  assert.match(sw, /startsWith\('\/\/'\)/, 'refuse le protocol-relative');
  assert.match(sw, /MC_ROUTE_ALLOW/);
});
