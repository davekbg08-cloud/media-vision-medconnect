/* =====================================================
   Tests — Consentement à l'inscription (RGPD)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test("toutes les actions d'inscription exigent le consentement", () => {
  const auth = read('js/auth.js');
  for (const [fn, role] of [['_regDoctor', 'doctor'], ['_regPharmacist', 'pharmacist'], ['_regNurse', 'nurse'],
    ['_regLab', 'lab'], ['_regReception', 'reception'], ['_regPharmacistInternal', 'pharmacist']]) {
    assert.match(auth, new RegExp(`${fn}: _withConsent\\('${role}', ${fn}\\)`), fn);
  }
  assert.match(auth, /if \(!_consentAccepted\(\)\) return undefined;/);
});

test('la case de consentement est ajoutée à chaque formulaire et renvoie à la politique', () => {
  const auth = read('js/auth.js');
  assert.ok((auth.match(/_appendConsent\(\)/g) || []).length >= 4);
  assert.match(auth, /id="reg-consent"/);
  assert.match(auth, /href="privacy\.html"/);
});

test('preuve du consentement : enregistrée pour un nouveau compte uniquement, immuable', () => {
  const auth = read('js/auth.js');
  assert.match(auth, /if \(!Number\.isFinite\(created\) \|\| Date\.now\(\) - created > 120000\) return;/, 'seulement pour un compte tout juste créé');
  const rules = read('firestore.rules');
  assert.match(rules, /match \/consents\/\{uid\} \{/);
  assert.match(rules, /allow update, delete: if false;/);
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['uid', 'role', 'version', 'acceptedAt', 'userAgent'\]\)/);
});
