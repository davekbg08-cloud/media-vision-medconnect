/* =====================================================
   MedConnect — Retour tactile global
   -----------------------------------------------------
   Objectif : donner un petit retour à chaque appui utile.
   - Vibration courte si le navigateur/appareil le permet.
   - Retour visuel discret si la vibration n’est pas supportée.
   - Protection anti-double vibration sur le même appui.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectHaptics?.installed) return;

  const SELECTOR = [
    'button',
    'a[href]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    '.btn',
    '.btn-p',
    '.role-btn',
    '.chip-filter',
    '.mobile-menu-btn',
    '.modal-close',
    '.sidebar-nav li',
    '.record-card[onclick]',
    '.stat-card[onclick]',
    '[role="button"]',
    '[onclick]'
  ].join(',');

  let lastPulseAt = 0;
  let lastTarget = null;

  function injectPressedStyle() {
    if (document.getElementById('mc-haptic-style')) return;
    const style = document.createElement('style');
    style.id = 'mc-haptic-style';
    style.textContent = `
      .mc-haptic-pressed {
        transform: scale(.985);
        filter: brightness(1.08);
        transition: transform 90ms ease, filter 90ms ease;
      }
    `;
    document.head.appendChild(style);
  }

  function isInteractiveTarget(target) {
    const el = target?.closest?.(SELECTOR);
    if (!el) return null;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
    if (el.closest?.('[disabled], [aria-disabled="true"]')) return null;
    return el;
  }

  function visualPress(el) {
    if (!el || el.__mcHapticPressing) return;
    el.__mcHapticPressing = true;
    el.classList.add('mc-haptic-pressed');
    setTimeout(() => {
      el.classList.remove('mc-haptic-pressed');
      el.__mcHapticPressing = false;
    }, 95);
  }

  function pulse(el) {
    const now = Date.now();
    if (now - lastPulseAt < 80) return;
    lastPulseAt = now;
    lastTarget = el || lastTarget;
    try {
      if (navigator?.vibrate) navigator.vibrate(8);
    } catch (_) {}
    visualPress(el || lastTarget);
  }

  function onPointerDown(event) {
    const el = isInteractiveTarget(event.target);
    if (!el) return;
    lastTarget = el;
    pulse(el);
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = isInteractiveTarget(event.target);
    if (!el) return;
    lastTarget = el;
    pulse(el);
  }

  injectPressedStyle();
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  window.MedConnectHaptics = Object.freeze({
    installed: true,
    pulse,
    getLastTarget: () => lastTarget,
  });
})();
