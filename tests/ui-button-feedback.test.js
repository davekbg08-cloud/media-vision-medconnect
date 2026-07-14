/* =====================================================
   Tests — retour visuel + anti double-appui des boutons

   Demande client : TOUS les boutons doivent réagir visiblement à
   l'appui (l'utilisateur sait que son action est passée) et ne jamais
   déclencher deux fois la même action sur un double appui.

   Deux niveaux :
   1. UNIVERSEL — js/button-feedback.js : classe .btn-pressed (retour
      visuel) + fenêtre de garde qui avale un second clic sur le même
      bouton (capture, stopImmediatePropagation + preventDefault),
      SANS jamais toucher à button.disabled (aucun conflit avec les
      systèmes dédiés existants : setBusy, setSubmitting…).
   2. DÉDIÉ — verrous forts sur les actions critiques longues :
      admin (validateEstablishment, activateSubscription,
      deactivateSubscription), inscriptions labo/réception
      (auth-ui-cleanup), flux de création desktop (réception,
      urgences, maternité), nouveau patient (hospital.js — bouton
      désactivé AVANT le premier await, pas après).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

/* ── 1. Mécanisme universel ── */

test('button-feedback.js : garde en phase de capture, avale le double appui, ne touche jamais à disabled', () => {
  const src = read('js/button-feedback.js');
  assert.match(src, /addEventListener\('click', onCaptureClick, true\)/, 'écoute en phase de CAPTURE (passe avant les onclick inline)');
  assert.match(src, /stopImmediatePropagation\(\)/, 'un double appui doit être avalé avant le handler du bouton');
  assert.match(src, /preventDefault\(\)/, "l'action par défaut (submit) doit aussi être bloquée");
  assert.match(src, /btn-pressed/, 'le retour visuel .btn-pressed doit être posé');
  assert.ok(!/\.disabled\s*=/.test(src), 'ne doit JAMAIS écrire button.disabled (conflit avec setBusy/setSubmitting)');
});

test('button-feedback.js est chargé par index.html (tôt) et précaché par le service worker', () => {
  assert.match(read('index.html'), /js\/button-feedback\.js/, 'index.html doit charger le module');
  assert.match(read('sw.js'), /\.\/js\/button-feedback\.js/, 'sw.js doit le précacher');
});

test('css/style.css définit le retour visuel .btn-pressed', () => {
  const css = read('css/style.css');
  assert.match(css, /\.btn-pressed\s*\{/, 'la classe .btn-pressed doit exister');
  assert.match(css, /btn-press-pulse/, "l'animation d'appui doit exister");
});

/* ── 2. Verrous dédiés des actions critiques ── */

test('auth-ui-cleanup couvre désormais _regLab et _regReception (anti double inscription)', () => {
  const src = read('js/auth-ui-cleanup.js');
  assert.match(src, /wrapAction\('_regLab'/, '_regLab doit être protégé');
  assert.match(src, /wrapAction\('_regReception'/, '_regReception doit être protégé');
});

test('boutons administrateur : validateEstablishment / activateSubscription / deactivateSubscription ont un verrou de réentrance', () => {
  const registry = read('js/hospitals_registry.js');
  assert.match(registry, /let _validateBusy = false;/, 'verrou validateEstablishment');
  assert.match(registry, /if \(_validateBusy\) return;/, 'garde en tête de validateEstablishment');
  const admin = read('js/admin.js');
  assert.match(admin, /let _subActionBusy = false;/, 'verrou activation/désactivation abonnement');
  const activateIdx = admin.indexOf('async function activateSubscription(');
  const deactivateIdx = admin.indexOf('async function deactivateSubscription(');
  assert.ok(admin.indexOf('if (_subActionBusy) return;', activateIdx) > activateIdx, 'garde dans activateSubscription');
  assert.ok(admin.indexOf('if (_subActionBusy) return;', deactivateIdx) > deactivateIdx, 'garde dans deactivateSubscription');
});

for (const [label, file, flag] of [
  ['réception saveIntake', 'js/hospital-reception.js', '_savingIntake'],
  ['urgences saveIntake', 'js/hospital-emergency.js', '_savingIntake'],
  ['maternité saveNew', 'js/hospital-maternity.js', '_savingNew'],
  // Audit (2.9.22) : tous les créateurs de données async restants.
  ['consultation saveConsult', 'js/hospital.js', '_savingConsult'],
  ['admission saveAdmission', 'js/hospital-beds.js', '_savingAdmission'],
  ['labo saveOrder', 'js/hospital-lab.js', '_savingOrder'],
  ['labo saveResult', 'js/hospital-lab.js', '_savingResult'],
  ['rendez-vous save', 'js/appointments.js', '_savingApt'],
  ['connexion établissement login', 'js/hospital-auth.js', '_loggingIn'],
  ['inscription établissement register', 'js/hospital-auth.js', '_registering'],
]) {
  test(`${label} : verrou de réentrance (${flag}) posé et relâché dans finally`, () => {
    const src = read(file);
    assert.match(src, new RegExp(`let ${flag} = false;`), `déclaration du verrou ${flag}`);
    assert.match(src, new RegExp(`if \\(${flag}\\) return;`), 'garde en tête');
    assert.match(src, new RegExp(`finally \\{ ${flag} = false; \\}`), 'relâché dans finally (jamais bloqué)');
  });
}

test('connexion administrateur (_doAdmin) : bouton verrouillé AVANT le premier await, libéré en cas d\'échec', () => {
  const src = read('js/auth.js');
  const start = src.indexOf('async function _doAdmin(');
  const end = src.indexOf('function _launch(', start);
  const body = src.slice(start, end);
  const disableIdx = body.indexOf('submitBtn.disabled = true');
  // Premier await RÉEL (pas le mot « await » d'un commentaire) : le
  // nettoyage de session puis la connexion Firebase.
  const firstAwaitIdx = body.indexOf('await firebaseAuth');
  assert.ok(disableIdx !== -1, 'le bouton doit être désactivé');
  assert.ok(firstAwaitIdx !== -1, 'la connexion Firebase doit être awaitée');
  assert.ok(disableIdx < firstAwaitIdx, 'la désactivation doit précéder le premier await (couvre clic ET touche Entrée)');
  assert.match(body, /if \(submitBtn\?\.disabled\) return;/, 'une seconde soumission pendant la connexion doit être ignorée');
  assert.match(body, /finally \{/, 'le verrou doit être libéré dans finally');
  assert.match(body, /submitBtn\.disabled = false/, "le bouton doit redevenir utilisable après un échec");
});

test('saveNewPatient (hospital.js) : le bouton est désactivé AVANT le premier await (contrôle d\'abonnement)', () => {
  const src = read('js/hospital.js');
  const start = src.indexOf('async function saveNewPatient(');
  const body = src.slice(start, src.indexOf('DB.addPatientAndConfirm(', start));
  const disableIdx = body.indexOf('submitBtn.disabled = true');
  const subIdx = body.indexOf("requireWritableSubscription('create_patient')");
  assert.ok(disableIdx !== -1 && subIdx !== -1, 'les deux étapes doivent exister');
  assert.ok(disableIdx < subIdx, 'la désactivation doit précéder le premier await — sinon fenêtre de double-clic');
  assert.match(body, /if \(submitBtn\?\.disabled\) return;/, 'un second appel pendant le traitement doit être ignoré');
  // Le chemin bloqué (abonnement expiré) doit réactiver le bouton.
  assert.match(body, /submitBtn\.disabled = false/, 'le bouton doit être réactivé si le contrôle bloque');
});
