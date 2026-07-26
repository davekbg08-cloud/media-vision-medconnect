/* =====================================================
   Tests — Notification système « quand l'app tourne » (Electron + web,
   Phase 5 Electron/foreground, v2.9.42) — STRUCTUREL.

   Vérifie au source les garde-fous : jamais le backlog au premier snapshot,
   uniquement les NOUVELLES non-lues, permission requise, libellés génériques
   (aucune donnée médicale), clic qui ramène la fenêtre au premier plan.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/notification-center.js'), 'utf8');

test('la notification système ne se déclenche pas au premier chargement (pas de backlog)', () => {
  assert.match(src, /const first = !_seeded/);
  assert.match(src, /if \(!first\) fresh\.filter/);
  assert.match(src, /_seeded = true/);
});

test('seules les NOUVELLES non-lues déclenchent une notification système', () => {
  assert.match(src, /if \(!_known\.has\(id\)\)/, 'suivi des ids déjà vus');
  assert.match(src, /\(n\.readStatus \|\| 'unread'\) === 'unread'/);
});

test('la notification système exige la permission et n\'expose aucune donnée médicale', () => {
  const body = src.slice(src.indexOf('function _maybeSystemNotify'), src.indexOf('function _maybeSystemNotify') + 700);
  assert.match(body, /Notification\.permission !== 'granted'/);
  // Utilise les libellés neutres (titleKey/bodyKey), jamais un champ clinique.
  assert.match(body, /resolveLabel\(n\.titleKey/);
  for (const forbidden of ['diagnosis', 'safePreview', 'patientName', 'medicines']) {
    assert.ok(!body.includes(forbidden), `pas de ${forbidden}`);
  }
});

test('le clic sur la notification système ramène la fenêtre au premier plan (Electron)', () => {
  const body = src.slice(src.indexOf('function _maybeSystemNotify'), src.indexOf('function _maybeSystemNotify') + 700);
  assert.match(body, /window\.focus\(\)/);
  assert.match(body, /openNotification\(n\.notificationId\)/);
});

test('teardown réinitialise l\'état anti-doublon (poste partagé)', () => {
  assert.match(src, /_seeded = false; _known\.clear\(\)/);
});
