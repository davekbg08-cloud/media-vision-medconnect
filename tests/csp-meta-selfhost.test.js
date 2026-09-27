/* =====================================================
   Tests — CSP en balise meta + bibliothèques auto-hébergées

   GitHub Pages (servi à l'APK) ne permet aucun en-tête HTTP : la CSP est
   donc aussi déclarée dans index.html. Leaflet et html5-qrcode sont
   hébergés dans vendor/ : plus aucun script chargé depuis unpkg.com.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function hostingCsp() {
  const cfg = JSON.parse(read('firebase.json'));
  const all = cfg.hosting.headers.find((h) => h.source === '**').headers;
  return all.find((h) => h.key === 'Content-Security-Policy').value;
}

function metaCsp() {
  const html = read('index.html');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(m, 'index.html doit déclarer une CSP en balise meta');
  return m[1];
}

test('la CSP meta de index.html = CSP Firebase Hosting (hors frame-ancestors)', () => {
  const expected = hostingCsp().replace("; frame-ancestors 'none'", '');
  assert.strictEqual(metaCsp(), expected);
  assert.ok(!metaCsp().includes('frame-ancestors'), 'frame-ancestors est ignoré en meta');
});

test('la balise meta CSP est placée tout en haut du <head>', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'),
    'la CSP doit précéder tout script');
});

test('plus aucune ressource chargée depuis unpkg.com', () => {
  for (const f of ['index.html', 'sw.js', 'js/map.js', 'js/share.js']) {
    assert.ok(!read(f).includes('unpkg.com'), `${f} ne doit plus référencer unpkg.com`);
  }
});

test('Leaflet et html5-qrcode sont présents dans vendor/', () => {
  for (const f of [
    'vendor/leaflet/1.9.4/leaflet.js',
    'vendor/leaflet/1.9.4/leaflet.css',
    'vendor/leaflet/1.9.4/images/marker-icon.png',
    'vendor/html5-qrcode/2.3.8/html5-qrcode.min.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} manquant`);
  }
  assert.match(read('js/map.js'), /\.\/vendor\/leaflet\/1\.9\.4\/leaflet\.js/);
  assert.match(read('js/share.js'), /\.\/vendor\/html5-qrcode\/2\.3\.8\/html5-qrcode\.min\.js/);
});

test("pas d'unsafe-eval, object-src 'none', base-uri 'self'", () => {
  const csp = metaCsp();
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'self'"));
});
