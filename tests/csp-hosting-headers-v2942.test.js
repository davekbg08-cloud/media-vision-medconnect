'use strict';

/*
 * CSP Hosting v2.9.42 — verrou du contrat de la Content-Security-Policy servie
 * par Firebase Hosting (firebase.json).
 *
 * Contexte : la CSP passe de `Content-Security-Policy-Report-Only` (observation)
 * à `Content-Security-Policy` (BLOQUANTE). Ces tests garantissent que la
 * politique bloquante reste COMPLÈTE : tout hôte réellement utilisé par l'app
 * doit y figurer, sinon la fonctionnalité correspondante casserait en prod.
 *
 * Rappel d'architecture (audité) :
 *  - Scripts externes : Firebase SDK (gstatic), Leaflet + html5-qrcode (unpkg),
 *    reCAPTCHA Enterprise / App Check (google.com, recaptcha.net).
 *  - Styles externes : Leaflet CSS (unpkg), Google Fonts CSS (fonts.googleapis).
 *  - Polices : Google Fonts (fonts.gstatic).
 *  - Images externes : tuiles OpenStreetMap, QR codes (api.qrserver.com).
 *  - connect (fetch/XHR) : Firebase (*.googleapis, *.cloudfunctions, *.run.app),
 *    Claude API (api.anthropic.com), littérature EuropePMC (www.ebi.ac.uk),
 *    POI carte (overpass-api.de).
 *  - iframes : reCAPTCHA (google.com, recaptcha.net).
 *
 * NB volontaire : `script-src` conserve `'unsafe-inline'`. L'app repose sur un
 * `<script>` inline dans index.html et ~276 gestionnaires `onclick=` inline ;
 * les bloquer casserait toute l'UI. Le durcissement porte donc sur la
 * restriction des HÔTES + object-src/base-uri/form-action/frame-ancestors,
 * pas sur le blocage des scripts inline (cf. suivi : refactor délégation
 * d'événements pour retirer 'unsafe-inline' ultérieurement).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const firebaseJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8')
);

function cspHeader() {
  const headerSet = firebaseJson.hosting.headers.find(h => h.source === '**');
  assert.ok(headerSet, 'Un bloc de headers "source: **" doit exister.');
  const csp = headerSet.headers.find(h => /^Content-Security-Policy/.test(h.key));
  assert.ok(csp, 'Un header Content-Security-Policy doit être présent.');
  return csp;
}

// Découpe la CSP en map { directive: [valeurs...] }.
function parseCsp(value) {
  const out = {};
  for (const part of value.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const [name, ...vals] = seg.split(/\s+/);
    out[name] = vals;
  }
  return out;
}

test('CSP : header en mode BLOQUANT (plus Report-Only)', () => {
  const csp = cspHeader();
  assert.strictEqual(
    csp.key,
    'Content-Security-Policy',
    'La CSP doit être bloquante (clé "Content-Security-Policy"), pas "-Report-Only".'
  );
});

test('CSP : default-src verrouillé sur self', () => {
  const d = parseCsp(cspHeader().value);
  assert.deepStrictEqual(d['default-src'], ["'self'"]);
});

test('CSP : script-src couvre les hôtes de scripts réels et garde unsafe-inline', () => {
  const d = parseCsp(cspHeader().value);
  const s = d['script-src'];
  assert.ok(s, 'script-src doit exister.');
  // 'unsafe-inline' est REQUIS (script inline + onclick= inline). Verrouillé
  // pour éviter qu'un retrait accidentel ne casse toute l'UI.
  assert.ok(s.includes("'self'"), "script-src doit inclure 'self'.");
  assert.ok(s.includes("'unsafe-inline'"), "script-src doit garder 'unsafe-inline' (handlers inline).");
  for (const host of [
    'https://www.gstatic.com',   // Firebase SDK
    'https://unpkg.com',         // Leaflet / html5-qrcode
    'https://www.google.com',    // reCAPTCHA Enterprise
    'https://www.recaptcha.net'  // reCAPTCHA fallback
  ]) {
    assert.ok(s.includes(host), `script-src doit inclure ${host}.`);
  }
  // Jamais d'unsafe-eval : aucun eval/new Function dans le code.
  assert.ok(!s.includes("'unsafe-eval'"), "script-src ne doit PAS contenir 'unsafe-eval'.");
});

test('CSP : style-src couvre unpkg + Google Fonts CSS', () => {
  const d = parseCsp(cspHeader().value);
  const s = d['style-src'];
  assert.ok(s.includes("'self'") && s.includes("'unsafe-inline'"));
  assert.ok(s.includes('https://unpkg.com'), 'style-src doit inclure unpkg (Leaflet CSS).');
  assert.ok(s.includes('https://fonts.googleapis.com'), 'style-src doit inclure Google Fonts CSS.');
});

test('CSP : font-src couvre Google Fonts (gstatic)', () => {
  const d = parseCsp(cspHeader().value);
  assert.ok(d['font-src'].includes('https://fonts.gstatic.com'), 'font-src doit inclure fonts.gstatic.com.');
});

test('CSP : img-src couvre tuiles carte + QR codes + data:', () => {
  const d = parseCsp(cspHeader().value);
  const s = d['img-src'];
  assert.ok(s.includes("'self'"));
  assert.ok(s.includes('data:'), 'img-src doit inclure data:.');
  assert.ok(s.includes('https://*.tile.openstreetmap.org'), 'img-src doit inclure les tuiles OSM.');
  assert.ok(s.includes('https://api.qrserver.com'), 'img-src doit inclure api.qrserver.com (QR ordonnances).');
});

test('CSP : connect-src couvre Firebase + Claude + EuropePMC + Overpass', () => {
  const d = parseCsp(cspHeader().value);
  const s = d['connect-src'];
  for (const host of [
    "'self'",
    'https://*.googleapis.com',      // Firestore, FCM, App Check, Auth, installations
    'https://*.cloudfunctions.net',  // Cloud Functions callable
    'https://*.run.app',             // Cloud Functions v2 (Cloud Run)
    'https://api.anthropic.com',     // IA médicale (js/medical-ai.js)
    'https://www.ebi.ac.uk',         // recherche littérature EuropePMC
    'https://overpass-api.de'        // POI carte (js/map.js)
  ]) {
    assert.ok(s.includes(host), `connect-src doit inclure ${host}.`);
  }
});

test('CSP : frame-src limité à reCAPTCHA', () => {
  const d = parseCsp(cspHeader().value);
  const s = d['frame-src'];
  assert.ok(s.includes('https://www.google.com'), 'frame-src doit inclure google.com (iframe reCAPTCHA).');
  // Aucun autre hôte d'iframe ne doit se glisser sans revue.
  for (const host of s) {
    assert.ok(
      /^https:\/\/(www\.google\.com|www\.recaptcha\.net)$/.test(host),
      `frame-src contient un hôte inattendu : ${host}`
    );
  }
});

test('CSP : directives de durcissement présentes', () => {
  const d = parseCsp(cspHeader().value);
  assert.deepStrictEqual(d['object-src'], ["'none'"], "object-src doit être 'none'.");
  assert.deepStrictEqual(d['base-uri'], ["'self'"], "base-uri doit être 'self'.");
  assert.deepStrictEqual(d['form-action'], ["'self'"], "form-action doit être 'self'.");
  assert.deepStrictEqual(d['frame-ancestors'], ["'none'"], "frame-ancestors doit être 'none' (anti-clickjacking).");
  assert.deepStrictEqual(d['worker-src'], ["'self'"], "worker-src doit être 'self' (service worker).");
  assert.deepStrictEqual(d['manifest-src'], ["'self'"], "manifest-src doit être 'self' (PWA).");
});

test('CSP : les autres en-têtes de sécurité restent posés', () => {
  const headerSet = firebaseJson.hosting.headers.find(h => h.source === '**');
  const keys = headerSet.headers.map(h => h.key);
  for (const k of [
    'X-Content-Type-Options',
    'Referrer-Policy',
    'X-Frame-Options',
    'Strict-Transport-Security',
    'Permissions-Policy'
  ]) {
    assert.ok(keys.includes(k), `Le header ${k} doit rester présent.`);
  }
});
