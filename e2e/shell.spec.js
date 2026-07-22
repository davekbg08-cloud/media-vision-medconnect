/* =====================================================
   E2E « shell » — socle UI dans un vrai navigateur (chantier D)
   Sans backend Firebase : on valide le démarrage et les contrats
   d'interface les plus sensibles (toasts accessibles, états boutons,
   thème, chargement paresseux de la carte, modale clavier). C'est le
   filet qui rattrape les régressions front que les tests unitaires
   (analyse de source) ne voient pas s'exécuter.
   ===================================================== */
const { test, expect } = require('@playwright/test');

const OUR_FILES = ['app.js', 'map.js', 'hospital.js', 'exchange-bridge.js', 'lazy-loader.js',
  'hospital-capabilities.js', 'hospital-permissions.js', 'auth.js', 'share.js'];

// Attache un collecteur d'erreurs JS non catchées ; renvoie celles qui
// proviennent des fichiers que nous avons touchés.
function trackErrors(page) {
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message || e)));
  return () => errs.filter(m => OUR_FILES.some(f => m.includes(f)));
}

// Shell hermétique : on coupe les appels réseau externes lents/inutiles
// au socle (API Firebase, analytics, CDN carte). Le SDK Firebase (gstatic)
// reste chargé pour que l'app s'initialise normalement ; seuls les appels
// backend sont court-circuités — sinon le boot attend des time-outs réseau.
test.beforeEach(async ({ page }) => {
  await page.route(/(firestore\.googleapis\.com|identitytoolkit|securetoken|firebaseio|firebaseinstallations|google-analytics|analytics\.google|unpkg\.com)/,
    route => route.abort());
});

async function boot(page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.App, null, { timeout: 15000 });
}

test('démarre sans exception et expose App / LazyLoader', async ({ page }) => {
  const ourErrors = trackErrors(page);
  await boot(page);
  const probe = await page.evaluate(() => ({
    app: typeof window.App?.toast === 'function',
    setBtnLoading: typeof window.App?.setBtnLoading === 'function',
    lazy: typeof window.LazyLoader?.load === 'function' && typeof window.LazyLoader?.loadCss === 'function',
    toastContainer: !!document.getElementById('toast-container'),
  }));
  expect(probe.app, 'App.toast présent').toBeTruthy();
  expect(probe.setBtnLoading, 'App.setBtnLoading présent').toBeTruthy();
  expect(probe.lazy, 'LazyLoader présent').toBeTruthy();
  expect(probe.toastContainer, '#toast-container présent').toBeTruthy();
  expect(ourErrors(), 'aucune exception liée aux fichiers modifiés').toEqual([]);
});

test('chantier B : Leaflet n\'est PAS chargé au démarrage', async ({ page }) => {
  await boot(page);
  const leafletLoaded = await page.evaluate(() => typeof window.L !== 'undefined');
  expect(leafletLoaded, 'window.L doit être indéfini au boot (chargement à la demande)').toBeFalsy();
});

test('chantier A : toast d\'erreur est accessible et priorisé', async ({ page }) => {
  await boot(page);
  const t = await page.evaluate(() => {
    window.App.toast('Échec écriture serveur', 'error');
    const el = document.querySelector('#toast-container .toast-error');
    return el && {
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-live'),
      hasClose: !!el.querySelector('.toast-close'),
      hasIco: !!el.querySelector('.toast-ico'),
      msg: el.querySelector('.toast-msg')?.textContent,
    };
  });
  expect(t, 'un toast erreur est créé').toBeTruthy();
  expect(t.role).toBe('alert');
  expect(t.aria).toBe('assertive');
  expect(t.hasClose, 'bouton fermer présent').toBeTruthy();
  expect(t.hasIco, 'icône présente').toBeTruthy();
  expect(t.msg).toBe('Échec écriture serveur');
});

test('chantier A : toast succès reste polite (rétrocompatible)', async ({ page }) => {
  await boot(page);
  const t = await page.evaluate(() => {
    window.App.toast('Consultation enregistrée');
    const el = document.querySelector('#toast-container .toast-success');
    return el && { role: el.getAttribute('role'), aria: el.getAttribute('aria-live') };
  });
  expect(t).toBeTruthy();
  expect(t.role).toBe('status');
  expect(t.aria).toBe('polite');
});

test('chantier A : setBtnLoading bascule loading + disabled + aria-busy', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const b = document.createElement('button'); b.className = 'btn'; document.body.appendChild(b);
    window.App.setBtnLoading(b, true);
    const on = b.classList.contains('btn-loading') && b.disabled && b.getAttribute('aria-busy') === 'true';
    window.App.setBtnLoading(b, false);
    const off = !b.classList.contains('btn-loading') && !b.disabled && !b.hasAttribute('aria-busy');
    b.remove();
    return { on, off };
  });
  expect(r.on, 'état chargement activé').toBeTruthy();
  expect(r.off, 'état chargement rétabli').toBeTruthy();
});

test('modale : Échap la ferme (accessibilité clavier)', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.App.openModal('Titre test', '<p>Contenu</p>'));
  await expect(page.locator('#global-modal')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#global-modal')).not.toHaveClass(/active/);
});

test('thème : suit prefers-color-scheme quand aucun choix n\'est enregistré', async ({ page }) => {
  // Aucun choix explicite (localStorage.mc_theme vide, contexte neuf).
  await page.emulateMedia({ colorScheme: 'light' });
  await boot(page);
  expect(await page.evaluate(() => document.body.classList.contains('light-theme')),
    'OS clair → thème clair appliqué').toBe(true);

  // Nouvelle navigation (pas de reload : plus robuste avec le SW) en OS sombre.
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page);
  expect(await page.evaluate(() => document.body.classList.contains('light-theme')),
    'OS sombre → thème sombre (défaut)').toBe(false);
});
