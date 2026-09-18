/* =====================================================
   Tests — Diagnostic App Check visible dans l'admin (v2.9.46)

   Contexte : le pourcentage « requêtes vérifiées » de la console Firebase
   est lent (jusqu'à 24 h) et opaque ; l'admin n'avait aucun signal dans
   l'app quand le domaine était configuré (l'ancienne bannière ne
   s'affichait QUE si App Check n'était pas configuré). On expose désormais
   l'état réel du jeton (window.MedConnectAppCheckStatus) directement dans
   le tableau de bord admin, avec un bouton de re-vérification.

   Tests structurels (le vrai App Check et l'émulateur ne sont pas
   disponibles ici) : présence et forme des garde-fous.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const firebaseConfig = read('js/firebase-config.js');
const admin = read('js/admin.js');

test('firebase-config expose recheckAppCheckToken, rappelable et sans fuite de jeton', () => {
  assert.match(firebaseConfig, /function recheckAppCheckToken\(timeoutMs = \d+\)/, 'fonction définie');
  assert.match(firebaseConfig, /window\.recheckAppCheckToken = recheckAppCheckToken/, 'exposée sur window');
  const fn = firebaseConfig.slice(
    firebaseConfig.indexOf('function recheckAppCheckToken'),
    firebaseConfig.indexOf('window.recheckAppCheckToken ='));
  assert.match(fn, /getToken\(false\)/, 'tente une nouvelle obtention du jeton');
  assert.match(fn, /Promise\.race/, 'bornée par un timeout');
  assert.match(fn, /status: 'valid'/, 'publie l’état valide en cas de succès');
  assert.ok(!/console\.[a-z]+\([^)]*token/i.test(fn), 'ne journalise jamais le jeton');
});

test('les vérifications App Check sont protégées contre la course (garde de séquence)', () => {
  // Codex P2 : deux rechecks concurrents pouvaient publier dans le désordre
  // (une tentative ancienne écrasant « valid » par un faux « timeout »).
  assert.match(firebaseConfig, /let _appCheckCheckSeq = 0;/, 'compteur de tentative monotone');
  assert.match(firebaseConfig, /function _publishAppCheckIfLatest\(seq, patch\)/, 'publication conditionnée à la dernière tentative');
  const verify = firebaseConfig.slice(
    firebaseConfig.indexOf('function verifyAppCheckToken'),
    firebaseConfig.indexOf('window.verifyAppCheckToken ='));
  const recheck = firebaseConfig.slice(
    firebaseConfig.indexOf('function recheckAppCheckToken'),
    firebaseConfig.indexOf('window.recheckAppCheckToken ='));
  for (const [name, body] of [['verify', verify], ['recheck', recheck]]) {
    assert.match(body, /const mySeq = \+\+_appCheckCheckSeq;/, `${name} capture un numéro de tentative`);
    assert.ok(!/_publishAppCheckStatus\(\{/.test(body), `${name} ne publie que via la garde _publishAppCheckIfLatest`);
    assert.match(body, /_publishAppCheckIfLatest\(mySeq,/, `${name} publie via la garde`);
  }
});

test('la bannière admin lit l’état RÉEL App Check (MedConnectAppCheckStatus) et couvre tous les états', () => {
  const fn = admin.slice(admin.indexOf('function appCheckWarningBanner'), admin.indexOf('/* ══ DASHBOARD'));
  assert.match(fn, /window\.MedConnectAppCheckStatus/, 'lit l’état publié');
  // Succès explicite (n’existait pas avant : la bannière ne montrait rien quand configuré).
  assert.match(fn, /App Check actif/, 'état jeton valide affiché');
  assert.match(fn, /jusqu'à 24\s?h/, 'explique le délai du pourcentage console');
  assert.match(fn, /optionnelle/, 'rappelle que l’Enforcement est optionnel');
  // Échec explicite qui EXPLIQUE un pourcentage vide.
  assert.match(fn, /jeton NON obtenu/, 'état échec affiché');
  assert.match(fn, /domaines autoris/, 'oriente vers la config reCAPTCHA/App Check');
  // Bouton de re-vérification câblé sur la fonction exposée.
  assert.match(fn, /window\.recheckAppCheckToken/, 'bouton re-vérifier câblé');
  assert.match(fn, /AdminModule\.renderDashboard/, 'rafraîchit le tableau de bord après re-vérification');
});

test('la bannière n’expose jamais le jeton ni la clé', () => {
  const fn = admin.slice(admin.indexOf('function appCheckWarningBanner'), admin.indexOf('/* ══ DASHBOARD'));
  assert.ok(!/getToken|siteKey|APP_CHECK_SITE_KEYS|tokenVerified\s*\+/.test(fn),
    'la bannière ne manipule ni jeton ni clé (seulement le statut publié)');
});
