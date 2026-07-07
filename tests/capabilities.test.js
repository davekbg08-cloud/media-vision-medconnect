/* =====================================================
   Tests — HospitalCapabilities (sécurité des rôles)
   Le cœur du contrôle d'accès : ces tests garantissent
   qu'un rôle ne peut pas outrepasser ses droits. Une
   régression ici serait une faille de sécurité médicale.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const { loadIntoWindow } = require('./helper');

const win = loadIntoWindow(['js/hospital-capabilities.js']);
const CAP = win.HospitalCapabilities;

test('le module se charge et expose can()', () => {
  assert.ok(CAP, 'HospitalCapabilities doit être exporté');
  assert.strictEqual(typeof CAP.can, 'function');
});

test('un laborantin NE PEUT PAS prescrire', () => {
  assert.strictEqual(CAP.can('lab', 'prescribe'), false);
});

test('un laborantin NE PEUT PAS décider un transfert médical', () => {
  assert.strictEqual(CAP.can('lab', 'decide_transfer'), false);
});

test('un laborantin NE PEUT PAS admettre un patient', () => {
  assert.strictEqual(CAP.can('lab', 'admit_patient'), false);
});

test('un laborantin PEUT saisir un résultat de labo (son métier)', () => {
  assert.strictEqual(CAP.can('lab', 'enter_lab_result'), true);
});

test('un médecin PEUT prescrire', () => {
  assert.strictEqual(CAP.can('doctor', 'prescribe'), true);
});

test('un médecin PEUT décider un transfert', () => {
  assert.strictEqual(CAP.can('doctor', 'decide_transfer'), true);
});

test('un infirmier NE PEUT PAS prescrire', () => {
  assert.strictEqual(CAP.can('nurse', 'prescribe'), false);
});

test('un infirmier NE PEUT PAS décider un transfert', () => {
  assert.strictEqual(CAP.can('nurse', 'decide_transfer'), false);
});

test('un infirmier PEUT admettre / gérer les soins', () => {
  assert.strictEqual(CAP.can('nurse', 'admit_patient'), true);
});

test('la réception PEUT créer un patient mais PAS prescrire', () => {
  assert.strictEqual(CAP.can('reception', 'create_patient'), true);
  assert.strictEqual(CAP.can('reception', 'prescribe'), false);
  assert.strictEqual(CAP.can('reception', 'decide_transfer'), false);
});

test('la pharmacie PEUT délivrer mais PAS prescrire', () => {
  assert.strictEqual(CAP.can('pharmacist', 'dispense'), true);
  assert.strictEqual(CAP.can('pharmacist', 'prescribe'), false);
});

test("l'admin plateforme peut tout", () => {
  assert.strictEqual(CAP.can('admin', 'prescribe'), true);
  assert.strictEqual(CAP.can('admin', 'decide_transfer'), true);
  assert.strictEqual(CAP.can('admin', 'dispense'), true);
});

test('un rôle inconnu ne peut rien', () => {
  assert.strictEqual(CAP.can('inconnu', 'prescribe'), false);
  assert.strictEqual(CAP.can('', 'view_patient'), false);
  assert.strictEqual(CAP.can(null, 'view_patient'), false);
});

test('une action inconnue est refusée', () => {
  assert.strictEqual(CAP.can('doctor', 'action_bidon'), false);
});

test('accessLevel retourne un libellé pour chaque rôle', () => {
  ['admin_hospital','doctor','nurse','lab','reception','pharmacist'].forEach(r => {
    assert.strictEqual(typeof CAP.accessLevel(r), 'string');
    assert.ok(CAP.accessLevel(r).length > 0);
  });
});
