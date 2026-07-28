/* =====================================================
   Tests — câblage Cloud Functions notifications (Phase 2, v2.9.42) — STRUCTUREL.

   Les callables exigent firebase-admin + un déploiement : on verrouille au
   SOURCE que le contrat est respecté (App Check exigé, Auth vérifiée, écriture
   des jetons jamais loguée, enqueueNotification idempotent et sans envoi de
   faux « delivered », re-export racine).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const notif = read('functions/notifications.js');
const index = read('functions/index.js');

test('les 5 callables sont définies et re-exportées au niveau racine', () => {
  for (const fn of ['registerPushDevice', 'unregisterPushDevice', 'updateNotificationPreferences', 'markNotificationRead', 'sendTestNotification']) {
    assert.match(notif, new RegExp(`const ${fn} = onCall`), `${fn} défini via onCall`);
    assert.match(index, new RegExp(`exports\\.${fn} = notifications\\.${fn}`), `${fn} re-exporté`);
  }
});

test('toutes les callables passent par CALL_OPTS (App Check exigé, config économe)', () => {
  assert.match(notif, /enforceAppCheck:\s*true/);
  assert.match(notif, /minInstances:\s*0/);
  // Chaque callable utilise CALL_OPTS.
  const count = (notif.match(/onCall\(CALL_OPTS/g) || []).length;
  assert.strictEqual(count, 5, 'les 5 callables utilisent CALL_OPTS');
});

test('chaque callable vérifie l\'authentification (requireAuth)', () => {
  // requireAuth lève unauthenticated si pas de session.
  assert.match(notif, /function requireAuth/);
  assert.match(notif, /unauthenticated/);
  // Les 5 callables appellent requireAuth.
  const count = (notif.match(/requireAuth\(request\)/g) || []).length;
  assert.ok(count >= 5, 'les 5 callables exigent une session');
});

test('registerPushDevice valide le provider et ne logue jamais les jetons', () => {
  const body = notif.slice(notif.indexOf('const registerPushDevice'), notif.indexOf('const unregisterPushDevice'));
  assert.match(body, /VALID_PROVIDERS\.includes\(provider\)/, 'provider validé');
  // Aucun console.log/warn du token dans le module.
  assert.ok(!/console\.(log|warn|error)\([^)]*registrationToken/.test(notif), 'le token n\'est jamais logué');
  assert.ok(!/console\.(log|warn|error)\([^)]*webPushSubscription/.test(notif), 'la souscription n\'est jamais loguée');
});

test('enqueueNotification est idempotent et exige recipientUid (jamais d\'envoi générique)', () => {
  const body = notif.slice(notif.indexOf('async function enqueueNotification'), notif.indexOf('/* ── Callables'));
  assert.match(body, /notificationIdFromDedup/, 'id déterministe pour l\'idempotence');
  assert.match(body, /runTransaction/, 'création transactionnelle');
  assert.match(body, /if \(existing\.exists\) return false/, 'pas de doublon si déjà créé');
  assert.match(body, /if \(!r \|\| !r\.recipientUid\) continue/, 'recipientUid obligatoire');
});

test('le journal de livraison n\'affirme jamais « delivered » sans preuve', () => {
  // enqueue pose l'état `queued` ; jamais `delivered`.
  assert.match(notif, /state:\s*'queued'/);
  assert.ok(!/state:\s*'delivered'/.test(notif), 'jamais delivered à la mise en file');
});

test('markNotificationRead ne marque que SA notification et recalcule le badge depuis Firestore', () => {
  const body = notif.slice(notif.indexOf('const markNotificationRead'), notif.indexOf('const sendTestNotification'));
  assert.match(body, /recipientUid !== uid/, 'refuse la notification d\'un autre');
  assert.match(body, /computeBadgeCount/, 'badge recalculé depuis Firestore');
});

test('sendTestNotification est limité en fréquence et n\'envoie qu\'à soi-même', () => {
  const body = notif.slice(notif.indexOf('const sendTestNotification'), notif.indexOf('module.exports'));
  assert.match(body, /resource-exhausted/, 'cooldown anti-spam');
  assert.match(body, /recipientUid: uid/, 'destinataire = soi-même uniquement');
  assert.ok(!/diagnosis|medicines|patient_id|patientName|safePreview:/i.test(body), 'aucune donnée médicale dans le test');
});
