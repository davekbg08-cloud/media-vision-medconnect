/* =====================================================
   Tests — Cloud Functions authLookup/claimPatientAccount + câblage client
   (chantiers 6 & 7, v2.9.42) — vérification STRUCTURELLE (source).

   Ces fonctions serveur ne peuvent être exécutées ici (elles exigent
   firebase-admin + un déploiement Blaze). On verrouille donc au SOURCE :
   - functions/index.js déclare les 3 fonctions, App Check EXIGÉ, config
     économe (minInstances 0), et ne renvoie jamais le document entier ;
   - le client (js/auth.js) tente la voie serveur PUIS retombe proprement sur
     la lecture directe tant que la fonction est indisponible (aucune casse
     avant déploiement) ;
   - firebase-config.js / index.html / sw.js chargent le SDK functions ;
   - firebase.json déclare les functions et n'expose jamais le dossier au
     hosting.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

test('functions/index.js déclare les 3 fonctions callable', () => {
  const s = read('functions/index.js');
  assert.match(s, /exports\.authLookup\s*=\s*onCall/);
  assert.match(s, /exports\.claimPatientAccount\s*=\s*onCall/);
  assert.match(s, /exports\.setVerifiedClientType\s*=\s*onCall/);
});

test('App Check est EXIGÉ et la config est économe (coût Blaze)', () => {
  const s = read('functions/index.js');
  assert.match(s, /enforceAppCheck:\s*true/, 'App Check obligatoire');
  assert.match(s, /minInstances:\s*0/, 'aucune instance chaude au repos');
  assert.match(s, /maxInstances:\s*10/, 'garde-fou de coût');
  assert.match(s, /memory:\s*'256MiB'/);
});

test('authLookup ne renvoie qu\'une vue minimale (jamais le document entier)', () => {
  const s = read('functions/index.js');
  assert.match(s, /function minimalAccountView/);
  // La projection ne contient que exists/uid/role/status/email.
  const proj = s.slice(s.indexOf('function minimalAccountView'), s.indexOf('function minimalAccountView') + 400);
  assert.match(proj, /exists:\s*true/);
  assert.ok(!/diagnos|medicines|patient_id:/.test(proj), 'aucun champ clinique dans la projection');
});

test('claimPatientAccount vérifie le code côté serveur et refuse la préemption', () => {
  const s = read('functions/index.js');
  assert.match(s, /unauthenticated/, 'exige une session');
  assert.match(s, /already-exists/, 'refuse un compte déjà lié à un autre appareil');
  assert.match(s, /Code de premier accès invalide/, 'vérifie le code serveur');
  assert.match(s, /runTransaction/, 'liaison transactionnelle idempotente');
});

test('le client tente authLookup puis retombe proprement (repli avant déploiement)', () => {
  const s = read('js/auth.js');
  assert.match(s, /_authLookupViaFunction/);
  assert.match(s, /httpsCallable\('authLookup'\)/);
  // undefined = indisponible → l'appelant utilise la lecture directe.
  assert.match(s, /return undefined; \/\/ indisponible/);
  // Le repli lecture directe mc_accounts existe toujours.
  assert.match(s, /collection\('mc_accounts'\)\.where\('role', '==', role\)/);
});

test('le SDK Cloud Functions est chargé et exposé côté client', () => {
  assert.match(read('index.html'), /firebase-functions-compat\.js/);
  assert.match(read('sw.js'), /firebase-functions-compat\.js/);
  const cfg = read('js/firebase-config.js');
  assert.match(cfg, /firebaseFunctions\s*=\s*firebase\.functions/);
  assert.match(cfg, /window\.firebaseFunctions\s*=\s*firebaseFunctions/);
});

test('firebase.json déclare les functions et n\'expose pas le dossier au hosting', () => {
  const j = JSON.parse(read('firebase.json'));
  assert.ok(j.functions && j.functions.source === 'functions');
  assert.ok(j.hosting.ignore.includes('functions/**'), 'le code des fonctions n\'est jamais servi en statique');
  // La CSP autorise l'appel aux fonctions.
  const csp = JSON.stringify(j.hosting.headers);
  assert.match(csp, /cloudfunctions\.net/);
});

test('la fiche patient et le code de premier accès ne sont jamais renvoyés au client par authLookup', () => {
  const s = read('functions/index.js');
  // authLookup patient renvoie minimalAccountView, jamais firstAccessCode.
  const authLookupBody = s.slice(s.indexOf('exports.authLookup'), s.indexOf('/* claimPatientAccount'));
  assert.ok(!/firstAccessCode/.test(authLookupBody), 'authLookup ne manipule jamais le code de premier accès');
});
