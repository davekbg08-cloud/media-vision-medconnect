/* =====================================================
   Tests — visibilité des établissements en attente de validation
   dans le Dashboard admin (js/admin.js renderSubscriptionsSection)

   Découvert en répondant à une question client : une inscription
   d'hôpital faite sur desktop (js/hospital-auth.js register(),
   registeredFrom:'desktop') écrit users/{uid} (rôle hospital, pending)
   et le registre establishments (status:'pending'), mais JAMAIS
   mc_accounts ni registration_requests — les deux seules sources de la
   section "Demandes d'inscription à vérifier". L'établissement
   n'apparaissait donc que dans la section "Abonnements hôpitaux", où il
   s'affichait "✅ Actif" (aucun document subscriptions/{id} → défaut
   permissif de getSubscriptionStatus), noyé et invisible comme
   nouvelle demande. Correctif : establishment.status === 'pending' est
   désormais remonté en tête, signalé distinctement, et compté dans une
   bannière. renderSubscriptionsSection dépend du DOM/async : on
   verrouille par lecture de source (même approche que les autres tests
   d'UI de ce dépôt).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/admin.js'), 'utf8');

function sectionBody() {
  const start = src.indexOf('async function renderSubscriptionsSection(');
  assert.ok(start !== -1, 'renderSubscriptionsSection introuvable');
  const end = src.indexOf('async function activateSubscription(', start);
  assert.ok(end !== -1, 'fin de renderSubscriptionsSection introuvable');
  return src.slice(start, end);
}

test("les établissements 'pending' sont détectés depuis establishment.status", () => {
  const body = sectionBody();
  assert.match(body, /status[^\n]*===\s*'pending'|=== 'pending'/,
    "un établissement doit être détecté comme 'pending' via son status");
  assert.ok(body.includes('isPendingEstablishment'), 'un prédicat isPendingEstablishment doit exister');
});

test('les établissements en attente sont remontés en tête de liste', () => {
  const body = sectionBody();
  assert.match(body, /\.sort\(/, 'la liste doit être triée');
  const sortIdx = body.indexOf('.sort(');
  const sortExpr = body.slice(sortIdx, sortIdx + 160);
  assert.match(sortExpr, /isPendingEstablishment/, 'le tri doit prioriser les établissements pending');
});

test('une bannière signale le nombre de nouvelles inscriptions en attente', () => {
  const body = sectionBody();
  assert.match(body, /pendingCount/, 'le nombre d\'établissements pending doit être compté');
  assert.match(body, /en attente de validation/, 'une bannière doit signaler les inscriptions en attente');
});

test("un établissement 'pending' n'est jamais présenté comme actif (pas de bouton Désactiver, libellé Valider/activer)", () => {
  const body = sectionBody();
  // isActive doit exclure les établissements pending.
  assert.match(body, /const isActive = !isPending/, "isActive doit exclure explicitement les établissements pending");
  assert.match(body, /Valider \/ activer/, "le bouton d'un établissement pending doit inviter à valider/activer");
});
