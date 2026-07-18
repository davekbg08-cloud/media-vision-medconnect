/* =====================================================
   Tests — correctifs de l'audit minutieux du 2026-07-18 (hors règles
   Firestore, couvertes séparément dans tests/firestore-rules/) :

   - sw.js : doublon hospital-auth.js dans le précache (cassait TOUT le
     mode hors-ligne) + hospital-emergency.js/hospital-maternity.js
     manquants.
   - hd_records et 4 libellés de menu non traduits (hospital-i18n.js /
     hospital-permissions.js).
   - _sessionRole jamais initialisé sur le chemin open() (lanceur mobile
     hybride) — cassait le bouton de transfert.
   - Race condition : le bouton "← Retour" du sélecteur d'agent
     n'annulait pas un verifyAgent() encore en vol.
   - Badge "non lu" (Network.getUnread) ignorant les messages supprimés
     (deletedFor).
   - Gating d'abonnement jamais appliqué à l'approbation d'affiliation
     (add_member).
   - mc_user_backup (localStorage) jamais nettoyé par les déconnexions
     desktop.
   - I18n.setLang() reproduisant le bug #auth-screen déjà corrigé
     ailleurs (dormant, pas de sélecteur de langue desktop actuellement).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function readSrc(rel) {
  return fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
}

function bodyOf(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `marqueur introuvable : ${marker}`);
  const end = src.indexOf('\n  }', start);
  return src.slice(start, end);
}

/* ── sw.js : précache ── */

test('sw.js : aucune entrée dupliquée dans le tableau ASSETS (Cache.addAll rejette tout en cas de doublon)', () => {
  const src = readSrc('sw.js');
  const start = src.indexOf('const ASSETS = [');
  const end = src.indexOf('\n];', start);
  const body = src.slice(start, end)
    .split('\n')
    .filter(l => !l.trim().startsWith('//'));
  const entries = [...body.join('\n').matchAll(/'([^']+)'/g)].map(m => m[1]);
  const seen = new Set();
  const dupes = entries.filter(e => (seen.has(e) ? true : (seen.add(e), false)));
  assert.deepStrictEqual(dupes, [], `entrées dupliquées dans ASSETS : ${dupes.join(', ')}`);
});

test('sw.js : hospital-emergency.js et hospital-maternity.js sont bien précachés (chargés par index.html)', () => {
  const src = readSrc('sw.js');
  assert.match(src, /'\.\/js\/hospital-emergency\.js'/);
  assert.match(src, /'\.\/js\/hospital-maternity\.js'/);
});

test('index.html et sw.js chargent/précachent exactement le même ensemble de scripts js/*.js', () => {
  const indexSrc = readSrc('index.html');
  const swSrc = readSrc('sw.js');
  const idxScripts = new Set([...indexSrc.matchAll(/src="js\/([a-zA-Z0-9_.-]+\.js)"/g)].map(m => m[1]));
  const swStart = swSrc.indexOf('const ASSETS = [');
  const swEnd = swSrc.indexOf('\n];', swStart);
  const swBody = swSrc.slice(swStart, swEnd);
  const swScripts = new Set([...swBody.matchAll(/'\.\/js\/([a-zA-Z0-9_.-]+\.js)'/g)].map(m => m[1]));
  const missingFromSw = [...idxScripts].filter(s => !swScripts.has(s));
  assert.deepStrictEqual(missingFromSw, [], `scripts chargés par index.html mais absents du précache sw.js : ${missingFromSw.join(', ')}`);
});

/* ── hospital-i18n.js / hospital-permissions.js : libellés ── */

test("hospital-i18n.js : hd_records et les 4 nouvelles clés de menu (reception/prescriptions/emergency/maternity) existent", () => {
  const src = readSrc('js/hospital-i18n.js');
  for (const key of ['hd_records', 'hd_reception', 'hd_prescriptions', 'hd_emergency', 'hd_maternity']) {
    assert.match(src, new RegExp(`${key}:\\s*\\{`), `clé i18n manquante : ${key}`);
  }
});

test("hospital-permissions.js : visibleMenuFor() n'a plus aucun libellé français codé en dur pour reception/prescriptions/emergency/maternity", () => {
  const src = readSrc('js/hospital-permissions.js');
  const body = bodyOf(src, 'function visibleMenuFor(role)');
  assert.doesNotMatch(body, /label:'Réception \/ Accueil'/);
  assert.doesNotMatch(body, /label:'Ordonnances'/);
  assert.doesNotMatch(body, /label:'Urgences'/);
  assert.doesNotMatch(body, /label:'Maternité'/);
  assert.match(body, /L\('hd_reception'\)/);
  assert.match(body, /L\('hd_prescriptions'\)/);
  assert.match(body, /L\('hd_emergency'\)/);
  assert.match(body, /L\('hd_maternity'\)/);
  assert.match(body, /L\('hd_records'\)/);
});

/* ── hospital-desktop-ui.js : _sessionRole / gardes de route ── */

test("hospital-desktop-ui.js : open() initialise désormais _sessionRole (comme openForSession())", () => {
  const src = readSrc('js/hospital-desktop-ui.js');
  const body = bodyOf(src, 'function open() {');
  assert.match(body, /_sessionRole = user\.role;/);
});

test('hospital-desktop-ui.js : renderPatientsByYear() et renderAffiliatedStaff() vérifient désormais requireRoute()', () => {
  const src = readSrc('js/hospital-desktop-ui.js');
  const patientsBody = bodyOf(src, 'function renderPatientsByYear(container)');
  assert.match(patientsBody, /HospitalPermissions\.requireRoute\('patients'\)/);
  const staffBody = bodyOf(src, 'async function renderAffiliatedStaff(container)');
  assert.match(staffBody, /HospitalPermissions\.requireRoute\('doctors'\)/);
});

