/* =====================================================
   Tests — Abonnement des établissements par Mobile Money (pawaPay)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const { _testables: t } = require('../functions/pawapay.js');

test('prix mensuels fixés côté serveur : 250 / 500 / 800 $', () => {
  assert.strictEqual(t.SUBSCRIPTION_PLANS.essentiel.amount, 250);
  assert.strictEqual(t.SUBSCRIPTION_PLANS.pro.amount, 500);
  assert.strictEqual(t.SUBSCRIPTION_PLANS.institution.amount, 800);
});

test("les prix affichés dans l'app correspondent au serveur", () => {
  const ui = read('js/hospital-subscription.js');
  for (const [key, plan] of Object.entries(t.SUBSCRIPTION_PLANS)) {
    assert.match(ui, new RegExp(`${key}: \\{\\s*name: '${plan.name}',\\s*price: ${plan.amount},`));
  }
});

test('numéro RDC normalisé, numéro étranger refusé', () => {
  assert.strictEqual(t.normalizePhone('+243 812 345 678'), '243812345678');
  assert.strictEqual(t.normalizePhone('0998765432'), '243998765432');
  assert.strictEqual(t.normalizePhone('+33612345678'), null);
});

test('prolongation : +30 jours après la fin d’un abonnement encore valide', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.strictEqual(t.nextEndDate(null, now), '2026-10-31T00:00:00.000Z');
  assert.strictEqual(
    t.nextEndDate({ status: 'active', endDate: '2026-10-20T00:00:00Z' }, now),
    '2026-11-19T00:00:00.000Z');
  assert.strictEqual(
    t.nextEndDate({ status: 'expired', endDate: '2026-09-01T00:00:00Z' }, now),
    '2026-10-31T00:00:00.000Z');
});

test('fonctions exportées et règles : dépôts serveur uniquement, config lisible', () => {
  const index = read('functions/index.js');
  for (const fn of ['startSubscriptionPayment', 'checkSubscriptionPayment',
    'reconcileSubscriptionDeposits', 'expirePawapaySubscriptions']) {
    assert.match(index, new RegExp(`exports\\.${fn} = pawapaySubscriptions\\.${fn};`));
  }
  const rules = read('firestore.rules');
  assert.match(rules, /match \/pawapayDeposits\/\{depositId\} \{\s*allow read, write: if false;/);
  assert.match(rules, /match \/appConfig\/\{configId\} \{\s*allow read: if signedIn\(\);\s*allow write: if false;/);
});

test("l'expiration automatique ne touche que les abonnements payés par pawaPay", () => {
  assert.match(read('functions/pawapay.js'), /where\('paymentMethod', '==', 'pawapay'\)/);
});
