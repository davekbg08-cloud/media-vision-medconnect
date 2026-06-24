/* =====================================================
   MedConnect — Bouton Retour global
   -----------------------------------------------------
   Ajoute un bouton retour sur toutes les pages internes,
   sans modifier les portails métier page par page.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectBackButton?.installed) return;

  const HISTORY_KEY = 'mc_nav_history';
  const DEFAULT_BY_ROLE = {
    patient: 'my_record',
    doctor: 'dashboard',
    nurse: 'patients',
    pharmacist: 'dashboard',
    admin: 'dashboard',
  };

  let originalNavigateTo = null;
  let lastSection = null;
  let currentSection = null;

  function appVisible() {
    const layout = document.getElementById('app-layout');
    return !!layout && layout.style.display !== 'none';
  }

  function authVisible() {
    const auth = document.getElementById('auth-screen');
    return !!auth && auth.style.display !== 'none';
  }

  function getUserRole() {
    try { return window.Auth?.getUser?.()?.role || 'patient'; }
    catch (_) { return 'patient'; }
  }

  function readHistory() {
    try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function writeHistory(list) {
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-20))); }
    catch (_) {}
  }

  function pushHistory(section) {
    if (!section || section === currentSection) return;
    const history = readHistory();
    if (currentSection && history[history.length - 1] !== currentSection) history.push(currentSection);
    lastSection = currentSection;
    currentSection = section;
    writeHistory(history);
  }

  function popHistory() {
    const history = readHistory();
    const previous = history.pop();
    writeHistory(history);
    return previous || lastSection || null;
  }

  function ensureStyle() {
    if (document.getElementById('mc-back-button-style')) return;
    const style = document.createElement('style');
    style.id = 'mc-back-button-style';
    style.textContent = `
      .mc-global-back-btn {
        position: fixed;
        right: calc(.85rem + env(safe-area-inset-right, 0px));
        top: calc(.75rem + env(safe-area-inset-top, 0px));
        z-index: 950;
        width: 2.85rem;
        height: 2.85rem;
        border-radius: .95rem;
        border: 1px solid rgba(148, 163, 184, .22);
        background: rgba(15, 23, 42, .82);
        color: var(--text-main, #f8fafc);
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 1.35rem;
        font-weight: 800;
        box-shadow: 0 10px 24px rgba(0,0,0,.22);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      .mc-global-back-btn.visible { display: flex; }
      .mc-global-back-btn:active { transform: scale(.96); }
      @media (min-width: 769px) {
        .mc-global-back-btn { display: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureButton() {
    ensureStyle();
    let button = document.getElementById('mc-global-back-btn');
    if (button) return button;

    button = document.createElement('button');
    button.id = 'mc-global-back-btn';
    button.className = 'mc-global-back-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Retour');
    button.textContent = '←';
    button.addEventListener('click', goBack);
    document.body.appendChild(button);
    return button;
  }

  function updateVisibility() {
    const button = ensureButton();
    const visible = appVisible() && !authVisible() && !!window.Auth?.isLogged?.();
    button.classList.toggle('visible', visible);
  }

  function closeModalIfOpen() {
    const modal = document.getElementById('global-modal');
    if (modal && modal.classList.contains('active')) {
      window.App?.closeModal?.();
      return true;
    }
    return false;
  }

  function goBack() {
    if (closeModalIfOpen()) return;

    const previous = popHistory();
    const fallback = DEFAULT_BY_ROLE[getUserRole()] || 'dashboard';
    const target = previous && previous !== currentSection ? previous : fallback;

    if (window.App?.navigateTo && target) {
      window.App.navigateTo(target, { fromBackButton: true });
      return;
    }

    if (window.history.length > 1) window.history.back();
  }

  function patchAppNavigation() {
    if (!window.App || originalNavigateTo || typeof App.navigateTo !== 'function') return false;
    originalNavigateTo = App.navigateTo.bind(App);

    App.navigateTo = function (section, options = {}) {
      if (!options?.fromBackButton) pushHistory(section);
      const result = originalNavigateTo(section);
      setTimeout(updateVisibility, 80);
      return result;
    };

    const originalAfterLogin = App.afterLogin?.bind(App);
    if (originalAfterLogin && !App.__backButtonAfterLoginPatched) {
      App.afterLogin = function (user) {
        currentSection = null;
        lastSection = null;
        writeHistory([]);
        const result = originalAfterLogin(user);
        setTimeout(updateVisibility, 120);
        return result;
      };
      App.__backButtonAfterLoginPatched = true;
    }

    return true;
  }

  function tick() {
    ensureButton();
    patchAppNavigation();
    updateVisibility();
  }

  tick();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    tick();
    if (attempts > 60) clearInterval(timer);
  }, 150);

  document.addEventListener('visibilitychange', updateVisibility);

  window.MedConnectBackButton = Object.freeze({
    installed: true,
    goBack,
    updateVisibility,
  });
})();
