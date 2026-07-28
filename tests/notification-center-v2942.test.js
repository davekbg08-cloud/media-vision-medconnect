/* =====================================================
   Tests — Centre de notifications in-app (Phase 6a, v2.9.42)

   Logique pure du module client : résolution de libellés neutres (fr/en +
   interpolation), allowlist de deep links (anti open-redirect), comptage des
   non-lus, rendu de carte sûr (échappement, aucun champ médical).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const NC = require('../js/notification-center.js');
const I = NC._internal;

test('resolveLabel : libellé neutre fr/en + repli générique', () => {
  assert.strictEqual(I.resolveLabel('notif.lab.ready.title', null, 'fr'), 'Résultat disponible');
  assert.strictEqual(I.resolveLabel('notif.lab.ready.title', null, 'en'), 'Result available');
  // Clé inconnue → générique (jamais la clé brute exposée telle quelle comme contenu).
  assert.strictEqual(I.resolveLabel('notif.inexistante', null, 'fr'), 'Notification');
});

test('resolveLabel : interpolation des paramètres', () => {
  I.LABELS['notif.demo'] = { fr: 'Bonjour {name}', en: 'Hello {name}' };
  assert.strictEqual(I.resolveLabel('notif.demo', { name: 'Alice' }, 'fr'), 'Bonjour Alice');
});

test('isAllowedRoute : uniquement des routes internes de l\'allowlist', () => {
  assert.ok(I.isAllowedRoute('/notifications/ntf_abc'));
  assert.ok(I.isAllowedRoute('/appointments/1'));
  assert.ok(I.isAllowedRoute('/lab'));
  // Refusés : externe, protocol-relative, hors allowlist, préfixe trompeur.
  assert.ok(!I.isAllowedRoute('https://evil.example/x'));
  assert.ok(!I.isAllowedRoute('//evil.example'));
  assert.ok(!I.isAllowedRoute('/random'));
  assert.ok(!I.isAllowedRoute('/notificationsX'));
  assert.ok(!I.isAllowedRoute('javascript:alert(1)'));
  assert.ok(!I.isAllowedRoute(null));
});

test('computeUnread : compte les non-lus non masqués', () => {
  const list = [
    { readStatus: 'unread' },
    { readStatus: 'read' },
    { readStatus: 'unread', dismissedAt: 'x' }, // masqué → non compté
    { }, // par défaut unread
  ];
  assert.strictEqual(I.computeUnread(list), 2);
});

test('renderCard : échappe le HTML et n\'affiche que des libellés neutres', () => {
  const html = I.renderCard({
    notificationId: 'ntf_1', category: 'lab_result', titleKey: 'notif.lab.ready.title',
    bodyKey: 'notif.lab.ready.body', readStatus: 'unread',
    // Champs qui NE DOIVENT PAS apparaître (les notifications n'en portent pas,
    // mais on verrouille : renderCard n'utilise jamais ces clés) :
    safePreview: '<script>evil</script>', diagnosis: 'SECRET', patientName: 'Jean Dupont',
  }, 'fr');
  assert.match(html, /Résultat disponible/);
  assert.ok(!html.includes('SECRET'), 'aucun contenu médical');
  assert.ok(!html.includes('Jean Dupont'), 'aucun nom patient');
  assert.ok(!html.includes('<script>evil'), 'aucune injection HTML');
});

test('renderCard : marque visuellement les non-lus', () => {
  const unread = I.renderCard({ notificationId: 'a', titleKey: 'notif.generic.title', readStatus: 'unread' }, 'fr');
  const read = I.renderCard({ notificationId: 'b', titleKey: 'notif.generic.title', readStatus: 'read' }, 'fr');
  assert.match(unread, /mc-notif-unread/);
  assert.ok(!/mc-notif-unread/.test(read));
});

test('l\'allowlist de routes couvre les modules cibles', () => {
  for (const p of ['/notifications', '/appointments', '/lab', '/prescriptions', '/messages', '/admissions', '/transfers']) {
    assert.ok(I.ALLOWED_ROUTE_PREFIXES.includes(p), `${p} doit être autorisé`);
  }
});
