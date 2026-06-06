/* =====================================================
   MedConnect 2.0 — Auth Module (Sécurisé)
   Vérification crédentiels · PIN patient · Rôles stricts
   ===================================================== */
const Auth = (() => {
  const ROLE_ICONS = { patient:'🩺', doctor:'👨‍⚕️', pharmacist:'💊', nurse:'🩹', admin:'⚙️' };
  const ROLE_LABELS = { patient:'Patient', doctor:'Médecin', pharmacist:'Pharmacien', nurse:'Infirmier(e)', admin:'Administrateur' };

  /* ── COMPTE ADMIN (unique, pré-configuré) ──────── */
  const ADMIN = { uid:'admin_root', username:'admin', password:'MedConnect@2026!', role:'admin', name:'Administrateur MedConnect' };

  /* ── SESSION ────────────────────────────────────── */
  function getUser()  { try { return JSON.parse(sessionStorage.getItem('mc_user')||'null'); } catch { return null; } }
  function isLogged() { return !!getUser(); }

  function setUser(acc) { sessionStorage.setItem('mc_user', JSON.stringify(acc)); }

  function logout() {
    sessionStorage.removeItem('mc_user');
    if (window.HospitalsRegistry?.clearCurrentHospital) HospitalsRegistry.clearCurrentHospital();
    showLogin();
  }

  /* ── ÉCRAN DE CONNEXION ─────────────────────────── */
  function showLogin() {
    document.getElementById('landing').style.display    = 'none';
    document.getElementById('app-layout').style.display = 'none';
    const el = document.getElementById('auth-screen');
    el.style.display = 'flex';
    el.innerHTML = renderLoginHTML();
    const lc = document.getElementById('auth-lang');
    if (lc && window.I18n?.renderSelector) lc.innerHTML = I18n.renderSelector();
  }

  function renderLoginHTML() { return `
    <div class="auth-card">
      <div class="auth-logo">🏥</div>
      <h1 class="auth-title">MedConnect</h1>
      <p class="auth-sub">Plateforme Médicale Universelle v2.0</p>

      <div id="auth-tabs" class="auth-tabs">
        <button class="auth-tab active" onclick="Auth.switchTab('login')">Connexion</button>
        <button class="auth-tab"        onclick="Auth.switchTab('register')">Inscription</button>
      </div>

      <!-- ── LOGIN ── -->
      <div id="tab-login">
        <!-- Sélecteur de rôle -->
        <div class="role-selector">
          ${Object.entries(ROLE_LABELS).filter(([r])=>r!=='admin').map(([role, label]) => `
            <button class="role-btn" data-role="${role}" onclick="Auth.selectRole('${role}')">
              <span>${ROLE_ICONS[role]}</span>
              <span>${label}</span>
            </button>`).join('')}
        </div>
        <div id="login-form-area"></div>
        <div id="auth-err" class="auth-error" style="display:none"></div>
      </div>

      <!-- ── REGISTER ── -->
      <div id="tab-register" style="display:none">
        <div id="register-form-area">
          <p class="auth-register-info">
            Sélectionnez votre rôle pour voir les instructions d'inscription.
          </p>
          <div class="role-selector">
            ${Object.entries(ROLE_LABELS).filter(([r])=>r!=='admin'&&r!=='patient').map(([role,label]) => `
              <button class="role-btn" data-role="${role}" onclick="Auth.showRegisterForm('${role}')">
                <span>${ROLE_ICONS[role]}</span><span>${label}</span>
              </button>`).join('')}
          </div>
          <div style="margin-top:.85rem;padding:.75rem;background:rgba(14,165,233,.07);border:1px solid rgba(14,165,233,.2);border-radius:8px;font-size:.79rem;color:var(--text-muted)">
            🩺 <strong style="color:var(--text)">Patient ?</strong><br>
            Votre fiche est créée par votre médecin. Utilisez l'onglet <strong>Connexion</strong> avec votre numéro unique <code style="color:var(--primary)">MC-YYYY-CC-XXXXXXXX</code> + votre PIN.
          </div>
        </div>
      </div>

      <div id="auth-lang" style="margin-top:1.1rem;display:flex;justify-content:center"></div>
      <p style="font-size:.68rem;color:var(--text-dim);text-align:center;margin-top:.6rem">📞 +243 856 373 707</p>
    </div>`; }

  /* ── SÉLECTION DU RÔLE → FORMULAIRE ───────────── */
  function selectRole(role) {
    document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('active', b.dataset.role===role));
    document.getElementById('login-form-area').innerHTML = loginFormFor(role);
    document.getElementById('auth-err').style.display = 'none';
  }

  function loginFormFor(role) {
    if (role === 'patient') return `
      <div style="margin:.75rem 0">
        <label class="inp-lbl">Numéro de fiche unique *</label>
        <input type="text" id="l-patient-id" class="inp"
               placeholder="MC-2026-CD-XXXXXXXX" style="letter-spacing:1px;text-transform:uppercase"
               oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.5rem">PIN (4 chiffres) *</label>
        <input type="password" id="l-patient-pin" class="inp" maxlength="6" placeholder="••••" inputmode="numeric">
        <button class="btn-p" style="margin-top:.75rem" onclick="Auth.loginPatient()">🔐 Accéder à mon dossier</button>
        <p style="font-size:.73rem;color:var(--text-muted);margin-top:.65rem;text-align:center">
          Votre numéro unique vous a été communiqué par votre médecin.
        </p>
      </div>`;

    if (role === 'doctor') return `
      <div style="margin:.75rem 0">
        <label class="inp-lbl">N° Ordre Médical *</label>
        <input type="text" id="l-order" class="inp" placeholder="OM-CD-2024-XXXX"
               style="text-transform:uppercase;letter-spacing:1px"
               oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.5rem">Mot de passe *</label>
        <input type="password" id="l-pass" class="inp" placeholder="••••••">
        <button class="btn-p" style="margin-top:.75rem" onclick="Auth.loginDoctor()">🔐 Connexion</button>
      </div>`;

    if (role === 'pharmacist') return `
      <div style="margin:.75rem 0">
        <label class="inp-lbl">N° Matricule / RCCM *</label>
        <input type="text" id="l-mat" class="inp" placeholder="PH-CD-2024-XXXX"
               style="text-transform:uppercase;letter-spacing:1px"
               oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.5rem">Mot de passe *</label>
        <input type="password" id="l-pass-ph" class="inp" placeholder="••••••">
        <button class="btn-p" style="margin-top:.75rem" onclick="Auth.loginPharmacist()">🔐 Connexion</button>
      </div>`;

    if (role === 'nurse') return `
      <div style="margin:.75rem 0">
        <label class="inp-lbl">N° Matricule infirmier *</label>
        <input type="text" id="l-nurse" class="inp" placeholder="INF-CD-2024-XXXX"
               style="text-transform:uppercase;letter-spacing:1px"
               oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.5rem">Mot de passe *</label>
        <input type="password" id="l-pass-n" class="inp" placeholder="••••••">
        <button class="btn-p" style="margin-top:.75rem" onclick="Auth.loginNurse()">🔐 Connexion</button>
      </div>`;

    return '';
  }

  /* ── LOGIN PATIENT (N° fiche + PIN) ────────────── */
  function loginPatient() {
    const id  = document.getElementById('l-patient-id')?.value?.trim().toUpperCase();
    const pin = document.getElementById('l-patient-pin')?.value;

    if (!id || !pin) { showErr('Veuillez remplir tous les champs.'); return; }

    const patient = DB.getPatientById(id);
    if (!patient) { showErr('❌ Numéro de fiche introuvable. Contactez votre médecin.'); return; }

    // Premier accès : créer le PIN
    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.patient_id === id);

    if (!existing) {
      // Première connexion → définir le PIN
      if (pin.length < 4) { showErr('Le PIN doit contenir au moins 4 chiffres.'); return; }
      const acc = {
        uid:        `PAT_${id}`,
        username:   id,
        password:   pin,
        role:       'patient',
        name:       `${patient.firstname} ${patient.lastname}`,
        patient_id: id,
        created_at: new Date().toISOString(),
      };
      accounts.push(acc);
      DB.saveAccounts(accounts);
      localStorage.setItem('mc_my_patient_id', id);
      setUser(acc);
      ACL.logAccess(id, acc.uid, 'patient_first_login');
      document.getElementById('auth-screen').style.display = 'none';
      App.afterLogin(acc);
      App.toast(`✅ Bienvenue, ${patient.firstname} ! PIN créé.`);
      return;
    }

    if (existing.password !== pin) { showErr('❌ PIN incorrect.'); return; }
    localStorage.setItem('mc_my_patient_id', id);
    setUser(existing);
    ACL.logAccess(id, existing.uid, 'patient_login');
    document.getElementById('auth-screen').style.display = 'none';
    App.afterLogin(existing);
  }

  /* ── LOGIN MÉDECIN (N° Ordre + mot de passe) ───── */
  function loginDoctor() {
    const orderNum = document.getElementById('l-order')?.value?.trim().toUpperCase();
    const password = document.getElementById('l-pass')?.value;

    if (!orderNum || !password) { showErr('Veuillez remplir tous les champs.'); return; }

    // Vérifier le registre officiel
    if (!ACL.isDoctorVerified(orderNum)) {
      showErr('❌ N° d\'Ordre Médical non reconnu.\nContactez l\'administrateur pour enregistrement.');
      return;
    }

    const accounts  = DB.getAccounts();
    const existing  = accounts.find(a => a.order_num === orderNum && a.role === 'doctor');

    if (existing) {
      if (existing.password !== password) { showErr('❌ Mot de passe incorrect.'); return; }
      setUser(existing);
      finishDoctorLogin(existing);
      return;
    }

    // Premier accès : créer le compte
    const docInfo = ACL.getVerifiedDoctors().find(d => d.order_num === orderNum);
    const acc = {
      uid:       `DOC_${orderNum}`,
      username:  orderNum,
      password,
      role:      'doctor',
      name:      docInfo?.name || `Médecin ${orderNum}`,
      order_num: orderNum,
      specialty: docInfo?.specialty || '',
      country:   docInfo?.country   || '',
      created_at: new Date().toISOString(),
    };
    accounts.push(acc);
    DB.saveAccounts(accounts);
    setUser(acc);
    finishDoctorLogin(acc);
    App.toast(`✅ Compte créé — Bienvenue Dr. ${acc.name}`);
  }

  function finishDoctorLogin(acc) {
    document.getElementById('auth-screen').style.display = 'none';
    // Auto-sélectionner le premier hôpital si disponible
    const hosps = HospitalsRegistry.getDoctorHospitals(acc.uid);
    if (hosps.length > 0 && !HospitalsRegistry.getCurrentHospital()) {
      sessionStorage.setItem('mc_current_hospital', hosps[0].hid);
    }
    App.afterLogin(acc);
  }

  /* ── LOGIN PHARMACIEN ───────────────────────────── */
  function loginPharmacist() {
    const mat      = document.getElementById('l-mat')?.value?.trim().toUpperCase();
    const password = document.getElementById('l-pass-ph')?.value;
    if (!mat || !password) { showErr('Veuillez remplir tous les champs.'); return; }

    if (!ACL.isPharmacistVerified(mat)) {
      showErr('❌ N° Matricule non reconnu.\nContactez l\'administrateur pour enregistrement.');
      return;
    }

    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.matricule === mat && a.role === 'pharmacist');

    if (existing) {
      if (existing.password !== password) { showErr('❌ Mot de passe incorrect.'); return; }
      setUser(existing);
      document.getElementById('auth-screen').style.display = 'none';
      App.afterLogin(existing);
      return;
    }

    const phInfo = ACL.getVerifiedPharmacists().find(p => p.matricule === mat);
    const acc = {
      uid:       `PH_${mat}`,
      username:  mat,
      password,
      role:      'pharmacist',
      name:      phInfo?.name     || `Pharmacien ${mat}`,
      pharmacy:  phInfo?.pharmacy || '',
      matricule: mat,
      country:   phInfo?.country  || '',
      created_at: new Date().toISOString(),
    };
    accounts.push(acc);
    DB.saveAccounts(accounts);
    setUser(acc);
    document.getElementById('auth-screen').style.display = 'none';
    App.afterLogin(acc);
    App.toast(`✅ Bienvenue, ${acc.name}`);
  }

  /* ── LOGIN INFIRMIER ────────────────────────────── */
  function loginNurse() {
    const mat      = document.getElementById('l-nurse')?.value?.trim().toUpperCase();
    const password = document.getElementById('l-pass-n')?.value;
    if (!mat || !password) { showErr('Veuillez remplir tous les champs.'); return; }

    if (!ACL.isNurseVerified(mat)) {
      showErr('❌ N° Matricule infirmier non reconnu.');
      return;
    }

    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.matricule === mat && a.role === 'nurse');
    if (existing) {
      if (existing.password !== password) { showErr('❌ Mot de passe incorrect.'); return; }
      setUser(existing);
      document.getElementById('auth-screen').style.display = 'none';
      App.afterLogin(existing);
      return;
    }

    const nurseInfo = ACL.getVerifiedNurses().find(n => n.matricule === mat);
    const acc = {
      uid:`NUR_${mat}`, username:mat, password, role:'nurse',
      name: nurseInfo?.name || `Infirmier ${mat}`,
      matricule:mat, created_at:new Date().toISOString(),
    };
    accounts.push(acc); DB.saveAccounts(accounts);
    setUser(acc);
    document.getElementById('auth-screen').style.display = 'none';
    App.afterLogin(acc);
  }

  /* ── FORMULAIRE D'INSCRIPTION RÔLE PRO ─────────── */
  function showRegisterForm(role) {
    document.querySelectorAll('#tab-register .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role===role));

    const formArea = document.getElementById('register-form-area');
    if (role === 'doctor') formArea.innerHTML = `
      <p class="auth-register-info" style="margin-top:.75rem">
        Entrez votre <strong>N° d'Ordre Médical</strong> officiel puis choisissez un mot de passe.
        Votre numéro sera vérifié dans le registre des médecins.
      </p>
      <form onsubmit="Auth.registerDoctor(event)">
        <label class="inp-lbl">N° Ordre Médical *</label>
        <input type="text" id="r-order" class="inp" required placeholder="OM-CD-2024-XXXX"
               style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.4rem">Mot de passe *</label>
        <input type="password" id="r-pass" class="inp" required placeholder="Min. 6 caractères" minlength="6">
        <button type="submit" class="btn-p" style="margin-top:.75rem">✅ Créer mon compte médecin</button>
      </form>`;

    if (role === 'pharmacist') formArea.innerHTML = `
      <p class="auth-register-info" style="margin-top:.75rem">
        Entrez votre <strong>N° Matricule / RCCM</strong> officiel et choisissez un mot de passe.
      </p>
      <form onsubmit="Auth.registerPharmacist(event)">
        <label class="inp-lbl">N° Matricule RCCM *</label>
        <input type="text" id="r-mat" class="inp" required placeholder="PH-CD-2024-XXXX"
               style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
        <label class="inp-lbl" style="margin-top:.4rem">Mot de passe *</label>
        <input type="password" id="r-pass-ph" class="inp" required placeholder="Min. 6 caractères" minlength="6">
        <button type="submit" class="btn-p" style="margin-top:.75rem">✅ Créer mon compte pharmacien</button>
      </form>`;
  }

  function registerDoctor(e) {
    e.preventDefault();
    const orderNum = document.getElementById('r-order').value.trim().toUpperCase();
    const password = document.getElementById('r-pass').value;
    if (!ACL.isDoctorVerified(orderNum)) {
      showErr('❌ N° d\'Ordre non trouvé dans le registre. Contactez l\'administrateur.'); return;
    }
    switchTab('login');
    selectRole('doctor');
    document.getElementById('l-order').value = orderNum;
    document.getElementById('l-pass').value  = password;
    loginDoctor();
  }

  function registerPharmacist(e) {
    e.preventDefault();
    const mat      = document.getElementById('r-mat').value.trim().toUpperCase();
    const password = document.getElementById('r-pass-ph').value;
    if (!ACL.isPharmacistVerified(mat)) {
      showErr('❌ Matricule non trouvé. Contactez l\'administrateur.'); return;
    }
    switchTab('login');
    selectRole('pharmacist');
    document.getElementById('l-mat').value      = mat;
    document.getElementById('l-pass-ph').value  = password;
    loginPharmacist();
  }

  /* ── ADMIN LOGIN ────────────────────────────────── */
  function loginAdmin(username, password) {
    if (username === ADMIN.username && password === ADMIN.password) {
      setUser(ADMIN);
      document.getElementById('auth-screen').style.display = 'none';
      App.afterLogin(ADMIN);
      return true;
    }
    return false;
  }

  /* ── UTILS ──────────────────────────────────────── */
  function switchTab(tab) {
    document.getElementById('tab-login').style.display    = tab==='login'    ? '' : 'none';
    document.getElementById('tab-register').style.display = tab==='register' ? '' : 'none';
    document.querySelectorAll('.auth-tab').forEach((b,i) =>
      b.classList.toggle('active', (i===0&&tab==='login')||(i===1&&tab==='register')));
  }

  function showErr(msg) {
    const el = document.getElementById('auth-err');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function getRoleIcon(role)  { return ROLE_ICONS[role]  || '👤'; }
  function getRoleLabel(role) { return ROLE_LABELS[role] || role; }

  return {
    getUser, isLogged, logout, showLogin,
    switchTab, selectRole, showRegisterForm,
    loginPatient, loginDoctor, loginPharmacist, loginNurse, loginAdmin,
    registerDoctor, registerPharmacist,
    finishDoctorLogin,
    getRoleIcon, getRoleLabel,
  };
})();

window.Auth = Auth;
