/* =====================================================
   MedConnect 2.0 — LazyLoader (chantier B, performance)
   Chargement À LA DEMANDE de ressources lourdes (scripts,
   feuilles de style) qui ne servent qu'à certains écrans.

   Objectif : ne plus payer au DÉMARRAGE le coût de modules
   qu'une minorité d'utilisateurs ouvrira (ex. Leaflet ~150 Ko
   pour la carte). Le service worker continue de précacher ces
   ressources → le mode hors ligne reste intact.

   Non invasif : n'introduit AUCUN module ES, reste compatible
   avec l'architecture IIFE globale du projet. Idempotent : une
   même ressource n'est jamais injectée deux fois (cache de
   promesses partagé), quel que soit le nombre d'appels
   concurrents.
   ===================================================== */
window.LazyLoader = (() => {
  const _cache = new Map();

  /* Injecte un <script> et résout quand window[globalName] est
     disponible (ou quand le script a fini de charger si aucun global
     n'est attendu). Si la ressource est déjà présente (précache SW,
     script déjà injecté, ou global déjà défini), résout immédiatement. */
  function load(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    if (_cache.has(src)) return _cache.get(src);

    const p = new Promise((resolve, reject) => {
      const done = () => resolve(globalName ? window[globalName] : true);
      const fail = () => reject(new Error('LazyLoader : échec de chargement — ' + src));

      // Un <script> pour cette source existe déjà (ex. injecté ailleurs) :
      // on s'accroche à ses évènements au lieu d'en créer un second.
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', done);
        existing.addEventListener('error', fail);
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = done;
      s.onerror = fail;
      document.head.appendChild(s);
    });
    _cache.set(src, p);
    return p;
  }

  /* Injecte une feuille de style <link rel="stylesheet"> à la demande. */
  function loadCss(href) {
    if (_cache.has(href)) return _cache.get(href);
    const p = new Promise((resolve, reject) => {
      if (document.querySelector(`link[href="${href}"]`)) return resolve(true);
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = () => resolve(true);
      l.onerror = () => reject(new Error('LazyLoader : échec de chargement CSS — ' + href));
      document.head.appendChild(l);
    });
    _cache.set(href, p);
    return p;
  }

  return { load, loadCss };
})();
