/* =====================================================
   MedConnect — Restauration douce session / cloud
   -----------------------------------------------------
   Cette couche ne remplace pas auth.js. Elle ajoute :
   - une sauvegarde locale de session contrôlée ;
   - une restauration cloud pour les comptes professionnels
     après réinstallation, via email Firebase Auth + mot de passe ;
   - un message clair si la restauration n'est pas possible.
   ===================================================== */
(function () {
  const BACKUP_KEY = 'mc_user_backup';
  const PROFESSIONAL_EMAIL_IDS = { doctor:'ld-email', pharmacist:'lph-email', nurse:'ln-email' };

  function hasAuth() { return typeof Auth !== 'undefined' && !!Auth; }
  function hasFirebase() { return typeof firebaseAuth !== 'undefined' && !!firebaseAuth && typeof firebaseDB !== 'undefined' && !!firebaseDB; }
  function safeJson(value) { try { return JSON.parse(value || 'null'); } catch { return null; } }
  function readBackup() { return safeJson(localStorage.getItem(BACKUP_KEY)); }
  function saveBackup(user) { if (!user) return; try { localStorage.setItem(BACKUP_KEY, JSON.stringify(user)); } catch (_) {} }
  function saveSession(user) { if (!user) return; try { sessionStorage.setItem('mc_user', JSON.stringify(user)); } catch (_) {} saveBackup(user); }
  function clearBackup() { try { localStorage.removeItem(BACKUP_KEY); } catch (_) {} }
  function value(id) { return (document.getElementById(id)?.value || '').trim(); }
  function showError(id, msg) { const el = document.getElementById(id); if (!el) return; el.innerHTML = String(msg || '').replace(/\n/g, '<br>'); el.style.display = msg ? 'block' : 'none'; }
  function professionalField(role) { return role === 'doctor' ? 'order_num' : 'matricule'; }

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
      (item.role === account.role && String(item[field] || item.username || '').toUpperCase() === String(account[field] || account.username || '').toUpperCase())
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

  async function restoreProfessionalFromCloud({ role, number, pass, email, errorId }) {
    if (!email) {
      showError(errorId, "⚠️ Compte introuvable sur cet appareil.\nAprès réinstallation, ajoutez l'adresse email utilisée lors de l'inscription pour restaurer le compte depuis le cloud.");
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
      if (account.role !== role) { showError(errorId, '❌ Ce compte cloud ne correspond pas au rôle sélectionné.'); return null; }
      if (cloudNumber && requestedNumber && cloudNumber !== requestedNumber) { showError(errorId, '❌ Le numéro professionnel ne correspond pas au compte cloud connecté.'); return null; }
      if (account.status === 'pending') { showError(errorId, '⏳ Compte retrouvé dans le cloud, mais il attend encore la validation administrateur.'); return null; }
      if (account.status === 'rejected') { showError(errorId, '❌ Compte retrouvé dans le cloud, mais la demande a été rejetée.'); return null; }
      if (account.status === 'suspended') { showError(errorId, '🚫 Compte suspendu. Contactez l’administrateur.'); return null; }
      if (!['approved', 'active'].includes(String(account.status || '').toLowerCase())) { showError(errorId, '⚠️ Statut du compte non valide pour la connexion. Contactez l’administrateur.'); return null; }
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
        <small style="color:var(--text-muted);font-size:.72rem">Si l'application a été réinstallée, cet email permet de restaurer vos données depuis Firestore.</small>
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

    Auth.getUser = function () { return originalGetUser?.() || readBackup(); };
    Auth.logout = function () { clearBackup(); return originalLogout?.(); };
    Auth._loginRole = function (role) { originalLoginRole?.(role); enhanceLoginForm(role); };
    Auth._doPatient = async function () { try { await DB.syncFromFirebase?.(); } catch (_) {} const result = await originalDoPatient?.(); saveBackup(Auth.getUser?.()); return result; };

    async function doProfessional(role, numberId, passId, emailId, originalFn) {
      const number = value(numberId).toUpperCase();
      const pass = value(passId);
      const email = value(emailId);
      if (!number || !pass) { showError('auth-err', 'Veuillez remplir tous les champs obligatoires.'); return; }
      const local = localProfessionalAccount(role, number);
      if (local) { const result = await originalFn?.(); saveBackup(Auth.getUser?.()); return result; }
      const restored = await restoreProfessionalFromCloud({ role, number, pass, email, errorId:'auth-err' });
      if (restored) launchRestoredAccount(restored);
    }

    Auth._doDoctor = function () { return doProfessional('doctor', 'ld-num', 'ld-pass', 'ld-email', originalDoDoctor); };
    Auth._doPharmacist = function () { return doProfessional('pharmacist', 'lph-num', 'lph-pass', 'lph-email', originalDoPharmacist); };
    Auth._doNurse = function () { return doProfessional('nurse', 'ln-num', 'ln-pass', 'ln-email', originalDoNurse); };
  }

  patchAuth();
})();

/* =====================================================
   MedConnect 2.0 — App Controller (Final)
   ===================================================== */
const App = (() => {

  /* ── MENUS PAR RÔLE ──────────────────────────────── */
  const MENUS = {
    patient: () => [
      { label:'Ma Fiche',          icon:'🪪', s:'my_record'     },
      { label:'Timeline',          icon:'🗓️', s:'timeline'      },
      { label:'Historique',        icon:'📋', s:'history'       },
      { label:'Ordonnances',       icon:'💊', s:'prescriptions' },
      { label:'Analyses',          icon:'🧪', s:'lab'           },
      { label:'Vaccinations',      icon:'💉', s:'vaccinations'  },
      { label:'Rendez-vous',       icon:'📅', s:'appointments'  },
      { label:'Messagerie',        icon:'📨', s:'inbox'         },
      { label:'Carte pharmacies',  icon:'💊', s:'pharmacy_map'  },
      { label:'Carte & GPS',       icon:'🗺️', s:'map'           },
      { label:'Paramètres',        icon:'⚙️', s:'settings'      },
    ],
    doctor: () => [
      { label:'Tableau de Bord',   icon:'📊', s:'dashboard'     },
      { label:'Patients',          icon:'👥', s:'patients'      },
      { label:'Consultations',     icon:'🩺', s:'consultations' },
      { label:'Ordonnances',       icon:'💊', s:'prescriptions' },
      { label:'Laboratoire',       icon:'🧪', s:'lab'           },
      { label:'Rendez-vous',       icon:'📅', s:'appointments'  },
      { label:'Messagerie',        icon:'📨', s:'inbox'         },
      { label:'Établissements',    icon:'🏥', s:'hospitals'     },
      { label:'Carte & GPS',       icon:'🗺️', s:'map'           },
      { label:'Paramètres',        icon:'⚙️', s:'settings'      },
    ],
    nurse: () => [
      { label:'Patients',          icon:'👥', s:'patients'      },
      { label:'Vaccinations',      icon:'💉', s:'vaccinations'  },
      { label:'Rendez-vous',       icon:'📅', s:'appointments'  },
      { label:'Messagerie',        icon:'📨', s:'inbox'         },
      { label:'Établissements',    icon:'🏥', s:'hospitals'     },
      { label:'Carte pharmacies',  icon:'💊', s:'pharmacy_map'  },
      { label:'Carte & GPS',       icon:'🗺️', s:'map'           },
      { label:'Paramètres',        icon:'⚙️', s:'settings'      },
    ],
    pharmacist: () => [
      { label:'Tableau de Bord',   icon:'📊', s:'dashboard'     },
      { label:'Ordonnances reçues',icon:'💊', s:'pharmacy_rx'   },
      { label:'Point de Vente',    icon:'🛒', s:'pos'           },
      { label:'Inventaire',        icon:'📦', s:'inventory'     },
      { label:'Ventes',            icon:'📈', s:'sales'         },
      { label:'Messagerie',        icon:'📨', s:'inbox'         },
      { label:'Carte pharmacies',  icon:'💊', s:'pharmacy_map'  },
      { label:'Carte & GPS',       icon:'🗺️', s:'map'           },
      { label:'Paramètres',        icon:'⚙️', s:'settings'      },
    ],
    admin: () => [
      { label:'Administration',    icon:'⚙️', s:'dashboard'     },
      { label:'Établissements',    icon:'🏥', s:'hospitals'     },
      { label:'Rendez-vous',       icon:'📅', s:'appointments'  },
      { label:'Carte & GPS',       icon:'🗺️', s:'map'           },
      { label:'Messagerie',        icon:'📨', s:'inbox'         },
    ],
  };

  /* ── ROUTING ─────────────────────────────────────── */
  function routeSection(section) {
    const main = document.getElementById('main-content');
    const user = Auth.getUser();
    const role = user?.role || 'patient';

    switch (section) {
      case 'my_record':     PatientPortal.renderMyRecord(main);                             break;
      case 'timeline':      Timeline.render(main, localStorage.getItem('mc_my_patient_id')); break;
      case 'history':       PatientPortal.renderHistory(main);                              break;
      case 'vaccinations':  PatientPortal.renderVaccinations(main);                         break;
      case 'appointments':  AppointmentsModule.render(main);                                break;
      case 'inbox':         Network.renderInbox(main);                                      break;
      case 'map':           MapModule.render(main);                                         break;
      case 'pharmacy_map':  MapModule.renderPharmacyMap(main);                              break;
      case 'settings':      Settings.render(main);                                          break;
      case 'hospitals':     HospitalsRegistry.renderManagePage(main);                       break;

      case 'prescriptions':
        if (role === 'doctor' || role === 'admin') HospitalPortal.renderPrescriptions(main);
        else PatientPortal.renderPrescriptions(main);
        break;

      case 'lab':
        if (role === 'patient') LabModule.renderForPatient(main, localStorage.getItem('mc_my_patient_id'));
        else                    LabModule.renderForHospital(main);
        break;

      case 'dashboard':
        if (role === 'pharmacist') PharmacyPortal.render('dashboard');
        else if (role === 'admin') AdminModule.renderDashboard(main);
        else                       HospitalPortal.render('dashboard');
        break;

      case 'patients':      HospitalPortal.render('patients');      break;
      case 'consultations': HospitalPortal.render('consultations'); break;
      case 'pos':           PharmacyPortal.render('pos');           break;
      case 'inventory':     PharmacyPortal.render('inventory');     break;
      case 'sales':         PharmacyPortal.render('sales');         break;
      case 'pharmacy_rx':   PharmacyPortal.render('prescriptions'); break;

      default:
        main.innerHTML = `<div class="card empty-state"><p>Section : ${section}</p></div>`;
    }
  }

  /* ── APRÈS LOGIN ─────────────────────────────────── */
  function afterLogin(user) {
    document.getElementById('auth-screen').style.display  = 'none';
    document.getElementById('landing').style.display      = 'none';
    document.getElementById('app-layout').style.display   = 'flex';
    buildNav(user);
    const first = (MENUS[user.role] || MENUS.patient)()[0];
    navigateTo(first.s);
  }

  /* ── BUILD NAV ───────────────────────────────────── */
  function buildNav(user) {
    const role  = user?.role || 'patient';
    const items = (MENUS[role] || MENUS.patient)();
    const unread = DB.getMessages().filter(m => m.to_role === role && !m.read).length;

    document.getElementById('sidebar-brand').innerHTML =
      `<span>${Auth.getRoleIcon(role)}</span> MedConnect`;
    document.getElementById('sidebar').className =
      `sidebar sidebar-${role==='pharmacist'?'pharmacy':role==='doctor'||role==='nurse'?'hospital':'patient'}`;

    document.getElementById('sidebar-nav').innerHTML = items.map(item => `
      <li class="nav-item" data-section="${item.s}" onclick="App.navigateTo('${item.s}')">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.s==='inbox' && unread>0 ? `<span class="badge-dot">${unread}</span>` : ''}
      </li>`).join('');

    const hsc = document.getElementById('hospital-switcher-container');
    if (hsc && (role === 'doctor' || role === 'nurse')) {
      hsc.innerHTML = HospitalsRegistry.renderHospitalSwitcher(user.uid);
    } else if (hsc) {
      hsc.innerHTML = '';
    }

    const su = document.getElementById('sidebar-user');
    if (su) su.innerHTML = `
      <span>${Auth.getRoleIcon(role)}</span>
      <strong>${user.name}</strong>
      <br><small style="color:var(--text-muted)">${Auth.getRoleLabel(role)}</small>
      ${role === 'admin' ? `
        <br><small style="color:${user.cloudSynced ? 'var(--secondary)' : 'var(--danger)'}">
          ${user.cloudSynced ? '☁️ Synchronisé Firestore' : '⚠️ Local uniquement — non synchronisé'}
        </small>` : ''}`;

    const slc = document.getElementById('sidebar-lang-container');
    if (slc) slc.innerHTML = I18n.renderSelector();
  }

  let currentSection = null;

  function navigateTo(section) {
    currentSection = section;
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.section === section));
    document.getElementById('main-content').innerHTML = '<div class="loading">⏳</div>';
    closeMobileSidebar();
    setTimeout(() => routeSection(section), 40);
  }

  /* ── Rafraîchissement auto (1s) ──────────────────────
     Les listeners Firestore mettent localStorage à jour en
     quasi temps réel ; ceci ne fait que ré-afficher l'écran
     courant pour le rendre visible immédiatement.
     Ne touche jamais un écran où l'utilisateur tape/sélectionne.
  ──────────────────────────────────────────────────────── */
  function _isUserTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    const main = document.getElementById('main-content');
    return (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
      && main && main.contains(el);
  }

  /* Sections sûres à ré-afficher automatiquement : aucune n'a d'état
     local sensible (panier, carte Leaflet, formulaire multi-étapes).
     'pos' (panier), 'map'/'pharmacy_map' (recréation Leaflet),
     'settings' et 'hospitals' sont volontairement exclues. */
  const AUTO_REFRESH_SAFE = new Set([
    'my_record','timeline','history','vaccinations','appointments',
    'inbox','prescriptions','lab','dashboard','patients',
    'consultations','inventory','sales','pharmacy_rx',
  ]);

  function _startAutoRefresh() {
    setInterval(() => {
      if (!currentSection || !AUTO_REFRESH_SAFE.has(currentSection)) return;
      const modal = document.getElementById('global-modal');
      if (modal && modal.classList.contains('active')) return; // ne pas casser un formulaire ouvert
      if (_isUserTyping()) return;                              // ne pas casser une saisie en cours
      if (!Auth.isLogged()) return;
      try { routeSection(currentSection); } catch (_) {}
    }, 1000);
  }

  function goHome() { Auth.logout(); }

  function refresh() {
    const lc = document.getElementById('lang-selector-container');
    if (lc) lc.innerHTML = I18n.renderSelector();
    const user = Auth.getUser();
    if (user) {
      buildNav(user);
      const active = document.querySelector('.nav-item.active');
      if (active) navigateTo(active.dataset.section);
    }
  }

  function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('mc_theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
  }

  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = html;
    document.getElementById('global-modal').classList.add('active');
  }
  function closeModal() {
    document.getElementById('global-modal').classList.remove('active');
    document.getElementById('modal-body').innerHTML = '';
  }

  function toast(msg, type = 'success') {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); }, 3500);
  }

  function closeMobileSidebar() { document.getElementById('sidebar')?.classList.remove('open'); }

  async function init() {
    I18n.init();
    if (localStorage.getItem('mc_theme') === 'light') document.body.classList.add('light-theme');

    const lc = document.getElementById('lang-selector-container');
    if (lc) lc.innerHTML = I18n.renderSelector();

    document.getElementById('mobile-menu-btn')?.addEventListener('click', () =>
      document.getElementById('sidebar')?.classList.toggle('open'));
    document.getElementById('main-content')?.addEventListener('click', closeMobileSidebar);
    document.getElementById('global-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('global-modal')) closeModal();
    });

    ACL.initRegistry();
    _startAutoRefresh();

    setTimeout(() => {
      DB.init().catch(error => console.warn('[MedConnect] Sync Firebase non bloquante :', error));
    }, 0);

    const user = Auth.getUser();
    if (user) { afterLogin(user); return; }

    Auth.showLogin();
  }

  return {
    afterLogin, buildNav, navigateTo, goHome, refresh,
    toggleTheme, openModal, closeModal, toast, init,
    closeMobileSidebar,
  };
})();

window.App = App;
window.addEventListener('DOMContentLoaded', App.init);
