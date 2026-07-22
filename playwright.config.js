/* =====================================================
   MedConnect 2.0 — Configuration Playwright (chantier D)
   Tests E2E « shell » dans un vrai navigateur, SANS backend
   Firebase : ils valident le socle UI (boot, toasts accessibles,
   thème, chargement paresseux, modale) — le filet anti-régression
   des parcours front. Les écritures/règles restent couvertes par
   node --test + l'émulateur Firestore.

   Le serveur statique (python http.server) est démarré
   automatiquement par Playwright. En local (sandbox), on pointe
   directement le Chromium pré-installé ; en CI, Playwright utilise
   le navigateur installé par « npx playwright install chromium ».
   ===================================================== */
const { defineConfig, devices } = require('@playwright/test');
const fs = require('node:fs');

// Chromium pré-installé (sandbox). Absent en CI → Playwright prend le sien.
function localChromium() {
  try {
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    const dir = fs.readdirSync(base).find(d => d.startsWith('chromium-') && !d.includes('headless'));
    if (!dir) return undefined;
    const bin = `${base}/${dir}/chrome-linux/chrome`;
    return fs.existsSync(bin) ? bin : undefined;
  } catch { return undefined; }
}
const executablePath = localChromium();

module.exports = defineConfig({
  testDir: './e2e',
  // Serveur statique python mono-thread : on sérialise pour éviter la
  // contention (chaque test recharge tout le shell).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath, args: ['--no-sandbox'] } } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'python3 -m http.server 8080 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8080/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
