/* =====================================================
   MedConnect — Restauration douce après réinstallation
   -----------------------------------------------------
   Objectif : limiter la perte apparente des données quand
   la PWA / l'APK est réinstallé et que le localStorage est vide.

   Principe prudent :
   - ne remplace pas auth.js ;
   - ajoute une couche de restauration cloud pour les comptes
     professionnels qui ont un email Firebase Auth ;
   - garde localStorage comme cache uniquement ;
   - ne modifie pas le design général.
   ===================================================== */
(function () {
  const BACKUP_KEY = 'mc_user_backup';
  const PROFESSIONAL_EMAIL_IDS = {
    doctor: 'ld-email',
    pharmacist: 'lph-email',
    nurse: 'ln-email',
  };

  function hasAuth() {
    return typeof Auth !== 'undefined' && !!Auth;
  }

  function hasFirebase() {
    return typeof firebaseAuth !== 'undefined' && !!firebaseAuth &&
      typeof firebaseDB !== 'undefined' && !!firebaseDB;
  }

  function safeJson(value) {
    try { return JSON.parse(value || 'null'); }
    catch { return null; }
  }

  function readBackup() {
    return safeJson(localStorage.getItem(BACKUP_KEY));
  }

  function saveBackup(user) {
    if (!user) return;
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(user)); }
    catch (_) {}
  }

  function saveSession(user) {
    if (!user) return;
    try { sessionStorage.setItem('mc_user', JSON.stringify(user)); }
    catch (_) {}
    saveBackup(user);
  }

  function clearBackup() {
    try { localStorage.removeItem(BACKUP_KEY); } catch (_) {}
  }

  function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(msg || '').replace(/\n/g, '<br>');
    el.style.display = msg ? 'block' : 'none';
  }

  function value(id) {
    return (document.getElementById(id)?.value || '').trim();
  }

  function professionalField(role) {
    return role === 'doctor' ? 'order_num' : 'matricule';
  }

  function localProfessionalAccount(role, number) {
    const n = String(number || '').toUpperCase();
    const field = professionalField(role);
    return (DB.getAccounts?.() || []).find(account =>
      account.role === role && String(account[field] || account.username || '').toUpperCase() === n
    ) || null;
  }

  function mergeLocalAccount(account) {
    if (!account?.uid) return account;
    const accounts = DB.getAccounts?.() || [];
    const field = professionalField(account.role);
    const idx = accounts.findIndex(item =>
      item.uid === account.uid ||
      (
        item.role === account.role &&
        String(item[field] || item.username || '').toUpperCase() === String(account[field] || account.username || '').toUpperCase()
      )
    );
    if (idx === -1) accounts.push(account);
    else accounts[idx] = { ...accounts[idx], ...account };
    DB.saveAccounts?.(accounts);
    return account;
  }

  function normalizeCloudAccount(role, number, authUid, data) {
    const field = professionalField(role);
    const now = new Date().toISOString();
    const account = {
      ...data,
      uid: data.uid || authUid,
      authUid,
      role: data.role || role,
      username: data.username || data[field] || number,
      status: data.status || 'pending',
      created_at: data.created_at || data.createdAt || now,
      updated_at: now,
    };
    account[field] = account[field] || number;
    return account;
  }

  function statusIsAllowed(account) {
    return ['approved', 'active'].includes(String(account.status || '').toLowerCase());
  }

  async function restoreProfessionalFromCloud({ role, number, pass, email, errorId }) {
    if (!email) {
      showError(
        errorId,
        "⚠️ Compte introuvable sur cet appareil.\nAprès réinstallation, ajoutez l'adresse email utilisée lors de l'inscription pour restaurer le compte depuis le cloud."
      );
      return null;
    }

    if (!hasFirebase()) {
      showError(errorId, '❌ Firebase indisponible. Vérifiez la connexion internet puis réessayez.');
      return null;
    }

    try {
      const credential = await firebaseAuth.signInWithEmailAndPassword(email, pass);
      const uid = credential?.user?.uid;
      if (!uid) throw new Error('auth_uid_missing');

      const userDoc = await firebaseDB.collection('users').doc(uid).get();
      if (!userDoc.exists) {
        showError(errorId, '❌ Profil cloud introuvable. Contactez l’administrateur MedConnect.');
        return null;
      }

      const account = normalizeCloudAccount(role, number, uid, userDoc.data() || {});
      const field = professionalField(role);
      const cloudNumber = String(account[field] || account.username || '').toUpperCase();
      const requestedNumber = String(number || '').toUpperCase();

      if (account.role !== role) {
        showError(errorId, '❌ Ce compte cloud ne correspond pas au rôle sélectionné.');
        return null;
      }

      if (cloudNumber && requestedNumber && cloudNumber !== requestedNumber) {
        showError(errorId, '❌ Le numéro professionnel ne correspond pas au compte cloud connecté.');
        return null;
      }

      if (account.status === 'pending') {
        showError(errorId, '⏳ Compte retrouvé dans le cloud, mais il attend encore la validation administrateur.');
        return null;
      }
      if (account.status === 'rejected') {
        showError(errorId, '❌ Compte retrouvé dans le cloud, mais la demande a été rejetée.');
        return null;
      }
      if (account.status === 'suspended') {
        showError(errorId, '🚫 Compte suspendu. Contactez l’administrateur.');
        return null;
      }
      if (!statusIsAllowed(account)) {
        showError(errorId, '⚠️ Statut du compte non valide pour la connexion. Contactez l’administrateur.');
        return null;
      }

      mergeLocalAccount(account);
      saveSession(account);
      return account;
    } catch (error) {
      console.warn('[MedConnect] Restauration cloud impossible :', error);
      showError(errorId, '❌ Restauration cloud impossible. Vérifiez email, mot de passe et connexion internet.');
      return null;
    }
  }

  function launchRestoredAccount(account) {
    if (!account) return;

    if (account.role === 'doctor' && window.HospitalsRegistry) {
      const hospitals = HospitalsRegistry.getDoctorHospitals?.(account.uid) || [];
      if (hospitals.length > 0 && !HospitalsRegistry.getCurrentHospital?.()) {
        try { sessionStorage.setItem('mc_current_hospital', hospitals[0].hid); } catch (_) {}
      }
    }

    const screen = document.getElementById('auth-screen');
    if (screen) screen.style.display = 'none';
    window.App?.afterLogin?.(account);
    window.App?.toast?.('✅ Données restaurées depuis le cloud.');
  }

  function enhanceLoginForm(role) {
    const emailId = PROFESSIONAL_EMAIL_IDS[role];
    if (!emailId || document.getElementById(emailId)) return;

    const button = document.querySelector('#login-form .btn-p');
    if (!button) return;

    button.insertAdjacentHTML('beforebegin', `
      <div class="form-group">
        <label class="inp-lbl">Email du compte <span style="color:var(--text-muted);font-weight:400">(utile après réinstallation)</span></label>
        <input type="email" id="${emailId}" class="inp" placeholder="votre@email.com" autocomplete="email">
        <small style="color:var(--text-muted);font-size:.72rem">
          Si l'application a été réinstallée, cet email permet de restaurer vos données depuis Firestore.
        </small>
      </div>`);
  }

  function patchAuth() {
    if (!hasAuth() || Auth.__restorePatchApplied) return;
    Auth.__restorePatchApplied = true;

    const originalGetUser = Auth.getUser?.bind(Auth);
    const originalLogout = Auth.logout?.bind(Auth);
    const originalLoginRole = Auth._loginRole?.bind(Auth);
    const originalDoPatient = Auth._doPatient?.bind(Auth);
    const originalDoDoctor = Auth._doDoctor?.bind(Auth);
    const originalDoPharmacist = Auth._doPharmacist?.bind(Auth);
    const originalDoNurse = Auth._doNurse?.bind(Auth);

    Auth.getUser = function () {
      return originalGetUser?.() || readBackup();
    };

    Auth.logout = function () {
      clearBackup();
      return originalLogout?.();
    };

    Auth._loginRole = function (role) {
      originalLoginRole?.(role);
      enhanceLoginForm(role);
    };

    Auth._doPatient = async function () {
      try { await DB.syncFromFirebase?.(); } catch (_) {}
      const result = await originalDoPatient?.();
      saveBackup(Auth.getUser?.());
      return result;
    };

    async function doProfessional(role, numberId, passId, emailId, originalFn) {
      const number = value(numberId).toUpperCase();
      const pass = value(passId);
      const email = value(emailId);

      if (!number || !pass) {
        showError('auth-err', 'Veuillez remplir tous les champs obligatoires.');
        return;
      }

      const local = localProfessionalAccount(role, number);
      if (local) {
        const result = await originalFn?.();
        saveBackup(Auth.getUser?.());
        return result;
      }

      const restored = await restoreProfessionalFromCloud({
        role,
        number,
        pass,
        email,
        errorId: 'auth-err',
      });
      if (restored) launchRestoredAccount(restored);
    }

    Auth._doDoctor = function () {
      return doProfessional('doctor', 'ld-num', 'ld-pass', 'ld-email', originalDoDoctor);
    };
    Auth._doPharmacist = function () {
      return doProfessional('pharmacist', 'lph-num', 'lph-pass', 'lph-email', originalDoPharmacist);
    };
    Auth._doNurse = function () {
      return doProfessional('nurse', 'ln-num', 'ln-pass', 'ln-email', originalDoNurse);
    };
  }

  patchAuth();
})();
