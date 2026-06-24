/* =====================================================
   MedConnect — Connexion sans email visible
   -----------------------------------------------------
   Objectif limité : enlever l'ancien champ email de
   restauration de l'écran Connexion et nettoyer les
   messages qui demandaient un email invisible.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectNoEmailCleanup?.installed) return;

  const ROLES = ['doctor', 'pharmacist', 'nurse'];
  const EMAIL_IDS = {
    doctor: 'ld-email',
    pharmacist: 'lph-email',
    nurse: 'ln-email',
  };

  function removeElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function removeEmailField(role) {
    const id = EMAIL_IDS[role];
    const field = id ? document.getElementById(id) : null;
    if (!field) return;
    removeElement(field.closest('.form-group') || field);
  }

  function cleanupLogin(role) {
    if (!ROLES.includes(role)) return;
    removeEmailField(role);
    const button = document.querySelector('#login-form .btn-p');
    if (button && !button.disabled) button.textContent = '🔐 Se connecter';
  }

  function activeRole() {
    return document.querySelector('#login-roles .role-btn.active')?.dataset?.role || '';
  }

  function cleanErrorMessage() {
    const el = document.getElementById('auth-err');
    if (!el || el.style.display === 'none') return;
    const text = el.textContent || '';
    if (!/email|e-mail|restaur/i.test(text)) return;
    el.innerHTML = '⚠️ Compte introuvable ou non encore validé.<br>Vérifiez le numéro professionnel et le mot de passe. Si vous venez de faire une inscription, attendez la validation de l’administrateur.';
    el.style.display = 'block';
  }

  function patchAuthLoginRole() {
    if (!window.Auth || Auth.__noEmailCleanupApplied) return false;
    if (typeof Auth._loginRole !== 'function') return false;
    const original = Auth._loginRole.bind(Auth);
    Auth._loginRole = function (role) {
      const result = original(role);
      cleanupLogin(role);
      setTimeout(() => cleanupLogin(role), 0);
      setTimeout(() => cleanupLogin(role), 120);
      return result;
    };
    Auth.__noEmailCleanupApplied = true;
    return true;
  }

  function observeErrors() {
    const el = document.getElementById('auth-err');
    if (!el || el.__noEmailObserved) return;
    const observer = new MutationObserver(cleanErrorMessage);
    observer.observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    el.__noEmailObserved = true;
  }

  function tick() {
    patchAuthLoginRole();
    observeErrors();
    cleanupLogin(activeRole());
    cleanErrorMessage();
  }

  tick();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    tick();
    if (attempts > 50) clearInterval(timer);
  }, 100);

  window.MedConnectNoEmailCleanup = Object.freeze({ installed: true, cleanupLogin });
})();
