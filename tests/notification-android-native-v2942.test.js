/* =====================================================
   Tests — FCM natif Android (Phase 5 native, v2.9.42) — STRUCTUREL.

   Le code natif (Java/Gradle/Manifest) ne se compile pas ici : on verrouille au
   SOURCE le contrat de sécurité et d'intégration : service FCM déclaré, canaux
   stables, permission Android 13+, message data-only sans clinique, jetons
   jamais logués, plugin google-services conditionnel (build non cassé sans le
   fichier), et le chemin client fcm_android_native.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const svc = read('android/app/src/main/java/com/medconnect/app/MedConnectMessagingService.java');
const bridge = read('android/app/src/main/java/com/medconnect/app/MedConnectPushBridge.java');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const appGradle = read('android/app/build.gradle');
const projGradle = read('android/build.gradle');
const main = read('android/app/src/main/java/com/medconnect/app/MainActivity.java');

test('le service FCM est déclaré dans le manifest avec l\'intent MESSAGING_EVENT', () => {
  assert.match(manifest, /android:name="\.MedConnectMessagingService"/);
  assert.match(manifest, /com\.google\.firebase\.MESSAGING_EVENT/);
  assert.match(manifest, /android:exported="false"/);
});

test('permission POST_NOTIFICATIONS déclarée + demandée sur Android 13+', () => {
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(main, /POST_NOTIFICATIONS/);
  assert.match(main, /Build\.VERSION\.SDK_INT >= 33/);
});

test('les 5 canaux stables sont créés', () => {
  for (const ch of ['medconnect_critical', 'medconnect_clinical', 'medconnect_appointments', 'medconnect_messages', 'medconnect_administrative']) {
    assert.ok(svc.includes(ch), `canal ${ch} attendu`);
  }
  assert.match(svc, /IMPORTANCE_HIGH/);
  assert.match(svc, /IMPORTANCE_LOW/);
});

test('la notification native est générique et ne place aucune donnée médicale dans l\'Intent', () => {
  assert.match(svc, /GENERIC_TITLE = "MedConnect"/);
  // L'intent ne transporte que notificationId + deepLink (validé), jamais de contenu.
  assert.match(svc, /putExtra\("mc_notification_id"/);
  assert.match(svc, /putExtra\("mc_deep_link"/);
  for (const forbidden of ['diagnosis', 'patientName', 'safePreview', 'medicines', 'getContentText().*data']) {
    assert.ok(!new RegExp(forbidden).test(svc.replace(/GENERIC_BODY/g, '')), `pas de ${forbidden}`);
  }
  // Deep link validé par une allowlist.
  assert.match(svc, /static String safePath/);
});

test('le jeton FCM n\'est jamais logué et n\'est écrit qu\'en cache local', () => {
  assert.ok(!/Log\.[a-z]+\([^)]*token/i.test(svc));
  assert.ok(!/Log\.[a-z]+\([^)]*token/i.test(bridge));
  assert.match(bridge, /getSharedPreferences/);
  assert.match(bridge, /isNativeAndroid/);
});

test('le plugin google-services est CONDITIONNEL (build non cassé sans le fichier)', () => {
  assert.match(appGradle, /google-services\.json'\)\.exists\(\)/);
  assert.match(appGradle, /apply plugin: 'com\.google\.gms\.google-services'/);
  assert.match(appGradle, /firebase-messaging/);
  assert.match(projGradle, /com\.google\.gms\.google-services'.*apply false/);
});

test('MainActivity expose le pont MedConnectPush et relaie l\'ouverture par notification', () => {
  assert.match(main, /addJavascriptInterface\(new MedConnectPushBridge\(this\), "MedConnectPush"\)/);
  assert.match(main, /MedConnectMessagingService\.createChannels\(this\)/);
  assert.match(main, /MedConnectNativeNotification/);
  // MainActivity n'importe PAS Firebase directement (confiné au service).
  assert.ok(!/import com\.google\.firebase/.test(main), 'MainActivity ne dépend pas directement de Firebase');
});

/* ── chemin client (push-registration) ── */
const PR = require('../js/push-registration.js');
const I = PR._internal;

test('pickProvider : app native Android → fcm_android_native', () => {
  assert.strictEqual(I.pickProvider({ nativeAndroid: true }), 'fcm_android_native');
});

test('computeState : natif Android reflète la présence du jeton (jamais faux activé)', () => {
  assert.strictEqual(I.computeState({ nativeAndroid: true, nativeToken: 'abc' }, false), 'granted');
  assert.strictEqual(I.computeState({ nativeAndroid: true, nativeToken: '' }, false), 'default');
});
