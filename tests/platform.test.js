/* =====================================================
   Tests — Détection de plateforme (currentSourceDevice)
   Empêche la régression du bug iOS (iPhone classé desktop)
   et garantit qu'une app installée sur PC ouvre le desktop.

   currentSourceDevice lit navigator/window ; on recharge le
   module avec un environnement simulé différent par cas.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Recharge exchange-bridge.js dans un environnement simulé donné et
   retourne le device détecté. _cachedDevice étant au niveau module,
   un rechargement propre par cas garantit l'isolation. */
function detect({ ua, maxTouchPoints = 0, standalone = false, finePointer = true, width = 1280 }) {
  const win = {
    navigator: { userAgent: ua, onLine: true, maxTouchPoints, standalone },
    matchMedia: (q) => ({
      matches: q.includes('display-mode: standalone') ? standalone
             : q.includes('pointer: fine') ? finePointer
             : false,
    }),
    screen: { width },
    innerWidth: width,
    addEventListener: () => {},
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: { URL: 'https://test/', addEventListener: () => {} },
    navigator: win.navigator,
    console,
    setInterval: () => 0, clearInterval: () => {},
    JSON, Date,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/exchange-bridge.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/exchange-bridge.js' });
  return sandbox.window.ExchangeBridge.currentSourceDevice();
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const IPAD13 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'; // iPadOS se déclare Mac
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36';
const PC_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120';

test('iPhone → mobile (pas desktop)', () => {
  assert.strictEqual(detect({ ua: IPHONE, maxTouchPoints: 5, width: 390 }), 'mobile');
});

test('iPad récent (se déclare Mac + tactile) → mobile', () => {
  assert.strictEqual(detect({ ua: IPAD13, maxTouchPoints: 5, width: 820 }), 'mobile');
});

test('Android → mobile', () => {
  assert.strictEqual(detect({ ua: ANDROID, maxTouchPoints: 5, width: 412 }), 'mobile');
});

test('PC Chrome → desktop', () => {
  assert.strictEqual(detect({ ua: PC_CHROME, maxTouchPoints: 0, width: 1920 }), 'desktop');
});

test('iPhone en mode installé (standalone) → reste mobile/pwa, jamais desktop', () => {
  const d = detect({ ua: IPHONE, maxTouchPoints: 5, standalone: true, width: 390 });
  assert.ok(d === 'pwa' || d === 'mobile', `attendu mobile/pwa, obtenu ${d}`);
  assert.notStrictEqual(d, 'desktop');
});

test('App installée sur PC (standalone + souris + grand écran) → desktop', () => {
  const d = detect({ ua: PC_CHROME, maxTouchPoints: 0, standalone: true, finePointer: true, width: 1920 });
  assert.strictEqual(d, 'desktop');
});
