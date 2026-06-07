/* =====================================================
   MedConnect 2.0 — Auth Module (Corrigé)

   FLUX PAR RÔLE :
   ─────────────────────────────────────────────────
   PATIENT     → N° MC (créé par médecin) + PIN
                 Premier accès = création du PIN
   MÉDECIN     → N° Ordre Médical (vérifié) + mdp
                 S'inscrit avec son numéro officiel
   PHARMACIEN  → N° Matricule RCCM (vérifié) + mdp
   INFIRMIER   → N° Matricule (vérifié) + mdp
   ADMIN       → Identifiants sécurisés (cachés)
   ===================================================== */
const Auth = (() => {

  const ROLE_ICONS  = { patient:'🩺', doctor:'👨‍⚕️', pharmacist:'💊', nurse:'🩹', admin:'⚙️' };
  const ROLE_LABELS = { patient:'Patient', doctor:'Médecin', pharmacist:'Pharmacien', nurse:'Infirmier(e)', admin:'Administrateur' };
  const ADMIN_CREDS = { uid:'admin_root', username:'admin', password:'MedConnect@2026!', role:'admin', name:'Administrateur MedConnect' };

  /* ══ SESSION ════════════════════════════════════ */
  function getUser()  { try { return JSON.parse(sessionStorage.getItem('mc_user')||'null'); } catch { return null; } }
  function isLogged() { return !!getUser(); }
  function _save(acc) { sessionStorage.setItem('mc_user', JSON.stringify(acc)); }

  function logout() {
    sessionStorage.clear();
    HospitalsRegistry?.clearCurrentHospital?.();
    showLogin();
  }

  /* ══ ÉCRAN DE CONNEXION ════════════════════════ */
  function showLogin() {
    document.getElementById('landing').style.display    = 'none';
    document.getElementById('app-layout').style.display = 'none';
    const scr = document.getElementById('auth-screen');
    scr.style.display = 'flex';
    scr.innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">🏥</div>
        <h1 class="auth-title">MedConnect</h1>
        <p class="auth-sub">Plateforme Médicale Universelle v2.0</p>

        <div class="auth-tabs">
          <button id="tab-btn-login"    class="auth-tab active" onclick="Auth._tab('login')">🔐 Connexion</button>
          <button id="tab-btn-register" class="auth-tab"        onclick="Auth._tab('register')">📝 Inscription</button>
        </div>

        <div id="tab-login">
          ${renderLoginTab()}
        </div>

        <div id="tab-register" style="display:none">
          ${renderRegisterTab()}
        </div>

        <div id="auth-lang" style="margin-top:1rem;display:flex;justify-content:center"></div>
        <p style="font-size:.68rem;color:var(--text-dim);text-align:center;margin-top:.5rem">
          📞 +243 856 373 707 · MedConnect v2.0
        </p>
      </div>`;

    // Injecter sélecteur de langue
    const lc = document.getElementById('auth-lang');
    if (lc) lc.innerHTML = I18n.renderSelector();
  }

  /* ── Onglet Connexion ─────────────────────────── */
  function renderLoginTab() {
    return `
      <div class="role-selector" id="login-roles">
        ${['patient','doctor','pharmacist','nurse'].map(r=>`
          <button class="role-btn" data-role="${r}" onclick="Auth._loginRole('${r}')">
            <span>${ROLE_ICONS[r]}</span>
            <span>${ROLE_LABELS[r]}</span>
          </button>`).join('')}
      </div>
      <div id="login-form"></div>
      <div id="auth-err" class="auth-error" style="display:none"></div>`;
  }

  /* ── Onglet Inscription ───────────────────────── */
  function renderRegisterTab() {
    return `
      <div class="auth-register-info">
        🩺 <strong>Patient ?</strong> Votre médecin crée votre fiche. Connectez-vous avec votre numéro
        <code style="color:var(--primary)">MC-XXXX-CC-XXXXXXXX</code> reçu de votre médecin.
      </div>
      <p style="font-size:.8rem;color:var(--text-muted);margin:.6rem 0 .4rem">
        Choisissez votre rôle pour vous inscrire :
      </p>
      <div class="role-selector" id="register-roles">
        ${['doctor','pharmacist','nurse'].map(r=>`
          <button class="role-btn" data-role="${r}" onclick="Auth._registerRole('${r}')">
            <span>${ROLE_ICONS[r]}</span>
            <span>${ROLE_LABELS[r]}</span>
          </button>`).join('')}
      </div>
      <div id="register-form" style="margin-top:.75rem"></div>
      <div id="reg-err" class="auth-error" style="display:none"></div>`;
  }

  /* ══ SWITCH ONGLET ═════════════════════════════ */
  function _tab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login').style.display    = isLogin ? '' : 'none';
    document.getElementById('tab-register').style.display = isLogin ? 'none' : '';
    document.getElementById('tab-btn-login').classList.toggle('active', isLogin);
    document.getElementById('tab-btn-register').classList.toggle('active', !isLogin);
  }

  /* ══ SÉLECTION RÔLE CONNEXION ══════════════════ */
  function _loginRole(role) {
    // Mettre en surbrillance le rôle sélectionné
    document.querySelectorAll('#login-roles .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === role));

    const form = document.getElementById('login-form');
    const err  = document.getElementById('auth-err');
    if (err) err.style.display = 'none';

    if (role === 'patient') {
      form.innerHTML = `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">Numéro de fiche unique *</label>
          <input type="text" id="lp-id" class="inp"
            placeholder="MC-2026-CD-XXXXXXXX"
            style="letter-spacing:1px;text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">PIN (4-6 chiffres) *</label>
          <input type="password" id="lp-pin" class="inp"
            maxlength="6" placeholder="••••" inputmode="numeric">
          <small style="color:var(--text-muted);font-size:.72rem">
            Premier accès : votre PIN sera créé automatiquement.
          </small>
        </div>
        <button class="btn-p" onclick="Auth._doPatient()">🔐 Accéder à mon dossier</button>`;
    }

    else if (role === 'doctor') {
      form.innerHTML = `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Ordre Médical *</label>
          <input type="text" id="ld-num" class="inp"
            placeholder="OM-CD-2024-XXXX"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="ld-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doDoctor()">🔐 Connexion Médecin</button>`;
    }

    else if (role === 'pharmacist') {
      form.innerHTML = `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Matricule / RCCM *</label>
          <input type="text" id="lph-num" class="inp"
            placeholder="PH-CD-2024-XXXX"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="lph-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doPharmacist()">🔐 Connexion Pharmacien</button>`;
    }

    else if (role === 'nurse') {
      form.innerHTML = `
        <div class="form-group" style="margin-top:.75rem">
          <label class="inp-lbl">N° Matricule Infirmier *</label>
          <input type="text" id="ln-num" class="inp"
            placeholder="INF-CD-2024-XXXX"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Mot de passe *</label>
          <input type="password" id="ln-pass" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._doNurse()">🔐 Connexion Infirmier</button>`;
    }
  }

  /* ══ SÉLECTION RÔLE INSCRIPTION ════════════════ */
  function _registerRole(role) {
    document.querySelectorAll('#register-roles .role-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.role === role));

    const form = document.getElementById('register-form');
    const err  = document.getElementById('reg-err');
    if (err) err.style.display = 'none';

    if (role === 'doctor') {
      form.innerHTML = `
        <div class="auth-register-info">
          👨‍⚕️ Votre <strong>N° d'Ordre Médical</strong> doit être enregistré par l'administrateur.
          Entrez-le ci-dessous avec un mot de passe de votre choix.
        </div>
        <div class="form-group">
          <label class="inp-lbl">N° Ordre Médical *</label>
          <input type="text" id="rd-num" class="inp"
            placeholder="ex: OM-CD-2024-0042"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
          <small style="color:var(--text-muted);font-size:.71rem">
            Numéros disponibles (démo) : OM-CD-2024-0042 · OM-CD-2024-0117 · OM-SN-2023-0089
          </small>
        </div>
        <div class="form-group">
          <label class="inp-lbl">Choisir un mot de passe *</label>
          <input type="password" id="rd-pass" class="inp"
            placeholder="Min. 6 caractères" minlength="6">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Confirmer le mot de passe *</label>
          <input type="password" id="rd-pass2" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._regDoctor()">✅ Créer mon compte médecin</button>`;
    }

    else if (role === 'pharmacist') {
      form.innerHTML = `
        <div class="auth-register-info">
          💊 Votre <strong>N° Matricule RCCM</strong> doit être enregistré par l'administrateur.
        </div>
        <div class="form-group">
          <label class="inp-lbl">N° Matricule / RCCM *</label>
          <input type="text" id="rph-num" class="inp"
            placeholder="ex: PH-CD-2024-0015"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
          <small style="color:var(--text-muted);font-size:.71rem">
            Numéros disponibles (démo) : PH-CD-2024-0015 · PH-CD-2024-0032 · PH-SN-2023-0077
          </small>
        </div>
        <div class="form-group">
          <label class="inp-lbl">Choisir un mot de passe *</label>
          <input type="password" id="rph-pass" class="inp"
            placeholder="Min. 6 caractères" minlength="6">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Confirmer le mot de passe *</label>
          <input type="password" id="rph-pass2" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._regPharmacist()">✅ Créer mon compte pharmacien</button>`;
    }

    else if (role === 'nurse') {
      form.innerHTML = `
        <div class="auth-register-info">
          🩹 Votre <strong>N° Matricule infirmier</strong> doit être enregistré par l'administrateur.
        </div>
        <div class="form-group">
          <label class="inp-lbl">N° Matricule Infirmier *</label>
          <input type="text" id="rn-num" class="inp"
            placeholder="ex: INF-CD-2024-0089"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
          <small style="color:var(--text-muted);font-size:.71rem">
            Numéros disponibles (démo) : INF-CD-2024-0089 · INF-CM-2024-0034
          </small>
        </div>
        <div class="form-group">
          <label class="inp-lbl">Choisir un mot de passe *</label>
          <input type="password" id="rn-pass" class="inp"
            placeholder="Min. 6 caractères" minlength="6">
        </div>
        <div class="form-group">
          <label class="inp-lbl">Confirmer le mot de passe *</label>
          <input type="password" id="rn-pass2" class="inp" placeholder="••••••">
        </div>
        <button class="btn-p" onclick="Auth._regNurse()">✅ Créer mon compte infirmier</button>`;
    }
  }

  /* ══ ACTIONS CONNEXION ═════════════════════════ */

  function _doPatient() {
    const id  = (document.getElementById('lp-id')?.value  || '').trim().toUpperCase();
    const pin = (document.getElementById('lp-pin')?.value || '').trim();
    if (!id || !pin) { _err('login', 'Veuillez remplir tous les champs.'); return; }
    if (!id.match(/^MC-\d{4}-[A-Z]{2}-[A-Z0-9]{8}$/)) {
      _err('login', '❌ Format invalide. Ex : MC-2026-CD-A3B7X9Q2'); return; }
    const patient = DB.getPatientById(id);
    if (!patient) { _err('login', '❌ Numéro de fiche introuvable. Contactez votre médecin.'); return; }
    if (pin.length < 4) { _err('login', '❌ PIN trop court — minimum 4 chiffres.'); return; }

    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.patient_id === id && a.role === 'patient');

    if (!existing) {
      // Premier accès → créer le PIN
      const acc = { uid:`PAT_${id}`, username:id, password:pin, role:'patient',
                    name:`${patient.firstname} ${patient.lastname}`, patient_id:id,
                    created_at:new Date().toISOString() };
      accounts.push(acc);
      DB.saveAccounts(accounts);
      localStorage.setItem('mc_my_patient_id', id);
      _save(acc); _launch(acc);
      App.toast(`✅ Bienvenue ${patient.firstname} ! PIN créé avec succès.`);
      return;
    }
    if (existing.password !== pin) { _err('login', '❌ PIN incorrect.'); return; }
    localStorage.setItem('mc_my_patient_id', id);
    _save(existing); _launch(existing);
  }

  function _doDoctor() {
    const num  = (document.getElementById('ld-num')?.value  || '').trim().toUpperCase();
    const pass = (document.getElementById('ld-pass')?.value || '').trim();
    if (!num || !pass) { _err('login', 'Veuillez remplir tous les champs.'); return; }
    if (!ACL.isDoctorVerified(num)) {
      _err('login', '❌ N° d\'Ordre non reconnu dans le registre.\nDemandez à l\'administrateur de vous enregistrer, ou utilisez un numéro de démo.'); return; }
    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.order_num === num && a.role === 'doctor');
    if (existing) {
      if (existing.password !== pass) { _err('login', '❌ Mot de passe incorrect.'); return; }
      _save(existing); _launchDoctor(existing); return;
    }
    // Compte non encore créé → erreur, doit s'inscrire d'abord
    _err('login', '⚠️ Compte non trouvé. Allez dans l\'onglet Inscription pour créer votre compte médecin.');
  }

  function _doPharmacist() {
    const num  = (document.getElementById('lph-num')?.value  || '').trim().toUpperCase();
    const pass = (document.getElementById('lph-pass')?.value || '').trim();
    if (!num || !pass) { _err('login', 'Veuillez remplir tous les champs.'); return; }
    if (!ACL.isPharmacistVerified(num)) {
      _err('login', '❌ N° Matricule non reconnu. Contactez l\'administrateur.'); return; }
    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.matricule === num && a.role === 'pharmacist');
    if (existing) {
      if (existing.password !== pass) { _err('login', '❌ Mot de passe incorrect.'); return; }
      _save(existing); _launch(existing); return;
    }
    _err('login', '⚠️ Compte non trouvé. Allez dans l\'onglet Inscription pour créer votre compte.');
  }

  function _doNurse() {
    const num  = (document.getElementById('ln-num')?.value  || '').trim().toUpperCase();
    const pass = (document.getElementById('ln-pass')?.value || '').trim();
    if (!num || !pass) { _err('login', 'Veuillez remplir tous les champs.'); return; }
    if (!ACL.isNurseVerified(num)) {
      _err('login', '❌ N° Matricule infirmier non reconnu.'); return; }
    const accounts = DB.getAccounts();
    const existing = accounts.find(a => a.matricule === num && a.role === 'nurse');
    if (existing) {
      if (existing.password !== pass) { _err('login', '❌ Mot de passe incorrect.'); return; }
      _save(existing); _launch(existing); return;
    }
    _err('login', '⚠️ Compte non trouvé. Allez dans l\'onglet Inscription.');
  }

  /* ══ ACTIONS INSCRIPTION ════════════════════════ */

  function _regDoctor() {
    const num   = (document.getElementById('rd-num')?.value   || '').trim().toUpperCase();
    const pass  = (document.getElementById('rd-pass')?.value  || '').trim();
    const pass2 = (document.getElementById('rd-pass2')?.value || '').trim();
    if (!num || !pass) { _err('reg', 'Veuillez remplir tous les champs.'); return; }
    if (pass !== pass2) { _err('reg', '❌ Les mots de passe ne correspondent pas.'); return; }
    if (pass.length < 6) { _err('reg', '❌ Mot de passe trop court (min. 6 caractères).'); return; }
    if (!ACL.isDoctorVerified(num)) {
      _err('reg', `❌ N° d'Ordre "${num}" non trouvé dans le registre.\n\nNuméros disponibles (démo) :\nOM-CD-2024-0042 · OM-CD-2024-0117\nOM-SN-2023-0089 · OM-CI-2024-0203`); return; }
    const accounts = DB.getAccounts();
    if (accounts.find(a => a.order_num === num)) {
      _err('reg', '⚠️ Un compte existe déjà pour ce numéro. Utilisez l\'onglet Connexion.'); return; }
    const docInfo = ACL.getVerifiedDoctors().find(d => d.order_num === num);
    const acc = { uid:`DOC_${num}`, username:num, password:pass, role:'doctor',
                  name:docInfo?.name||`Médecin ${num}`, order_num:num,
                  specialty:docInfo?.specialty||'', country:docInfo?.country||'',
                  created_at:new Date().toISOString() };
    accounts.push(acc); DB.saveAccounts(accounts);
    _save(acc);
    App.toast(`✅ Bienvenue Dr. ${acc.name} !`);
    _launchDoctor(acc);
  }

  function _regPharmacist() {
    const num   = (document.getElementById('rph-num')?.value   || '').trim().toUpperCase();
    const pass  = (document.getElementById('rph-pass')?.value  || '').trim();
    const pass2 = (document.getElementById('rph-pass2')?.value || '').trim();
    if (!num || !pass) { _err('reg', 'Veuillez remplir tous les champs.'); return; }
    if (pass !== pass2) { _err('reg', '❌ Les mots de passe ne correspondent pas.'); return; }
    if (pass.length < 6) { _err('reg', '❌ Mot de passe trop court.'); return; }
    if (!ACL.isPharmacistVerified(num)) {
      _err('reg', `❌ Matricule "${num}" non trouvé.\n\nNuméros disponibles (démo) :\nPH-CD-2024-0015 · PH-CD-2024-0032 · PH-SN-2023-0077`); return; }
    const accounts = DB.getAccounts();
    if (accounts.find(a => a.matricule === num && a.role === 'pharmacist')) {
      _err('reg', '⚠️ Compte déjà existant. Utilisez l\'onglet Connexion.'); return; }
    const phInfo = ACL.getVerifiedPharmacists().find(p => p.matricule === num);
    const acc = { uid:`PH_${num}`, username:num, password:pass, role:'pharmacist',
                  name:phInfo?.name||`Pharmacien ${num}`, pharmacy:phInfo?.pharmacy||'',
                  matricule:num, country:phInfo?.country||'',
                  created_at:new Date().toISOString() };
    accounts.push(acc); DB.saveAccounts(accounts);
    _save(acc);
    App.toast(`✅ Bienvenue ${acc.name} !`);
    _launch(acc);
  }

  function _regNurse() {
    const num   = (document.getElementById('rn-num')?.value   || '').trim().toUpperCase();
    const pass  = (document.getElementById('rn-pass')?.value  || '').trim();
    const pass2 = (document.getElementById('rn-pass2')?.value || '').trim();
    if (!num || !pass) { _err('reg', 'Veuillez remplir tous les champs.'); return; }
    if (pass !== pass2) { _err('reg', '❌ Les mots de passe ne correspondent pas.'); return; }
    if (pass.length < 6) { _err('reg', '❌ Mot de passe trop court.'); return; }
    if (!ACL.isNurseVerified(num)) {
      _err('reg', `❌ Matricule "${num}" non trouvé.\n\nNuméros disponibles (démo) :\nINF-CD-2024-0089 · INF-CM-2024-0034`); return; }
    const accounts = DB.getAccounts();
    if (accounts.find(a => a.matricule === num && a.role === 'nurse')) {
      _err('reg', '⚠️ Compte déjà existant. Utilisez l\'onglet Connexion.'); return; }
    const nurseInfo = ACL.getVerifiedNurses().find(n => n.matricule === num);
    const acc = { uid:`NUR_${num}`, username:num, password:pass, role:'nurse',
                  name:nurseInfo?.name||`Infirmier ${num}`, matricule:num,
                  created_at:new Date().toISOString() };
    accounts.push(acc); DB.saveAccounts(accounts);
    _save(acc);
    App.toast(`✅ Bienvenue ${acc.name} !`);
    _launch(acc);
  }

  /* ══ LAUNCH ════════════════════════════════════ */
  function _launch(acc) {
    document.getElementById('auth-screen').style.display = 'none';
    App.afterLogin(acc);
  }

  function _launchDoctor(acc) {
    const hosps = HospitalsRegistry.getDoctorHospitals(acc.uid);
    if (hosps.length > 0 && !HospitalsRegistry.getCurrentHospital()) {
      sessionStorage.setItem('mc_current_hospital', hosps[0].hid);
    }
    _launch(acc);
  }

  /* ══ HELPERS ════════════════════════════════════ */
  function _err(scope, msg) {
    const id  = scope === 'login' ? 'auth-err' : 'reg-err';
    const el  = document.getElementById(id);
    if (el) { el.innerHTML = msg.replace(/\n/g,'<br>'); el.style.display = 'block'; }
  }

  function getRoleIcon(role)  { return ROLE_ICONS[role]  || '👤'; }
  function getRoleLabel(role) { return ROLE_LABELS[role] || role; }

  return {
    getUser, isLogged, logout, showLogin,
    _tab, _loginRole, _registerRole,
    _doPatient, _doDoctor, _doPharmacist, _doNurse,
    _regDoctor, _regPharmacist, _regNurse,
    getRoleIcon, getRoleLabel,
  };
})();

