/* =====================================================
   Tests — Essai gratuit, activation fiable, espace hôpital desktop
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test("règles : l'essai gratuit ouvre les mêmes droits qu'un abonnement actif", () => {
  assert.match(read('firestore.rules'),
    /return subscriptionStatus\(hospitalId\) in \['active', 'grace_period', 'trial'\];/);
});

test("validation d'un établissement : essai gratuit de 30 jours créé s'il n'a pas d'abonnement", () => {
  const src = read('js/hospitals_registry.js');
  assert.match(src, /if \(approve && typeof firebaseDB !== 'undefined' && firebaseDB\)/);
  assert.match(src, /if \(!existing\.exists\)/, "n'écrase jamais un abonnement existant");
  assert.match(src, /status: 'trial'/);
  assert.match(src, /30 \* 86400000/);
});

test("admin : l'activation depuis la fenêtre ne dépend plus d'une boîte confirm() native", () => {
  const src = read('js/admin.js');
  assert.match(src, /activateSubscription\(hospitalId, plan, months, \{ skipConfirm: true \}\)/);
  assert.match(src, /if \(!opts\.skipConfirm && !confirm\(/);
  assert.match(src, /trial:'Essai gratuit'/);
});

test('ExchangeBridge : essai autorisé avec avertissement de fin', () => {
  assert.match(read('js/exchange-bridge.js'), /if \(status === 'trial'\) \{\s*return \{\s*allowed: true/);
});

test('bureau hôpital : icônes de menu, alerte de renouvellement et accès à l\'abonnement', () => {
  const ui = read('js/hospital-desktop-ui.js');
  assert.match(ui, /window\.McIcons\?\.desktopRouteIcon\(m\.key\) \|\| m\.icon/);
  assert.match(ui, /HospitalDesktopUI\.navigate\('subscription'\)/);
  assert.match(ui, /Contactez l\\'administrateur de votre établissement/);
  const icons = read('js/icons.js');
  assert.match(icons, /getElementById\('hospital-desktop-root'\)/);
});

test("pendant l'essai, le bandeau propose « Choisir une formule » (premier abonnement)", () => {
  const ui = read('js/hospital-desktop-ui.js');
  assert.match(ui, /const needsAction = isTrial \|\| \['expired', 'suspended', 'grace_period'\]\.includes\(sub\.status\);/);
  assert.match(ui, /'Choisir une formule' : 'Renouveler'/);
});
