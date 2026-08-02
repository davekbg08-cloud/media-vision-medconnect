/* =====================================================
   Tests — Connexion & repeuplement sur APPAREIL NEUF (v2.9.45)

   Contexte du bug (PWA iOS réinstallée / nouveau téléphone) :
   sur iOS, une PWA installée a un stockage SÉPARÉ de Safari. La PWA
   fraîche démarre donc sans cache local et déconnectée. Deux symptômes :

   1) « Compte refusé » — avant authentification, la SEULE voie de
      résolution d'un compte est la Cloud Function authLookup, qui exige
      un jeton App Check (enforceAppCheck). Sur une install neuve, le
      premier « Se connecter » partait AVANT que reCAPTCHA Enterprise ait
      produit son premier jeton → authLookup rejeté → et, la lecture
      publique de mc_accounts étant fermée (v2.9.42), plus aucun repli →
      « aucun compte trouvé ».
      Correctifs : (a) attendre le jeton App Check avant authLookup ;
      (b) repli patient par connexion Firebase Auth directe via l'e-mail
      synthétique déterministe (Auth n'est pas soumis à App Check).

   2) « Tableau de bord admin à 0 » — les écoutes collection-entière
      (isAdmin) étaient montées au BOOT, avant login (donc rejetées) et
      jamais rejouées. Correctif : les remonter dans
      setupUserScopedListeners(), APRÈS login.

   Ces tests sont STRUCTURELS (source lue en texte) : l'émulateur et un
   vrai App Check ne sont pas disponibles ici, mais la présence et
   l'ordre des garde-fous dans le code sont vérifiables et suffisent à
   empêcher une régression silencieuse.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const firebaseConfig = read('js/firebase-config.js');
const auth = read('js/auth.js');
const db = read('js/db.js');

/* ── 1. Helper waitForAppCheckToken ──────────────────── */
test('firebase-config expose waitForAppCheckToken, borné et non bloquant', () => {
  assert.match(firebaseConfig, /function waitForAppCheckToken\(timeoutMs = \d+\)/,
    'waitForAppCheckToken doit exister avec un timeout par défaut');
  const fn = firebaseConfig.slice(firebaseConfig.indexOf('function waitForAppCheckToken'));
  assert.match(fn, /getToken\(false\)/, 'réutilise le cache de jeton du SDK (getToken(false))');
  assert.match(fn, /Promise\.race/, 'course contre un timeout — jamais bloquant');
  assert.match(fn, /return false/, 'renvoie false en cas d’échec/timeout (l’appelant continue)');
  assert.match(firebaseConfig, /window\.waitForAppCheckToken = waitForAppCheckToken/,
    'exposé sur window pour l’usage depuis auth.js / db.js');
});

test('waitForAppCheckToken ne journalise jamais le jeton', () => {
  const fn = firebaseConfig.slice(
    firebaseConfig.indexOf('function waitForAppCheckToken'),
    firebaseConfig.indexOf('window.waitForAppCheckToken ='));
  // Aucun console.* n’imprime le résultat de getToken.
  assert.ok(!/console\.[a-z]+\([^)]*token/i.test(fn), 'aucun log de jeton dans waitForAppCheckToken');
});

/* ── 2. authLookup attend le jeton App Check ─────────── */
test('auth.js attend le jeton App Check AVANT d’appeler authLookup', () => {
  const start = auth.indexOf('_authLookupViaFunction');
  const slice = auth.slice(start, start + 900);
  const waitIdx = slice.indexOf('waitForAppCheckToken');
  const callIdx = slice.indexOf("httpsCallable('authLookup')");
  assert.ok(waitIdx !== -1, 'waitForAppCheckToken doit être appelé dans _authLookupViaFunction');
  assert.ok(callIdx !== -1, "l'appel authLookup doit être présent");
  assert.ok(waitIdx < callIdx, "l'attente du jeton doit précéder l'appel authLookup");
});

