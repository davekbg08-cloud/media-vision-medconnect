/* =====================================================
   Tests — épuration de l'écran d'authentification (demande client)

   1. Labo et Réception sont des postes DESKTOP hôpital : ils ne sont
      plus proposés à l'inscription sur mobile/PWA (aucun usage). Le
      labo continue de « communiquer » avec le mobile : ses résultats
      atteignent la vue patient via le miroir mc_lab_results.
   2. Le bouton de connexion patient disait « Se connecter à mon
      dossier existant » — redondant (se connecter implique que le
      compte existe) : devenu « Se connecter ». L'encart « Compte
      existant : … » (non essentiel) est retiré.
   3. Le pavé d'orientation de l'inscription ne répète plus la phrase
      « L'administrateur vérifiera votre demande » (déjà dans l'encart
      du haut) — seuls les contacts et le délai restent.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const auth = read('js/auth.js');

test("l'inscription filtre les rôles par plateforme : labo/réception seulement sur desktop", () => {
  assert.match(auth, /function _registerRolesForDevice\(\)/, 'le filtre par plateforme doit exister');
  assert.match(auth, /currentSourceDevice\?\.\(\) === 'desktop'/, 'la détection doit venir d\'ExchangeBridge');
  assert.match(auth, /\? \['doctor','pharmacist','nurse','lab','reception'\]\s*\n?\s*: \['doctor','pharmacist','nurse'\]/,
    'desktop : 5 rôles ; mobile : ni lab ni reception');
  assert.match(auth, /_registerRolesForDevice\(\)\.map/, '_htmlRegister doit utiliser le filtre');
});

test('le bouton de connexion patient dit simplement « Se connecter »', () => {
  assert.match(auth, /onclick="Auth\._doPatient\(\)">🔐 Se connecter<\/button>/, 'libellé corrigé');
  assert.ok(!auth.includes('Se connecter à mon dossier existant'), "l'ancien libellé redondant ne doit plus exister");
  assert.ok(!auth.includes('Compte existant :'), "l'encart « Compte existant » (non essentiel) doit être retiré");
  // Le second bouton (premier accès) reste — c'est lui qui distingue les deux cas.
  assert.match(auth, /Premier accès : créer mon PIN/, 'le bouton premier accès doit rester');
});

test("le pavé d'orientation de l'inscription ne duplique plus la phrase de validation admin", () => {
  const flow = read('js/registration-submit-flow.js');
  assert.ok(!flow.includes('Soumettez quand même votre demande'), 'phrase redondante retirée');
  assert.match(flow, /WhatsApp : <strong>\+243 856 373 707<\/strong>/, 'les contacts restent');
  assert.match(flow, /Délai indicatif : 24 à 48h ouvrables/, 'le délai reste');
});
