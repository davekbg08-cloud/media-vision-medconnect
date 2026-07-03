/* =====================================================
   MedConnect — Correctif Auth UX ciblé
   -----------------------------------------------------
   - Anti-double appui pendant les traitements de connexion/
     inscription (boutons désactivés + libellé "...").
   - Messages clairs en cas de doublon d'inscription.
   - Le champ email de récupération a été retiré à la source
     (auth.js) : plus rien à nettoyer ici sur ce point.
   ===================================================== */
(function () {
  'use strict';

  const REG_NUMBER_IDS = { doctor: 'rd-num', pharmacist: 'rph-num', nurse: 'rn-num' };
  const REG_EMAIL_IDS = { doctor: 'rd-num-email', pharmacist: 'rph-num-email', nurse: 'rn-num-email' };
  let lastPressedButton = null;

  function normalize(value) { return String(value || '').trim().toUpperCase(); }
  function lower(value) { return String(value || '').trim().toLowerCase(); }
  function fieldFor(role) { return role === 'doctor' ? 'order_num' : 'matricule'; }

  function setError(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(html || '').replace(/\n/g, '<br>');
    el.style.display = html ? 'block' : 'none';
  }

  function findExistingProfessional(role) {
    const number = normalize(document.getElementById(REG_NUMBER_IDS[role])?.value);
    const mail = lower(document.getElementById(REG_EMAIL_IDS[role])?.value);
    const field = fieldFor(role);
    const accounts = window.DB?.getAccounts?.() || [];
    const users = window.DB?.getUsers?.() || [];
    return [...accounts, ...users].find(account => {
      if (account.role !== role) return false;
      const accountNumber = normalize(account[field] || account.username || account.order_num || account.matricule);
      const accountMail = lower(account.email);
      return (number && accountNumber === number) || (mail && accountMail === mail);
    }) || null;
  }

  function explainExistingRegistration(role) {
    const existing = findExistingProfessional(role);
    if (!existing) return false;
    const status = lower(existing.status);

    if (status === 'pending') {
      setError('reg-err', '⏳ Une demande existe déjà avec ces informations. Elle attend encore la validation de l’administrateur.');
      return true;
    }
    if (status === 'approved' || status === 'active') {
      setError('reg-err', '✅ Ce compte existe déjà et il est validé. Utilisez l’onglet Connexion avec votre numéro professionnel et votre mot de passe.');
      return true;
    }
    if (status === 'rejected') {
      setError('reg-err', '❌ Une demande existe déjà avec ces informations, mais elle a été rejetée. Contactez l’administrateur MedConnect.');
      return true;
    }
    if (status === 'suspended') {
      setError('reg-err', '🚫 Ce compte existe déjà mais il est suspendu. Contactez l’administrateur MedConnect.');
      return true;
    }
    return false;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent || '';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = label || 'Traitement…';
      return;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }

  function trackPressedButton(event) {
    const button = event.target?.closest?.('button, .btn, .btn-p, .role-btn, .chip-filter, [role="button"]');
    if (!button || button.disabled) return;
    lastPressedButton = button;
  }

  document.addEventListener('pointerdown', trackPressedButton, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') trackPressedButton(event);
  }, true);

  function wrapAction(name, label, after) {
    if (!window.Auth || typeof Auth[name] !== 'function' || Auth[`__cleanWrapped_${name}`]) return;
    const original = Auth[name].bind(Auth);
    Auth[name] = async function (...args) {
      const button = lastPressedButton || window.MedConnectHaptics?.getLastTarget?.();
      if (button?.disabled) return;
      setBusy(button, true, label);
      try {
        const result = await original(...args);
        if (typeof after === 'function') setTimeout(after, 0);
        return result;
      } finally {
        if (button && document.body.contains(button)) setBusy(button, false);
      }
    };
    Auth[`__cleanWrapped_${name}`] = true;
  }

  function patchAuth() {
    if (!window.Auth) return false;

    wrapAction('_doPatient', 'Connexion…');
    wrapAction('_createPatientPin', 'Création…');
    wrapAction('_doDoctor', 'Connexion…');
    wrapAction('_doPharmacist', 'Connexion…');
    wrapAction('_doNurse', 'Connexion…');
    wrapAction('_regDoctor', 'Envoi…', () => explainExistingRegistration('doctor'));
    wrapAction('_regPharmacist', 'Envoi…', () => explainExistingRegistration('pharmacist'));
    wrapAction('_regNurse', 'Envoi…', () => explainExistingRegistration('nurse'));

    return true;
  }

  function tick() { patchAuth(); }

  tick();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    tick();
    if (attempts > 50) clearInterval(timer);
  }, 100);
})();
