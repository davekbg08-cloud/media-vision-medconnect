/* =====================================================
   Tests — Inscription pharmacie desktop (audit "workflows
   mobile/desktop", section 8)

   Bug confirmé : le sélecteur desktop (js/hospital-auth.js) propose
   déjà le rôle "Pharmacie" à la connexion, mais AGENT_SELF_REGISTER_ROLES
   ne listait que ['lab', 'reception'] — aucun lien d'inscription ne
   s'affichait pour pharmacist, impasse totale pour une pharmacie sans
   compte existant.

   Corrigé : pharmacist rejoint AGENT_SELF_REGISTER_ROLES (lien
   d'inscription affiché + pré-contrôle de connexion cohérent), avec un
   choix explicite avant l'inscription (interne à cet établissement —
   flux strict, comme lab/reception — ou indépendante — parcours
   registre existant, JAMAIS de hospitalMembers/affiliation créés
   automatiquement pour ce second cas).
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

test("toggleAgentRegister() pour pharmacist affiche le choix interne/indépendante, jamais directement _registerRole", () => {
  const { win, getEl, registerRoleCalls, showAgentStrictCalls } = setup();
  getEl('ha-agent-role').value = 'pharmacist';
  getEl('ha-agent-register-wrap').style.display = 'none';
  win.HospitalAuth.toggleAgentRegister(null, 'EST-1');
  assert.match(getEl('register-form').innerHTML, /Service pharmacie de cet établissement/);
  assert.match(getEl('register-form').innerHTML, /Pharmacie indépendante/);
  assert.strictEqual(registerRoleCalls.length, 0, "_registerRole ne doit pas être appelé avant le choix explicite");
  assert.strictEqual(showAgentStrictCalls.length, 0);
});

test("choosePharmacistRegisterType('internal') définit le contexte d'établissement ET affiche le formulaire strict", () => {
  const { win, registrationContextCalls, showAgentStrictCalls } = setup();
  win.HospitalAuth.choosePharmacistRegisterType('internal', 'EST-1');
  assert.strictEqual(showAgentStrictCalls.length, 1);
  assert.strictEqual(showAgentStrictCalls[0], 'pharmacist');
  assert.strictEqual(registrationContextCalls.length, 1);
  assert.strictEqual(registrationContextCalls[0].establishmentId, 'EST-1');
});

test("choosePharmacistRegisterType('independent') N'ENVOIE AUCUN contexte d'établissement (pas d'affiliation automatique)", () => {
  const { win, registrationContextCalls, registerRoleCalls } = setup();
  win.HospitalAuth.choosePharmacistRegisterType('independent', 'EST-1');
  assert.strictEqual(registerRoleCalls.length, 1);
  assert.strictEqual(registerRoleCalls[0], 'pharmacist');
  assert.strictEqual(registrationContextCalls.length, 1);
  assert.strictEqual(registrationContextCalls[0], null, "la pharmacie indépendante ne doit jamais recevoir de contexte d'établissement");
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
