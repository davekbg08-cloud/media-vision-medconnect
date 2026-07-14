/* =====================================================
   Tests — validateEstablishment confirme le statut côté cloud
   (js/hospitals_registry.js)

   validateEstablishment est l'option d'activation/validation d'hôpital
   existante (gestionnaire de registre), utilisée aussi pour les
   établissements inscrits depuis le desktop (renderAdminList gère
   explicitement registeredFrom === 'desktop'). Correctif : la mise à
   jour du statut établissement passait par updateHospital →
   saveHospitals, dont le push cloud n'est PAS attendu — l'écouteur
   establishments (remplacement intégral) pouvait repousser l'ancien
   'pending' si la propagation échouait, laissant le badge "à valider"
   persister. L'écriture establishments/{id}.status est désormais
   awaitée et confirmée, avec un avertissement si elle échoue (même
   correctif que admin.js activateSubscription). Fonction DOM/async :
   lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospitals_registry.js'), 'utf8');

function validateBody() {
  const start = src.indexOf('async function validateEstablishment(');
  assert.ok(start !== -1, 'validateEstablishment introuvable');
  const end = src.indexOf('function renderAdminRequests(', start);
  assert.ok(end !== -1, 'fin de validateEstablishment introuvable');
  return src.slice(start, end);
}

test("le statut établissement est confirmé côté cloud (await establishments set)", () => {
  const body = validateBody();
  assert.match(body,
    /await firebaseDB\s*\n?\s*\.collection\('establishments'\)\.doc\(establishmentId\)/,
    "establishments/{id}.status doit être écrit et attendu (await) pour confirmer la validation");
});

test("l'issue est suivie (confirmed) et un avertissement s'affiche si la confirmation échoue", () => {
  const body = validateBody();
  assert.match(body, /let confirmed = true;/, 'un indicateur de confirmation doit exister');
  assert.match(body, /confirmed = false;/, "l'échec de confirmation (cloud ou compte) doit être capté");
  assert.match(body, /'warning'/, "un avertissement doit s'afficher si l'action n'est pas confirmée");
});
