/* =====================================================
   Tests — Socle visuel de la refonte (icônes + couleurs)
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function loadIcons() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read('js/icons.js'), ctx);
  return ctx.window.McIcons;
}

test('chaque rubrique de navigation a une icône présente dans le sprite', () => {
  const icons = loadIcons();
  const sprite = read('vendor/icons/medconnect-icons.svg');
  for (const [section, [name, tint]] of Object.entries(icons.SECTIONS)) {
    assert.ok(sprite.includes(`id="i-${name}"`), `${section} : icône ${name} absente du sprite`);
    assert.match(read('css/style.css'), new RegExp(`\\.mc-tint-${tint}\\s*\\{`), `couleur ${tint} non définie`);
  }
});

test("sectionIcon renvoie une icône colorée, null si la rubrique est inconnue", () => {
  const icons = loadIcons();
  const html = icons.sectionIcon('consultations');
  assert.match(html, /mc-tint-violet/);
  assert.match(html, /#i-stethoscope/);
  assert.match(html, /aria-hidden="true"/);
  assert.strictEqual(icons.sectionIcon('inconnue'), null);
});

test("la navigation utilise les icônes, avec l'emoji en repli", () => {
  assert.match(read('js/app.js'), /window\.McIcons\?\.sectionIcon\(item\.s\) \|\| item\.icon/);
});

test('icons.js est chargé avant app.js et mis en cache hors ligne', () => {
  const html = read('index.html');
  assert.ok(html.indexOf('js/icons.js') > 0 && html.indexOf('js/icons.js') < html.indexOf('js/app.js'));
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/icons\.js'/);
  assert.match(sw, /'\.\/vendor\/icons\/medconnect-icons\.svg'/);
});

test("les couleurs de catégorie existent en thème clair et sombre", () => {
  const css = read('css/style.css');
  for (const hue of ['blue', 'violet', 'green', 'orange', 'magenta', 'aqua', 'red', 'yellow', 'gray']) {
    const count = (css.match(new RegExp(`--tint-${hue}-bg:`, 'g')) || []).length;
    assert.ok(count >= 2, `--tint-${hue}-bg doit exister en sombre et en clair`);
  }
});