test('js/hospital.js : renderConsultations() et renderPrescriptions() vérifient désormais requireRoute()', () => {
  const src = readSrc('js/hospital.js');
  const consultBody = bodyOf(src, 'function renderConsultations(main)');
  assert.match(consultBody, /HospitalPermissions\.requireRoute\('consultations'\)/);
  const rxBody = bodyOf(src, 'function renderPrescriptions(main)');
  assert.match(rxBody, /HospitalPermissions\.requireRoute\('prescriptions'\)/);
});

test('js/pharmacy.js : renderInto() vérifie désormais requireRoute()', () => {
  const src = readSrc('js/pharmacy.js');
  const body = bodyOf(src, 'function renderInto(container, section)');
  assert.match(body, /HospitalPermissions\.requireRoute\('pharmacy'\)/);
});

test("js/hospital-beds.js : saveBed() et toggleMaintenance() vérifient désormais la capacité 'manage_beds'", () => {
  const src = readSrc('js/hospital-beds.js');
  const saveBody = bodyOf(src, 'async function saveBed()');
  assert.match(saveBody, /guardHospitalAction\?\.\('manage_beds'\)/);
  const toggleBody = bodyOf(src, 'async function toggleMaintenance(bedId)');
  assert.match(toggleBody, /guardHospitalAction\?\.\('manage_beds'\)/);
});

/* ── hospital-auth.js : race condition bouton "Retour" ── */

test("hospital-auth.js : cancelVerificationAndGoBack() marque _verifyCancelled si une vérification est en cours, puis revient à l'écran initial", () => {
  const src = readSrc('js/hospital-auth.js');
  const body = bodyOf(src, 'function cancelVerificationAndGoBack()');
  assert.match(body, /if \(_verifyingAgent\) _verifyCancelled = true;/);
  assert.match(body, /renderScreen\(\);/);
  assert.match(src, /return \{[\s\S]*cancelVerificationAndGoBack[\s\S]*\};/);
});

test("hospital-auth.js : le bouton « ← Retour » du sélecteur d'agent appelle cancelVerificationAndGoBack() (plus renderScreen() directement)", () => {
  const src = readSrc('js/hospital-auth.js');
  const body = bodyOf(src, 'function renderRolePicker(est)');
  assert.match(body, /onclick="HospitalAuth\.cancelVerificationAndGoBack\(\)"/);
});

test("hospital-auth.js : verifyAgent() réinitialise _verifyCancelled à chaque tentative et vérifie le drapeau avant d'ouvrir le tableau de bord (enter())", () => {
  const src = readSrc('js/hospital-auth.js');
  const body = bodyOf(src, 'async function verifyAgent(establishmentId)');
  assert.match(body, /_verifyCancelled = false;/);
  const enterIdx = body.indexOf('enter(establishmentId,');
  const cancelCheckIdx = body.lastIndexOf('if (_verifyCancelled) return;', enterIdx);
  assert.ok(cancelCheckIdx !== -1 && cancelCheckIdx < enterIdx,
    'le check _verifyCancelled doit précéder immédiatement l\'appel à enter()');
});

/* ── network.js : badge non-lu ignorant deletedFor ── */

test('network.js : getUnread() filtre désormais les messages supprimés (deletedFor) pour l\'utilisateur courant', () => {
  const src = readSrc('js/network.js');
  assert.match(src, /function isDeletedForUser\(message, user\)/);
  const body = bodyOf(src, 'function getUnread(role, id)');
  assert.match(body, /!isDeletedForUser\(m, user\)/);
});

/* ── hospitals_registry.js : gating d'abonnement sur add_member ── */

test("hospitals_registry.js : respondAffiliation() vérifie désormais ExchangeBridge.canWriteForHospital(..., 'add_member') avant d'approuver", () => {
  const src = readSrc('js/hospitals_registry.js');
  const body = bodyOf(src, 'async function respondAffiliation(requestId, approved, event)');
  assert.match(body, /ExchangeBridge\?\.canWriteForHospital/);
  assert.match(body, /'add_member'/);
});

/* ── mc_user_backup : nettoyage sur déconnexion desktop ── */

test('js/app.js : Auth.clearLocalBackup est exposé (purge mc_user_backup)', () => {
  const src = readSrc('js/app.js');
  assert.match(src, /Auth\.clearLocalBackup = clearBackup;/);
});

test('hospital-auth.js : invalidateSession(), _abortAgentSession() et logout() purgent désormais Auth.clearLocalBackup()', () => {
  const src = readSrc('js/hospital-auth.js');
  for (const marker of ['async function invalidateSession()', 'async function _abortAgentSession()', 'async function logout()']) {
    const body = bodyOf(src, marker);
    assert.match(body, /window\.Auth\?\.clearLocalBackup\?\.\(\)/, `${marker} doit purger le backup local`);
  }
});

/* ── i18n.js : setLang() reproduisait le pattern #auth-screen déjà corrigé ── */

test("i18n.js : setLang() consulte désormais HospitalAuth.isAgentLoginActive() avant de rediriger vers Auth.showLogin()", () => {
  const src = readSrc('js/i18n.js');
  const body = bodyOf(src, 'function setLang(lang)');
  assert.match(body, /window\.HospitalAuth\?\.isAgentLoginActive\?\.\(\)/);
  assert.match(body, /HospitalAuth\.renderScreen\(\)/);
  assert.match(body, /Auth\.showLogin\(\)/);
});
