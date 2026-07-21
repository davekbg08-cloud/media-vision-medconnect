/* =====================================================
   Tests — Inscription pharmacie desktop (audit "workflows
   mobile/desktop", section 8)

   Bug confirmé : le sélecteur desktop (js/hospital-auth.js) propose
   déjà le rôle "Pharmacie" à la connexion, mais AGENT_SELF_REGISTER_ROLES
   ne listait que ['lab', 'reception'] — aucun lien d'inscription ne
   s'affichait pour pharmacist, impasse totale pour une pharmacie sans
   compte existant.

   Corrigé : pharmacist rejoint AGENT_SELF_REGISTER_ROLES (lien
   d'inscription affiché + pré-contrôle de connexion cohérent).

   v2.9.34 (règle IMPÉRATIVE pharmacie) : sur le desktop hôpital, la
   pharmacie est TOUJOURS INTERNE (service de l'établissement, tagué
   pharmacyType:'internal', affiliation hospitalMembers). Le choix
   « pharmacie indépendante » est retiré du desktop — la pharmacie
   indépendante (externe) reste exclusivement mobile. toggleAgentRegister
   ouvre donc directement le formulaire interne strict.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement(overrides = {}) {
  return Object.assign({
    value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    style: { display: 'none' },
    classList: { add(){}, remove(){}, toggle(){}, contains: () => false },
  }, overrides);
}

function setup() {
  const elements = new Map();
  const getEl = (id) => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); };
  const registrationContextCalls = [];
  const registerRoleCalls = [];
  const showAgentStrictCalls = [];

  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.Auth = {
    _setRegistrationContext: (ctx) => registrationContextCalls.push(ctx),
    _registerRole: (role) => registerRoleCalls.push(role),
    _showAgentStrictRegisterForm: (role) => showAgentStrictCalls.push(role),
  };
  sandbox.HospitalsRegistry = { getHospitalById: () => ({ establishmentId: 'EST-1', name: 'Hôpital Test', officialId: 'H1' }) };
  sandbox.App = { toast(){} };
  sandbox.document = {
    getElementById: getEl,
    addEventListener(){},
  };
  sandbox.setTimeout = () => 0;
  sandbox.setInterval = () => 0;
  sandbox.addEventListener = () => {};

  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-auth.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/hospital-auth.js' });
  return { win: sandbox.window, getEl, registrationContextCalls, registerRoleCalls, showAgentStrictCalls };
}

test("AGENT_SELF_REGISTER_ROLES inclut désormais pharmacist (source)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-auth.js'), 'utf8');
  assert.match(src, /const AGENT_SELF_REGISTER_ROLES = \['lab', 'reception', 'pharmacist'\];/);
});

test("onAgentRoleChange() affiche le lien d'inscription pour pharmacist", () => {
  const { win, getEl } = setup();
  getEl('ha-agent-role').value = 'pharmacist';
  win.HospitalAuth.onAgentRoleChange();
  assert.strictEqual(getEl('ha-agent-register-toggle').style.display, 'block');
  assert.match(getEl('ha-agent-register-hint').textContent, /pharmacie/);
});

// v2.9.34 (règle IMPÉRATIVE pharmacie) : sur desktop, la pharmacie est
// TOUJOURS interne — plus aucun choix « indépendante ». toggleAgentRegister
// ouvre donc directement le formulaire strict interne (via
// choosePharmacistRegisterType('internal')), sans jamais passer par le
// parcours registre mobile (_registerRole).
test("toggleAgentRegister() pour pharmacist ouvre directement le formulaire interne strict (plus de choix indépendante)", () => {
  const { win, getEl, registerRoleCalls, showAgentStrictCalls, registrationContextCalls } = setup();
  getEl('ha-agent-role').value = 'pharmacist';
  getEl('ha-agent-register-wrap').style.display = 'none';
  win.HospitalAuth.toggleAgentRegister(null, 'EST-1');
  assert.strictEqual(showAgentStrictCalls.length, 1, 'le formulaire interne strict doit s\'ouvrir directement');
  assert.strictEqual(showAgentStrictCalls[0], 'pharmacist');
  assert.strictEqual(registerRoleCalls.length, 0, "_registerRole (parcours mobile indépendant) ne doit jamais être appelé sur desktop");
  // Le contexte d'établissement est posé, avec pharmacyType:'internal'.
  assert.strictEqual(registrationContextCalls.length, 1);
  assert.strictEqual(registrationContextCalls[0].establishmentId, 'EST-1');
  assert.strictEqual(registrationContextCalls[0].pharmacyType, 'internal');
  // Plus aucune trace du choix « indépendante » dans l'écran.
  assert.doesNotMatch(getEl('register-form').innerHTML || '', /indépendante/i);
});

test("choosePharmacistRegisterType('internal') définit le contexte d'établissement (pharmacyType:'internal') ET affiche le formulaire strict", () => {
  const { win, registrationContextCalls, showAgentStrictCalls } = setup();
  win.HospitalAuth.choosePharmacistRegisterType('internal', 'EST-1');
  assert.strictEqual(showAgentStrictCalls.length, 1);
  assert.strictEqual(showAgentStrictCalls[0], 'pharmacist');
  assert.strictEqual(registrationContextCalls.length, 1);
  assert.strictEqual(registrationContextCalls[0].establishmentId, 'EST-1');
  assert.strictEqual(registrationContextCalls[0].pharmacyType, 'internal');
});

// v2.9.34 : l'option « indépendante » est retirée du desktop. Même si un
// gestionnaire onclick en cache appelait encore choosePharmacistRegisterType
// avec 'independent', la fonction force désormais le parcours INTERNE —
// jamais le parcours registre mobile, toujours avec un contexte
// d'établissement tagué internal.
test("choosePharmacistRegisterType('independent') est ignoré : force le parcours interne (jamais le registre mobile)", () => {
  const { win, registrationContextCalls, registerRoleCalls, showAgentStrictCalls } = setup();
  win.HospitalAuth.choosePharmacistRegisterType('independent', 'EST-1');
  assert.strictEqual(registerRoleCalls.length, 0, "le parcours registre mobile ne doit jamais être déclenché depuis le desktop");
  assert.strictEqual(showAgentStrictCalls.length, 1, 'le formulaire interne strict est ouvert quel que soit l\'argument');
  assert.strictEqual(showAgentStrictCalls[0], 'pharmacist');
  assert.strictEqual(registrationContextCalls.length, 1);
  assert.strictEqual(registrationContextCalls[0].establishmentId, 'EST-1');
  assert.strictEqual(registrationContextCalls[0].pharmacyType, 'internal');
});

test("toggleAgentRegister() pour lab/reception continue d'appeler _registerRole directement (non-régression)", () => {
  const { win, getEl, registerRoleCalls } = setup();
  getEl('ha-agent-role').value = 'lab';
  getEl('ha-agent-register-wrap').style.display = 'none';
  win.HospitalAuth.toggleAgentRegister(null, 'EST-1');
  assert.deepStrictEqual(registerRoleCalls, ['lab']);
});

/* ── js/auth.js : nouvelles fonctions (source, sans recharger tout le
   sandbox Firebase déjà couvert par tests/lab-reception-auth-flow.test.js) ── */
test("js/auth.js : _regPharmacistInternal() délègue à _regAgentStrict('pharmacist')", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');
  assert.match(src, /function _regPharmacistInternal\(\) \{ return _regAgentStrict\('pharmacist'\); \}/);
});

test("js/auth.js : AGENT_STRICT_ROLES reste ['lab', 'reception'] (le parcours mobile pharmacist indépendant n'est jamais affecté)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');
  assert.match(src, /const AGENT_STRICT_ROLES = \['lab', 'reception'\];/);
});

test("js/auth.js : _showAgentStrictRegisterForm et _regPharmacistInternal sont exportés", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');
  assert.match(src, /_regPharmacistInternal/);
  assert.match(src, /_showAgentStrictRegisterForm/);
});

// v2.9.34 : une pharmacie inscrite depuis le desktop est taguée
// pharmacyType:'internal' et exige un établissement (source).
test("js/auth.js : _regAgentStrict tague pharmacyType:'internal' et exige un établissement pour pharmacist", () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/auth.js'), 'utf8');
  assert.match(src, /account\.pharmacyType = 'internal';/);
  assert.match(src, /role === 'pharmacist' && !ctx\?\.establishmentId/);
});
