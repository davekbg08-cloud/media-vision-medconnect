'use strict';

/*
 * Vaccination v2.9.43 — rattachement patient garanti côté client.
 *
 * Contexte : la saisie soignante déplacée dans le dossier du patient OUVERT
 * (MedicalRecordDesktop), plus l'écran mobile patient-only. Ces tests
 * structurels garantissent que le code ne peut pas produire de vaccination
 * orpheline (sans patient) ni sans contexte d'établissement — les deux étant
 * de toute façon refusés par les règles Firestore (voir
 * tests/firestore-rules/mc-vaccinations-write.rules.test.js).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('medical-record-desktop : saveVaccination rattache au patient OUVERT et exige un établissement', () => {
  const src = read('js/medical-record-desktop.js');
  const start = src.indexOf('function saveVaccination(');
  assert.ok(start !== -1, 'saveVaccination doit exister');
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  // Patient = dossier ouvert (_activeId), refus si absent.
  assert.match(body, /const pid = _activeId;/, 'le patient vient du dossier ouvert (_activeId)');
  assert.match(body, /if \(!pid\)/, 'refus si aucun patient ouvert');
  assert.match(body, /patient_id: pid/, 'le patient_id est rattaché à la vaccination');
  // Établissement obligatoire (sinon règle Firestore refuse).
  assert.match(body, /currentEstablishmentFields/, "le tampon d'établissement est appliqué");
  assert.match(body, /!est\.establishmentId && !est\.hospital_id/, 'refus si aucun établissement actif');
});

test('medical-record-desktop : le bouton « Ajouter » est réservé aux rôles cliniques', () => {
  const src = read('js/medical-record-desktop.js');
  const start = src.indexOf('function renderVaccinations(');
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  assert.match(body, /\['doctor', 'nurse', 'admin'\]\.includes\(currentRole\(\)\)/, 'ajout réservé doctor/nurse/admin');
  assert.match(body, /openAddVaccination/, 'le bouton appelle openAddVaccination');
});

test('medical-record-desktop : openAddVaccination et saveVaccination sont exportés', () => {
  const src = read('js/medical-record-desktop.js');
  const exportsBlock = src.slice(src.lastIndexOf('return {'));
  assert.match(exportsBlock, /openAddVaccination/, 'openAddVaccination exporté');
  assert.match(exportsBlock, /saveVaccination/, 'saveVaccination exporté');
});

test('patient.js : saveVacc refuse une vaccination sans patient (anti-orpheline)', () => {
  const src = read('js/patient.js');
  const start = src.indexOf('function saveVacc(');
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  assert.match(body, /const pid = String\(patientId \|\| ''\)\.trim\(\);/, 'patientId normalisé');
  assert.match(body, /if \(!pid\)/, 'refus si aucun patient');
  assert.match(body, /patient_id: pid/, 'le patient_id validé est utilisé');
});

test('patient.js : l\'écran mobile Vaccinations n\'a plus de bouton d\'ajout soignant', () => {
  const src = read('js/patient.js');
  const start = src.indexOf('function renderVaccinations(');
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  // L'ancien bouton « openAddVacc('${p.id}') » dans l'en-tête est retiré :
  // la saisie soignante passe par le dossier desktop.
  assert.ok(!/openAddVacc\('\$\{p\.id\}'\)/.test(body),
    'plus de bouton d\'ajout soignant dans l\'écran mobile patient');
});
