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
  const sprite = read('vendor/icons/medconnect-icons-v3.svg');
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
  assert.match(sw, /'\.\/vendor\/icons\/medconnect-icons-v3\.svg'/);
});

test("les couleurs de catégorie existent en thème clair et sombre", () => {
  const css = read('css/style.css');
  for (const hue of ['blue', 'violet', 'green', 'orange', 'magenta', 'aqua', 'red', 'yellow', 'gray']) {
    const count = (css.match(new RegExp(`--tint-${hue}-bg:`, 'g')) || []).length;
    assert.ok(count >= 2, `--tint-${hue}-bg doit exister en sombre et en clair`);
  }
});

test('connexion et inscription : rôle choisi dans un menu déroulant', () => {
  const auth = read('js/auth.js');
  assert.match(auth, /id="\$\{?login-role-select|id="login-role-select"/);
  assert.match(auth, /id="register-role-select"/);
  assert.match(auth, /onchange="Auth\._pickRole\('login', this\.value\)"/);
  assert.match(auth, /function _pickRole\(kind, role\)/);
  assert.match(auth, /_tab, _pickRole, _loginRole, _registerRole,/);
});

test("l'accueil affiche le logo, les atouts et la connexion (sans emoji)", () => {
  const html = read('index.html');
  const landing = html.slice(html.indexOf('<div id="landing"'), html.indexOf('<!-- MOBILE MENU -->'));
  assert.match(landing, /landing-v2-features/);
  assert.match(landing, /Auth\.showLogin\(\)/);
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(landing), "plus d'emoji sur l'accueil");
});

test("les titres de page reçoivent l'icône colorée de leur rubrique", () => {
  const icons = read('js/icons.js');
  assert.match(icons, /function decoratePageHeader\(root\)/);
  assert.match(icons, /new MutationObserver/);
  assert.match(read('css/style.css'), /\.mc-page-icon \{/);
});

test('langue : pastille compacte sur la connexion et l\'accueil', () => {
  assert.match(read('js/i18n.js'), /function renderCompactSelector\(\)/);
  assert.match(read('js/auth.js'), /I18n\.renderCompactSelector \? I18n\.renderCompactSelector\(\)/);
  assert.match(read('js/app.js'), /I18n\.renderCompactSelector \? I18n\.renderCompactSelector\(\)/);
});

test('connexion : onglets Connexion / Inscription placés en bas du formulaire', () => {
  const auth = read('js/auth.js');
  assert.ok(auth.indexOf('auth-tabs auth-tabs-bottom') > auth.indexOf('id="tab-register"'));
});

test('cartes de statistiques : emoji remplacé par une icône colorée', () => {
  const ctx = { window: {} };
  require('vm').createContext(ctx);
  require('vm').runInContext(read('js/icons.js'), ctx);
  const { STAT_EMOJI } = ctx.window.McIcons;
  for (const emoji of ['👥', '🩺', '📅', '📨', '💊', '🚑']) {
    assert.ok(STAT_EMOJI[emoji], `${emoji} doit avoir une icône`);
  }
  assert.ok(STAT_EMOJI['👨\u200d⚕️'], 'médecin (séquence ZWJ)');
});

test('le sprite est versionné (nouvelles icônes jamais bloquées par le cache hors ligne)', () => {
  assert.ok(fs.existsSync(path.join(root, 'vendor/icons/medconnect-icons-v3.svg')));
  assert.match(read('js/icons.js'), /medconnect-icons-v3\.svg/);
  assert.match(read('sw.js'), /medconnect-icons-v3\.svg/);
});
