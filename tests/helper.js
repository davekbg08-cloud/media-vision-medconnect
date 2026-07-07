/* =====================================================
   Helper de test — charge un module MedConnect (qui
   s'exporte sur window) dans un contexte Node simulé.

   Les modules du projet sont écrits pour le navigateur
   (window.X = ...). Ce helper crée un faux window/document
   minimal, évalue le fichier, et retourne l'objet exporté.
   Zéro dépendance : uniquement Node natif.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Charge un ou plusieurs fichiers js/ dans un même contexte window
 * partagé, et retourne le window résultant.
 * @param {string[]} files  chemins relatifs depuis la racine du repo
 * @param {object} presetWindow  valeurs à pré-injecter sur window
 */
function loadIntoWindow(files, presetWindow = {}) {
  const win = Object.assign({
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 },
    innerWidth: 1280,
    localStorage: makeMemoryStorage(),
    sessionStorage: makeMemoryStorage(),
    setInterval: () => 0,
    clearInterval: () => {},
  }, presetWindow);
  win.window = win;

  const sandbox = {
    window: win,
    document: { URL: 'https://test/', addEventListener: () => {}, getElementById: () => null,
      querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add(){}, remove(){}, toggle(){} } }) },
    navigator: win.navigator,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: (fn) => { return 0; },
    crypto: globalThis.crypto,
  };
  vm.createContext(sandbox);

  for (const f of files) {
    const abs = path.resolve(__dirname, '..', f);
    const code = fs.readFileSync(abs, 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: f });
    } catch (e) {
      throw new Error(`Échec du chargement de ${f} : ${e.message}`);
    }
  }
  return win;
}

function makeMemoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

module.exports = { loadIntoWindow, makeMemoryStorage };
