/* =====================================================
   Tests — Abonnement des établissements par Mobile Money (pawaPay)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const t = require('../functions/pawapay-helpers.js');

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
    t.nextEndDate({ status: 'trial', endDate: '2026-10-10T00:00:00Z' }, now),
    '2026-11-09T00:00:00.000Z', "les jours d'essai restants sont conservés");
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

test("l'expiration automatique couvre tous les abonnements datés (actif, grâce, essai)", () => {
  assert.match(read('functions/pawapay.js'), /where\('status', 'in', \['active', 'grace_period', 'trial'\]\)/);
});

test("paiement : client Cloud Functions créé avec la région sur l'application (SDK compat)", () => {
  const ui = read('js/hospital-subscription.js');
  assert.match(ui, /firebase\.app\(\)\.functions\('europe-west1'\)/);
  assert.ok(!/const fns = firebaseFunctions;/.test(ui), "plus de dépendance au client global resté null");
});
