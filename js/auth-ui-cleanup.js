/* =====================================================
   MedConnect 2.0 — Correctif ciblé Auth UX
   -----------------------------------------------------
   Objectif limité : aligner l’interface avec la logique.
   - Ne cache plus l’email de restauration.
   - Corrige les messages incohérents compte/demande.
   - Empêche les doubles appuis pendant les traitements.
   - Ajoute un léger retour tactile sur les touches.
   ===================================================== */
(function () {
  'use strict';

  const PROFESSIONAL_ROLES = ['doctor', 'pharmacist', 'nurse'];
  let lastPressedButton = null;

  function vibrateTouch() {
    try {
      if (navigator?.vibrate) navigator.vibrate(8);
    } catch (_) {}
  }

  function markPressedButton(event) {
    const button = event.target?.closest?.('button, .btn, .btn-p, .role-btn, .chip-filter, [role="button"]');
    if (!button || button.disabled) return;
    lastPressedButton = button;
    vibrateTouch();
  }

  document.addEventListener('pointerdown', markPressedButton, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    markPressedButton(event);
  }, true);

  function setError(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(html || '').replace(/\n/g, '<br>');
    el.style.display = html ? 'block' : 'none';
  }

  function normalize(value) {
    return String(value || '').trim().toUpperCase();
  }

  function getProfessionalField(role) {
    return role === 'doctor' ? 'order_num' : 'matricule';
  }

  function currentRegistrationInput(role) {
    const ids = {
      doctor: 'rd-num',
      pharmacist: 'rph-num',
      nurse: 'rn-num',
    };
    return normalize(document.getElementById(ids[role])?.value);
  }

  function currentRegistrationEmail(role) {
    const ids = {
      doctor: 'rd-num-email',
      pharmacist: 'rph-num-email',
      nurse: 'rn-num-email',
    };
    return String(document.getElementById(ids[role])?.value || '').trim().toLowerCase();
  }

  function findExistingProfessional(role, number, email = '') {
    const field = getProfessionalField(role);
    const n = normalize(number);
    const e = String(email || '').trim().toLowerCase();
    const accounts = window.DB?.getAccounts?.() || [];
    const users = window.DB?.getUsers?.() || [];
    return [...accounts, ...users].find(account => {
      if (account.role !== role) return false;
      const accountNumber = normalize(account[field] || account.username || account.order_num || account.matricule);
      const accountEmail = String(account.email || '').trim().toLowerCase();
      return (n && accountNumber === n) || (e && accountEmail === e);
    }) || null;
  }

  function explainExistingRegistration(role) {
    const number = currentRegistrationInput(role);
    const email = currentRegistrationEmail(role);
    const existing = findExistingProfessional(role, number, email);
    if (!existing) return false;

    const status = String(existing.status || '').toLowerCase();
    if (status === 'pending') {
      setError('reg-err', '⏳ Une demande existe déjà avec ces informations. Elle attend encore la validation de l’administrateur. Vous ne pouvez pas créer une deuxième demande avec le même numéro ou email.');
      return true;
    }
    if (status === 'approved' || status === 'active') {
      setError('reg-err', '✅ Ce compte existe déjà et il est validé. Utilisez l’onglet Connexion avec le numéro professionnel, le mot de passe et l’email de restauration si cet appareil ne retrouve pas le compte.');
      return true;
    }
    if (status === 'rejected') {
      setError('reg-err', '❌ Une demande existe déjà avec ces informations, mais elle a été rejetée. Contactez l’administrateur MedConnect avant de renvoyer une demande.');
      return true;
    }
    if (status === 'suspended') {
      setError('reg-err', '🚫 Ce compte existe déjà mais il est suspendu. Contactez l’administrateur MedConnect.');
      return true;
    }
    return false;
  }

  function improveLoginForm(role) {
    const form = document.getElementById('login-form');
    if (!form) return;

    const button = form.querySelector('.btn-p');
    if (button) button.textContent = '🔐 Se connecter';

    if (!PROFESSIONAL_ROLES.includes(role)) {
      form.querySelectorAll('.auth-register-info').forEach(el => {
        if ((el.textContent || '').includes('Compte existant')) el.remove();
      });
      return;
    }

    const emailIds = {
      doctor: 'ld-email',
      pharmacist: 'lph-email',
      nurse: 'ln-email',
    };
    const emailId = emailIds[role];
    const emailField = document.getElementById(emailId);
    if (!emailField) return;

    const group = emailField.closest('.form-group');
    if (group) {
      const label = group.querySelector('label');
      const small = group.querySelector('small');
      if (label) label.textContent = 'Email de restauration';
      emailField.placeholder = 'email utilisé pendant l’inscription';
      emailField.autocomplete = 'email';
      if (small) {
        small.textContent = 'Facultatif si le compte existe déjà sur cet appareil. Nécessaire après réinstallation ou si l’app ne retrouve pas le compte local.';
      }
      group.style.display = '';
    }
  }

  function patchAuthLoginRole() {
    if (!window.Auth || Auth.__authUxPatchApplied) return false;
    if (typeof Auth._loginRole !== 'function') return false;

    const originalLoginRole = Auth._loginRole.bind(Auth);
    Auth._loginRole = function (role) {
      const result = originalLoginRole(role);
      improveLoginForm(role);
      setTimeout(() => improveLoginForm(role), 0);
      return result;
    };

    Auth.__authUxPatchApplied = true;
    return true;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent || '';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = label || 'Traitement…';
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function wrapAsyncAction(name, label, afterError) {
    if (!window.Auth || typeof Auth[name] !== 'function' || Auth[`__wrapped_${name}`]) return;
    const original = Auth[name].bind(Auth);
    Auth[name] = async function (...args) {
      const button = lastPressedButton;
      if (button?.disabled) return;
      vibrateTouch();
      setBusy(button, true, label);
      try {
        const result = await original(...args);
        if (typeof afterError === 'function') setTimeout(afterError, 0);
        return result;
      } finally {
        if (document.body.contains(button)) setBusy(button, false);
      }
    };
    Auth[`__wrapped_${name}`] = true;
  }

  function patchAuthActions() {
    if (!window.Auth || Auth.__authActionFeedbackPatchApplied) return false;

    wrapAsyncAction('_doPatient', 'Connexion…');
    wrapAsyncAction('_createPatientPin', 'Création…');
    wrapAsyncAction('_doDoctor', 'Connexion…');
    wrapAsyncAction('_doPharmacist', 'Connexion…');
    wrapAsyncAction('_doNurse', 'Connexion…');

    wrapAsyncAction('_regDoctor', 'Envoi…', () => explainExistingRegistration('doctor'));
    wrapAsyncAction('_regPharmacist', 'Envoi…', () => explainExistingRegistration('pharmacist'));
    wrapAsyncAction('_regNurse', 'Envoi…', () => explainExistingRegistration('nurse'));

    Auth.__authActionFeedbackPatchApplied = true;
    return true;
  }

  function improveRestoreErrorMessages() {
    const el = document.getElementById('auth-err');
    if (!el || el.style.display === 'none') return;
    const text = el.textContent || '';
    if (!text.includes('Compte introuvable sur cet appareil')) return;
    const activeRole = document.querySelector('#login-roles .role-btn.active')?.dataset?.role;
    if (PROFESSIONAL_ROLES.includes(activeRole)) {
      el.innerHTML = '⚠️ Compte introuvable sur cet appareil.<br>Si ce compte a déjà été inscrit, entrez aussi l’email de restauration affiché ci-dessus. Si la demande n’est pas encore validée, attendez la validation administrateur avant de vous connecter.';
    }
  }

  function observeErrors() {
    const target = document.getElementById('auth-err');
    if (!target || target.__authUxObserved) return;
    const observer = new MutationObserver(() => improveRestoreErrorMessages());
    observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    target.__authUxObserved = true;
  }

  function start() {
    const tick = () => {
      patchAuthLoginRole();
      patchAuthActions();
      observeErrors();
      const activeRole = document.querySelector('#login-roles .role-btn.active')?.dataset?.role;
      if (activeRole) improveLoginForm(activeRole);
    };

    tick();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      tick();
      if (window.Auth?.__authUxPatchApplied && window.Auth?.__authActionFeedbackPatchApplied && attempts > 8) clearInterval(timer);
      if (attempts > 40) clearInterval(timer);
    }, 100);
  }

  start();
})();
