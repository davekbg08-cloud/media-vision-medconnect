/* =====================================================
   Tests — atterrissage par rôle après connexion desktop hôpital
   (retour utilisateur : "tous ouvrent sur le même Dashboard")

   Avant ce correctif, HospitalDesktopUI.openForSession()/open()
   appelaient toujours navigate('dashboard') quel que soit le rôle —
   un réceptionniste ou un laborantin atterrissait donc sur le même
   écran générique (vue d'ensemble hôpital + raccourcis Admissions/
   Laboratoire) qu'un médecin. Verrouille : les rôles à usage unique
   (réception, laboratoire, pharmacie) atterrissent sur LEUR module ;
   les rôles à vue d'ensemble (médecin, infirmier(ère), admin_hospital,
   admin) continuent sur le Tableau de bord.

   js/hospital-desktop-ui.js dépend de trop de modules desktop (CloudDB,
   HospitalPermissions, ExchangeBridge, HospitalBedsModule...) pour une
   exécution complète en sandbox — verrouillé par lecture de source,
   comme tests/hospital-lab-patient-sync.test.js pour le même dépôt.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-desktop-ui.js'), 'utf8');

test('defaultRouteFor() envoie réception/laboratoire/pharmacie vers LEUR module', () => {
  assert.match(src, /function defaultRouteFor\(role\)/);
  const start = src.indexOf('const DEFAULT_ROUTE_BY_ROLE');
  const end = src.indexOf('function defaultRouteFor');
  const mapBlock = src.slice(start, end);
  assert.match(mapBlock, /reception:\s*'reception'/);
  assert.match(mapBlock, /lab:\s*'lab'/);
  assert.match(mapBlock, /pharmacist:\s*'pharmacy'/);
});

test("defaultRouteFor() retombe sur 'dashboard' pour les rôles à vue d'ensemble (médecin, infirmier, admin_hospital, admin — absents de la table)", () => {
  const start = src.indexOf('const DEFAULT_ROUTE_BY_ROLE');
  const end = src.indexOf('function defaultRouteFor');
  const mapBlock = src.slice(start, end);
  for (const role of ['doctor', 'nurse', 'admin_hospital', 'admin']) {
    assert.ok(!new RegExp(`${role}:`).test(mapBlock), `${role} ne doit pas avoir d'entrée dédiée (repli sur 'dashboard')`);
  }
  assert.match(src, /return DEFAULT_ROUTE_BY_ROLE\[role\] \|\| 'dashboard';/);
});

test("openForSession() n'ouvre plus systématiquement sur navigate('dashboard') — utilise defaultRouteFor(agent.role)", () => {
  const start = src.indexOf('async function openForSession(');
  const end = src.indexOf('\n  /* ── Verrou', start);
  const body = src.slice(start, end);
  assert.match(body, /navigate\(defaultRouteFor\(agent\.role\)\)/);
  assert.ok(!/navigate\('dashboard'\)/.test(body), "openForSession() ne doit plus forcer 'dashboard' pour tous les rôles");
});

test("open() (mode hybride mobile→desktop) utilise aussi defaultRouteFor(user.role)", () => {
  const start = src.indexOf('function open() {');
  const end = src.indexOf('\n  function close()', start);
  const body = src.slice(start, end);
  assert.match(body, /navigate\(defaultRouteFor\(user\.role\)\)/);
});