test('db.js attend le jeton App Check avant son propre appel authLookup', () => {
  const idx = db.indexOf('async function accountExistsForPatient');
  const slice = db.slice(idx, idx + 1600);
  const waitIdx = slice.indexOf('waitForAppCheckToken');
  const callIdx = slice.indexOf("httpsCallable('authLookup')");
  assert.ok(waitIdx !== -1 && callIdx !== -1 && waitIdx < callIdx,
    'db.js doit attendre le jeton avant authLookup');
});

/* ── 3. Repli patient par connexion Firebase Auth directe ─ */
test('connexion patient : repli Firebase Auth direct quand la résolution de compte échoue', () => {
  const start = auth.indexOf('async function _doPatientFlow');
  const flow = auth.slice(start, auth.indexOf('async function _createPatientPin'));
  // Le repli n'existe QUE dans la branche « compte introuvable ».
  const branch = flow.slice(flow.indexOf('if (!existing) {'));
  assert.match(branch, /_syntheticPatientEmail\(id\)/, 'utilise l’e-mail synthétique déterministe');
  assert.match(branch, /_signInPatientFirebaseAuth\(email, _toFirebasePassword\(pin\)\)/,
    'tente une connexion Firebase Auth directe (non soumise à App Check)');
  assert.match(branch, /_hydratePatientRecordAfterAuth\(id\)/, 'relit la fiche en propriétaire après succès');
  assert.match(branch, /localStorage\.setItem\('mc_my_patient_id', id\)/, 'mémorise la fiche du patient');
  // En cas d’échec, message couvrant (compte inexistant OU PIN faux).
  assert.match(branch, /Aucun compte trouvé/, 'message couvrant conservé en cas d’échec');
});

test('l’e-mail synthétique patient est déterministe (dérivé du seul numéro de fiche)', () => {
  const fn = auth.slice(auth.indexOf('function _syntheticPatientEmail'), auth.indexOf('function _toFirebasePassword'));
  assert.match(fn, /patient-\$\{String\(patientId\)\.toLowerCase\(\)\.replace/,
    'e-mail dérivé uniquement de patientId → reconstituable sur un appareil neuf');
});

/* ── 4. Admin : écoutes collection-entière rejouées après login ─ */
test('setupUserScopedListeners remonte les écoutes admin APRÈS login', () => {
  const start = db.indexOf('function setupUserScopedListeners');
  const fn = db.slice(start, db.indexOf('/* ── INIT'));
  const adminBranch = fn.slice(fn.indexOf("if (user.role === 'admin')"));
  assert.ok(adminBranch.length > 0, 'une branche admin doit exister dans setupUserScopedListeners');
  // Les 3 collections qui alimentent le tableau de bord admin (admin.js).
  for (const coll of ['mc_patients', 'mc_accounts', 'mc_consultations']) {
    assert.ok(adminBranch.includes(`collection('${coll}')`),
      `l'admin doit ré-écouter ${coll} après login`);
  }
  // Pas d'écoute prescriptions/rendez-vous collection-entière (inutile au
  // dashboard, et proscrite ailleurs).
  assert.ok(!adminBranch.includes("collection('mc_prescriptions')"),
    'pas d’écoute mc_prescriptions collection-entière pour l’admin');
  // Elles passent par scoped() → suivies dans _userListenersUnsubs (pas de fuite).
  assert.match(adminBranch, /scoped\(firebaseDB\.collection\('mc_patients'\)/,
    'via scoped() pour être désabonnable et fusionner (mergeStore)');
});

/* ── 5. Non-régression : aucune modif de règles ni d’App Check console ─ */
test('non-régression : le correctif n’active PAS enforceAppCheck ailleurs ni ne touche les règles', () => {
  // Le correctif est 100% client : il ne doit rien changer au posture
  // App Check (Surveillance) ni introduire un nouveau enforceAppCheck côté client.
  // On interdit l'ASSIGNATION d'une option enforceAppCheck côté client
  // (config d'appel), pas la simple mention du mot dans un commentaire.
  assert.ok(!/enforceAppCheck\s*[:=]/.test(auth), 'auth.js ne doit pas configurer enforceAppCheck');
  assert.ok(!/enforceAppCheck\s*[:=]/.test(db), 'db.js ne doit pas configurer enforceAppCheck');
});
