/* =====================================================
   Tests — le statut d'abonnement distingue "validé sans abonnement" de
   "abonnement payé actif" (js/admin.js renderSubscriptionsSection)

   Signalé par le client : le bouton d'activation d'abonnement « garde le
   même statut » — un établissement validé mais sans abonnement payé
   s'affichait "✅ Actif" (getSubscriptionStatus renvoie 'active' par
   défaut permissif quand subscriptions/{id} n'existe pas), et le restait
   après clic sur "Activer" : aucun changement visible. Correctif : on
   dérive hasPaidSub (endDate/activatedAt/plan) ; sans abonnement payé, le
   statut affiche "⚠️ Validé — aucun abonnement actif" et le bouton
   "Activer" produit alors un changement visible vers "✅ Actif".
   Fonction DOM/async : lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function sectionBody() {
  const start = src.indexOf('async function renderSubscriptionsSection(');
  const end = src.indexOf('async function activateSubscription(', start);
  assert.ok(start !== -1 && end !== -1, 'renderSubscriptionsSection introuvable');
  return src.slice(start, end);
}

test("l'existence d'un abonnement payé est dérivée (endDate/activatedAt/plan)", () => {
  const body = sectionBody();
  assert.match(body, /const hasPaidSub = !!\(sub\.endDate \|\| sub\.activatedAt \|\| sub\.plan\)/,
    "hasPaidSub doit distinguer un abonnement réellement payé du défaut permissif");
});

test('"Actif" (isActive) exige un abonnement payé — pas seulement le statut par défaut', () => {
  const body = sectionBody();
  assert.match(body, /const isActive = !isPending && hasPaidSub && subActive/,
    "isActive doit exiger hasPaidSub (sinon Désactiver s'affiche à tort et le statut ne change pas)");
});

test('un établissement validé SANS abonnement payé est signalé distinctement (pas "✅ Actif")', () => {
  const body = sectionBody();
  assert.match(body, /subActive && !hasPaidSub/, "le cas validé-sans-abonnement doit être détecté");
  assert.match(body, /aucun abonnement actif/, "un libellé distinct doit s'afficher pour validé-sans-abonnement");
});
