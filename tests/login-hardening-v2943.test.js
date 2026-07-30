'use strict';

/*
 * Connexions robustes v2.9.43 — parité desktop / mobile.
 *
 * Le même durcissement que le bouton « Accès Administrateur » est appliqué à
 * TOUTES les connexions : professionnel (médecin/infirmier/pharmacien) et
 * patient (mobile), établissement (desktop). Objectif : premier appui fiable,
 * un seul essai simultané, timeout 15 s (une connexion qui pend ne fige plus
 * le bouton), état de chargement, fermeture du clavier.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const slice = (src, from, toMarker) => {
  const i = src.indexOf(from);
  const j = toMarker ? src.indexOf(toMarker, i + from.length) : src.length;
  return src.slice(i, j === -1 ? src.length : j);
};

test('App.withTimeout existe et est exporté (borne partagée des connexions)', () => {
  const app = read('js/app.js');
  assert.match(app, /function withTimeout\(promise, ms = 15000\)/, 'helper de timeout défini');
  assert.match(app, /new Error\('timeout'\)/, 'rejette avec Error(\'timeout\')');
  assert.match(app, /setBtnLoading, withTimeout, init/, 'withTimeout exporté');
});

test('connexion professionnelle (_doProfessional) : verrou + timeout 15 s + chargement + clavier', () => {
  const src = read('js/auth.js');
  const body = slice(src, 'async function _doProfessional(', '\n  function _doDoctor');
  assert.match(src, /let _professionalBusy = false;/, 'verrou de module');
  assert.match(body, /if \(_professionalBusy\) return;/, 'un seul appel simultané');
  assert.match(body, /document\.activeElement\?\.blur/, 'clavier fermé avant connexion');
  assert.match(body, /App\.setBtnLoading\?\.\(btn, true\)/, 'état de chargement');
  assert.match(body, /App\.withTimeout\(p, 15000\)/, 'timeout 15 s sur les appels réseau');
  assert.match(body, /finally \{/, 'verrou relâché dans finally');
  assert.match(body, /_professionalBusy = false;/, 'verrou remis à zéro');
});

test('les boutons de connexion mobile passent event (pour l\'état de chargement)', () => {
  const src = read('js/auth.js');
  for (const fn of ['_doPatient', '_doDoctor', '_doPharmacist', '_doNurse']) {
    assert.match(src, new RegExp(`onclick="Auth\\.${fn}\\(event\\)"`), `${fn} reçoit event`);
  }
});

test('connexion patient (_doPatient) : wrapper durci délègue au flux, avec verrou et timeout', () => {
  const src = read('js/auth.js');
  const wrapper = slice(src, 'async function _doPatient(ev)', 'async function _doPatientFlow');
  assert.match(src, /let _patientBusy = false;/, 'verrou patient');
  assert.match(wrapper, /if \(_patientBusy\) return;/, 'un seul appel simultané');
  assert.match(wrapper, /document\.activeElement\?\.blur/, 'clavier fermé');
  assert.match(wrapper, /App\.setBtnLoading\?\.\(btn, true\)/, 'chargement');
  assert.match(wrapper, /await _doPatientFlow\(\);/, 'délègue au flux existant');
  const flow = slice(src, 'async function _doPatientFlow()', 'async function _createPatientPin');
  assert.match(flow, /App\.withTimeout \? App\.withTimeout\(p, 15000\)/, 'timeout défini');
  assert.match(flow, /await T\(_signInPatientFirebaseAuth/, 'connexion Firebase patient bornée par timeout');
});

test('connexion établissement desktop (login) : timeout + chargement, verrou déjà présent', () => {
  const src = read('js/hospital-auth.js');
  const body = slice(src, 'async function login(ev)', 'async function migrateLegacyEstablishmentAuth');
  assert.match(body, /if \(_loggingIn\) return;/, 'verrou de réentrance');
  assert.match(body, /document\.activeElement\?\.blur/, 'clavier fermé');
  assert.match(body, /App\.setBtnLoading\?\.\(_btn, true\)/, 'chargement sur le bouton');
  assert.match(body, /App\.withTimeout\(p, 15000\)/, 'timeout 15 s');
  assert.match(body, /await T\(firebaseAuth\.signInWithEmailAndPassword/, 'connexion Firebase bornée');
  assert.match(body, /finally \{ _loggingIn = false; App\.setBtnLoading\?\.\(_btn, false\); \}/, 'verrou + chargement relâchés dans finally');
});
