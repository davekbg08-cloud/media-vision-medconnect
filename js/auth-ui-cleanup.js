/* =====================================================
   MedConnect 2.0 — Nettoyage visuel connexion
   -----------------------------------------------------
   Objectif limité : retirer les anciennes options visibles
   sans modifier la logique métier ni les données.
   ===================================================== */
(function () {
  function removeElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function removeFormGroupFor(id) {
    const field = document.getElementById(id);
    if (!field) return;
    const group = field.closest('.form-group') || field;
    removeElement(group);
  }

  function setMainButtonLabel(text) {
    const button = document.querySelector('#login-form .btn-p');
    if (button) button.textContent = text;
  }

  function cleanupLoginForm(role) {
    const form = document.getElementById('login-form');
    if (!form) return;

    if (role === 'patient') {
      form.querySelectorAll('.auth-register-info').forEach(removeElement);
      form.querySelectorAll('button').forEach(button => {
        if ((button.textContent || '').includes('Premier accès')) removeElement(button);
      });
      setMainButtonLabel('🔐 Se connecter');
      return;
    }

    const emailIds = {
      doctor: 'ld-email',
      pharmacist: 'lph-email',
      nurse: 'ln-email',
    };
    if (emailIds[role]) {
      removeFormGroupFor(emailIds[role]);
      setMainButtonLabel('🔐 Se connecter');
    }
  }

  function patchAuthLoginRole() {
    if (!window.Auth || Auth.__uiCleanupPatchApplied) return false;
    if (typeof Auth._loginRole !== 'function') return false;

    const originalLoginRole = Auth._loginRole.bind(Auth);
    Auth._loginRole = function (role) {
      const result = originalLoginRole(role);
      cleanupLoginForm(role);
      setTimeout(() => cleanupLoginForm(role), 0);
      return result;
    };

    Auth.__uiCleanupPatchApplied = true;
    return true;
  }

  function start() {
    if (patchAuthLoginRole()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (patchAuthLoginRole() || attempts > 40) clearInterval(timer);
    }, 100);
  }

  start();
})();
