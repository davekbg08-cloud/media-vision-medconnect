/* =====================================================
   MedConnect — Protection modification fiche patient
   -----------------------------------------------------
   Retire le bouton Modifier pour le rôle patient et bloque
   l'accès direct à l'édition depuis le portail patient.
   ===================================================== */
(function () {
  'use strict';

  if (window.MedConnectPatientEditGuard?.installed) return;

  let appPatched = false;
  let portalPatched = false;

  function currentRole() {
    try { return window.Auth?.getUser?.()?.role || ''; }
    catch (_) { return ''; }
  }

  function isPatient() {
    return currentRole() === 'patient';
  }

  function removePatientEditButtons() {
    if (!isPatient()) return;
    document.querySelectorAll('button[onclick*="PatientPortal.openEdit"]').forEach(button => {
      button.remove();
    });
  }

  function patchPatientPortal() {
    if (!window.PatientPortal || portalPatched) return;
    if (typeof PatientPortal.openEdit === 'function') {
      const originalOpenEdit = PatientPortal.openEdit.bind(PatientPortal);
      PatientPortal.openEdit = function (...args) {
        if (isPatient()) {
          window.App?.toast?.('Modification réservée au personnel médical autorisé.', 'error');
          removePatientEditButtons();
          return;
        }
        return originalOpenEdit(...args);
      };
    }
    portalPatched = true;
  }

  function patchAppNavigation() {
    if (!window.App || appPatched) return;
    if (typeof App.navigateTo === 'function') {
      const originalNavigateTo = App.navigateTo.bind(App);
      App.navigateTo = function (...args) {
        const result = originalNavigateTo(...args);
        setTimeout(removePatientEditButtons, 60);
        setTimeout(removePatientEditButtons, 250);
        return result;
      };
    }
    if (typeof App.afterLogin === 'function') {
      const originalAfterLogin = App.afterLogin.bind(App);
      App.afterLogin = function (...args) {
        const result = originalAfterLogin(...args);
        setTimeout(removePatientEditButtons, 80);
        setTimeout(removePatientEditButtons, 350);
        return result;
      };
    }
    appPatched = true;
  }

  function tick() {
    patchPatientPortal();
    patchAppNavigation();
    removePatientEditButtons();
  }

  tick();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    tick();
    if (attempts > 120) clearInterval(timer);
  }, 150);

  document.addEventListener('visibilitychange', removePatientEditButtons);
  window.addEventListener('focus', removePatientEditButtons);

  window.MedConnectPatientEditGuard = Object.freeze({
    installed: true,
    removePatientEditButtons,
  });
})();
