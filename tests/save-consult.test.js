/* =====================================================
   Tests — saveConsult : ordre création / fermeture modale
   Verrouille le correctif du bug : App.closeModal() était
   appelé AVANT DB.addPrescription(), qui lisait ensuite des
   champs de formulaire déjà détruits (null.value → erreur),
   d'où l'ordonnance jamais créée.
   Test structurel (analyse du source de js/hospital.js), car
   saveConsult dépend du DOM.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital.js'), 'utf8');

// Isole le corps de saveConsult (de sa déclaration jusqu'à la
// déclaration de fonction suivante au même niveau).
function saveConsultBody() {
  const start = src.indexOf('function saveConsult(');
  assert.ok(start >= 0, 'saveConsult doit exister');
  // Prochaine déclaration de fonction au même niveau d'indentation
  // (2 espaces) après le début de saveConsult.
  const rest = src.slice(start + 20);
  const m = rest.match(/\n  function \w/);
  const end = m ? start + 20 + m.index : src.length;
  return src.slice(start, end);
}

test('saveConsult lit les champs du formulaire AVANT closeModal', () => {
  const body = saveConsultBody();
  const idxClose = body.indexOf('App.closeModal()');
  const idxDate = body.indexOf("getElementById('c-date')");
  const idxDoc = body.indexOf("getElementById('c-doc')");
  assert.ok(idxClose > 0, 'closeModal doit être présent');
  assert.ok(idxDate > 0 && idxDate < idxClose, 'c-date lu avant closeModal');
  assert.ok(idxDoc > 0 && idxDoc < idxClose, 'c-doc lu avant closeModal');
});

test('saveConsult ne lit AUCUN champ de formulaire après closeModal', () => {
  const body = saveConsultBody();
  const idxClose = body.indexOf('App.closeModal()');
  const apres = body.slice(idxClose);
  assert.ok(!/getElementById\(/.test(apres),
    'aucun getElementById ne doit apparaître après closeModal dans saveConsult');
});

test('saveConsult crée la consultation ET (si médicaments) l\'ordonnance', () => {
  const body = saveConsultBody();
  assert.match(body, /DB\.addConsultation\(/, 'doit créer la consultation');
  assert.match(body, /DB\.addPrescription\(/, 'doit créer l\'ordonnance');
  // addPrescription doit être gardé par une vérification meds.length.
  const idxCond = body.indexOf('meds.length)');
  const idxRx = body.indexOf('DB.addPrescription(');
  assert.ok(idxCond > 0, 'une condition meds.length doit exister');
  assert.ok(idxRx > idxCond, 'addPrescription doit suivre la condition meds.length');
});

test('les médicaments vides sont filtrés (consultation sans ordonnance possible)', () => {
  const body = saveConsultBody();
  assert.match(body, /filter\(m => m\.name\?\.trim\(\)\)/,
    'les lignes médicament vides doivent être filtrées');
});
