/* =====================================================
   Tests — bouton "Retour à la connexion" après un compte rejeté
   (retour utilisateur : "on se retrouve directement sur l'interface
   mobile" après un échec de connexion médecin/infirmier(ère) côté
   desktop hôpital)

   Cause exacte : un médecin/infirmier(ère) connecté via le sélecteur
   d'agent desktop (HospitalAuth) dont le compte est "rejected" déclenche
   js/auth.js::showRejectedAccountScreen(), qui REMPLACE #auth-screen —
   élément PARTAGÉ avec le sélecteur d'agent HospitalAuth. Son bouton
   "← Retour à la connexion" appelait toujours Auth.showLogin() (écran
   mobile générique), sans savoir que la tentative venait du desktop
   hôpital, ramenant l'utilisateur sur l'interface mobile au lieu du
   sélecteur d'agent hôpital.

   Correctif : HospitalAuth.isAgentLoginActive() (vrai tant qu'un
   établissement est actif dans le sélecteur d'agent, réinitialisé par
   renderScreen()) permet au bouton de choisir la bonne destination.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const authSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');
const hospitalAuthSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-auth.js'), 'utf8');

test('HospitalAuth expose isAgentLoginActive(), reflet de _activeEstablishment', () => {
  assert.match(hospitalAuthSrc, /function isAgentLoginActive\(\)\s*\{\s*return !!_activeEstablishment;\s*\}/);
  assert.match(hospitalAuthSrc, /return \{[\s\S]*isAgentLoginActive[\s\S]*\};/);
});

test('isAgentLoginActive() est réinitialisé par renderScreen() (retour au bon endroit une seule fois)', () => {
  const start = hospitalAuthSrc.indexOf('function renderScreen()');
  const end = hospitalAuthSrc.indexOf('\n  }', start);
  const body = hospitalAuthSrc.slice(start, end);
  assert.match(body, /_activeEstablishment = null;/);
});

test('showRejectedAccountScreen() : le bouton "Retour à la connexion" vérifie HospitalAuth.isAgentLoginActive() avant de choisir sa destination', () => {
  const start = authSrc.indexOf('function showRejectedAccountScreen(');
  const end = authSrc.indexOf('\n  }', start);
  const body = authSrc.slice(start, end);
  assert.match(body, /window\.HospitalAuth\?\.isAgentLoginActive\?\.\(\)/,
    'doit consulter isAgentLoginActive() plutôt que renvoyer inconditionnellement vers Auth.showLogin()');
  assert.match(body, /HospitalAuth\.renderScreen\(\)/, 'doit pouvoir revenir au sélecteur hôpital');
  assert.match(body, /Auth\.showLogin\(\)/, 'doit toujours pouvoir revenir à la connexion mobile générique hors contexte hôpital');
});
