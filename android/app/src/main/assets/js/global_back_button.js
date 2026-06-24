/* =====================================================
   MedConnect — Bouton Retour menu principal
   -----------------------------------------------------
   Bouton global sur mobile : ferme une modale ouverte,
   sinon retourne directement au menu principal du rôle.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectBackButton?.installed) return;

  const DEFAULT_BY_ROLE = {
    patient: 'my_record',
    doctor: 'dashboard',
    nurse: 'patients',
    pharmacist: 'dashboard',
    admin: 'dashboard',
  };

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

  function mainSectionForRole() {
    return DEFAULT_BY_ROLE[getUserRole()] || 'dashboard';
  }

  function ensureStyle() {
    if (document.getElementById('mc-back-button-style')) return;
    const style = document.createElement('style');
    style.id = 'mc-back-button-style';
    style.textContent = `
      @media (max-width: 768px) {
        .main-content {
          padding-bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px));
        }
      }
      .mc-global-back-btn {
        position: fixed;
        right: calc(.95rem + env(safe-area-inset-right, 0px));
        bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
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
    button.setAttribute('aria-label', 'Retour au menu principal');
    button.title = 'Retour au menu principal';
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
    const target = mainSectionForRole();
    if (window.App?.navigateTo && target) {
      window.App.navigateTo(target);
    }
  }

  function tick() {
    ensureButton();
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