/* ══ ACCÈS ADMIN (5 clics sur le logo) ════════════ */
(function() {
  let clicks = 0, timer;
  document.addEventListener('click', function(e) {
    if (e.target.closest('.auth-logo') || e.target.closest('.landing-logo')) {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(() => clicks = 0, 2000);
      if (clicks >= 5) {
        clicks = 0;
        _showAdminLogin();
      }
    }
  });
})();

function _showAdminLogin() {
  App.openModal('⚙️ Accès Administrateur', `
    <form onsubmit="Auth._doAdmin(event)">
      <div class="form-group">
        <label class="inp-lbl">Identifiant admin</label>
        <input type="text" id="adm-user" class="inp" placeholder="admin" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="inp-lbl">Mot de passe</label>
        <input type="password" id="adm-pass" class="inp" placeholder="••••••••••••">
      </div>
      <div id="adm-err" class="auth-error" style="display:none"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button type="submit" class="btn btn-primary">⚙️ Connexion Admin</button>
      </div>
    </form>`);
}

function _doAdmin(e) {
  e.preventDefault();
  const user = (document.getElementById('adm-user')?.value || '').trim();
  const pass = (document.getElementById('adm-pass')?.value || '').trim();
  const ADMIN = { uid:'admin_root', username:'admin', password:'MedConnect@2026!',
                  role:'admin', name:'Administrateur MedConnect' };
  if (user === ADMIN.username && pass === ADMIN.password) {
    App.closeModal();
    sessionStorage.setItem('mc_user', JSON.stringify(ADMIN));
    document.getElementById('auth-screen').style.display = 'none';
    App.afterLogin(ADMIN);
    App.toast('⚙️ Bienvenue Administrateur');
  } else {
    const el = document.getElementById('adm-err');
    if (el) { el.textContent = '❌ Identifiants incorrects.'; el.style.display = 'block'; }
  }
}

/* Exposer _doAdmin globalement */
Auth._showAdminLogin = _showAdminLogin;
Auth._doAdmin        = _doAdmin;
window.Auth          = Auth;
