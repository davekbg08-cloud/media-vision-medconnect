/* =====================================================
   MedConnect 2.0 — App Controller
   Auth + rôles + routing + theme + modal + toast
   ===================================================== */
const App = (() => {

  /* ── MENUS PAR RÔLE ──────────────────────────────── */
  const MENUS = {
    patient: () => [
      { label: I18n.t('nav_my_record'),     icon:'🪪', s:'my_record'     },
      { label: 'Timeline',                  icon:'🗓️', s:'timeline'      },
      { label: I18n.t('nav_history'),       icon:'📋', s:'history'       },
      { label: I18n.t('nav_prescriptions'), icon:'💊', s:'prescriptions' },
      { label: 'Analyses',                  icon:'🧪', s:'lab'           },
      { label: 'Vaccinations',              icon:'💉', s:'vaccinations'  },
      { label: 'Rendez-vous',               icon:'📅', s:'appointments'  },
      { label: '📨 Messagerie',             icon:'📨', s:'inbox'         },
      { label: I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
    ],
    doctor: () => [
      { label: I18n.t('nav_dashboard'),     icon:'📊', s:'dashboard'     },
      { label: I18n.t('nav_patients'),      icon:'👥', s:'patients'      },
      { label: I18n.t('nav_consultations'), icon:'🩺', s:'consultations' },
      { label: 'Ordonnances',               icon:'💊', s:'prescriptions' },
      { label: 'Laboratoire',               icon:'🧪', s:'lab'           },
      { label: 'Rendez-vous',               icon:'📅', s:'appointments'  },
      { label: '📨 Messagerie',             icon:'📨', s:'inbox'         },
      { label: 'Établissements',            icon:'🏥', s:'hospitals'     },
      { label: I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
    ],
    nurse: () => [
      { label: I18n.t('nav_patients'),      icon:'👥', s:'patients'      },
      { label: 'Vaccinations',              icon:'💉', s:'vaccinations'  },
      { label: 'Rendez-vous',               icon:'📅', s:'appointments'  },
      { label: '📨 Messagerie',             icon:'📨', s:'inbox'         },
      { label: 'Établissements',            icon:'🏥', s:'hospitals'     },
      { label: I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
    ],
    pharmacist: () => [
      { label: I18n.t('nav_dashboard'),     icon:'📊', s:'dashboard'     },
      { label: I18n.t('nav_pos'),           icon:'🛒', s:'pos'           },
      { label: I18n.t('nav_inventory'),     icon:'📦', s:'inventory'     },
      { label: I18n.t('nav_sales_history'), icon:'📈', s:'sales'         },
      { label: '📨 Messagerie',             icon:'📨', s:'inbox'         },
      { label: I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
    ],
    admin: () => [
      { label: 'Dashboard Admin',           icon:'⚙️', s:'dashboard'     },
      { label: I18n.t('nav_patients'),      icon:'👥', s:'patients'      },
      { label: I18n.t('nav_consultations'), icon:'🩺', s:'consultations' },
      { label: I18n.t('nav_inventory'),     icon:'📦', s:'inventory'     },
      { label: 'Rendez-vous',               icon:'📅', s:'appointments'  },
      { label: '📨 Messagerie',             icon:'📨', s:'inbox'         },
      { label: I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
    ],
  };

  /* ── RENDERERS PAR SECTION ────────────────────────── */
  function routeSection(section) {
    const main = document.getElementById('main-content');
    const user = Auth.getUser();
    const role = user?.role || 'patient';

    switch (section) {
      // Patient
      case 'my_record':     PatientPortal.renderMyRecord(main);                  break;
      case 'timeline':      Timeline.render(main, localStorage.getItem('mc_my_patient_id')); break;
      case 'history':       PatientPortal.renderHistory(main);                   break;
      case 'prescriptions':
        if (role==='doctor' || role==='admin') HospitalPortal.renderPrescriptions(main);
        else PatientPortal.renderPrescriptions(main);                            break;
      case 'vaccinations':  PatientPortal.renderVaccinations(main);              break;
      case 'lab':
        if (role==='doctor' || role==='nurse' || role==='admin') LabModule.renderForHospital(main);
        else LabModule.renderForPatient(main, localStorage.getItem('mc_my_patient_id')); break;

      // Shared
      case 'appointments':  AppointmentsModule.render(main, role==='patient' ? localStorage.getItem('mc_my_patient_id') : null); break;
      case 'inbox':         Network.renderInbox(main);                           break;
      case 'map':           MapModule.render(main);                              break;
      case 'hospitals':      HospitalsRegistry.renderManagePage(main);            break;

      // Hospital / Doctor
      case 'dashboard':
        if (role==='pharmacist') PharmacyPortal.render('dashboard');
        else                     HospitalPortal.render('dashboard');             break;
      case 'patients':      HospitalPortal.render('patients');                   break;
      case 'consultations': HospitalPortal.render('consultations');              break;

      // Pharmacy
      case 'pos':           PharmacyPortal.render('pos');                        break;
      case 'inventory':     PharmacyPortal.render('inventory');                  break;
      case 'sales':         PharmacyPortal.render('sales');                      break;

      default:
        main.innerHTML = `<div class="card empty-state"><p>Section : ${section}</p></div>`;
    }
  }

  /* ── AFTER LOGIN ──────────────────────────────────── */
  function afterLogin(user) {
    document.getElementById('auth-screen').style.display  = 'none';
    document.getElementById('landing').style.display      = 'none';
    document.getElementById('app-layout').style.display   = 'flex';
    buildNav(user);
    const first = (MENUS[user.role] || MENUS.patient)()[0];
    navigateTo(first.s);
  }

  /* ── NAV BUILD ────────────────────────────────────── */
  function buildNav(user) {
    const role  = user?.role || 'patient';
    const items = (MENUS[role] || MENUS.patient)();
    const icons = { patient:'🩺', doctor:'👨‍⚕️', pharmacist:'💊', nurse:'🩹', admin:'⚙️' };

    document.getElementById('sidebar-brand').innerHTML =
      `<span>${icons[role]||'🏥'}</span> MedConnect`;
    document.getElementById('sidebar-back-btn').textContent = '🚪 Déconnexion';
    document.getElementById('sidebar').className = `sidebar sidebar-${role==='pharmacist'?'pharmacy':role}`;

    // Unread badge
    const unread = Network.getUnread(role);
    document.getElementById('sidebar-nav').innerHTML = items.map(item => `
      <li class="nav-item" data-section="${item.s}" onclick="App.navigateTo('${item.s}')">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.s==='inbox' && unread>0 ? `<span class="badge-dot">${unread}</span>` : ''}
      </li>`).join('');

    // User info in sidebar footer
    document.getElementById('sidebar-user').innerHTML =
      `<span>${icons[role]||'👤'}</span> <strong>${user.name}</strong><br>
       <small style="color:var(--text-muted)">${role}</small>`;

    // Sidebar lang selector
    const slc = document.getElementById('sidebar-lang-container');
    if (slc) slc.innerHTML = I18n.renderSelector();

    // Hospital switcher for affiliated doctors
    const hsc = document.getElementById('hospital-switcher-container');
    if (hsc && role === 'doctor') {
      hsc.innerHTML = HospitalsRegistry.renderHospitalSwitcher(user.uid);
    } else if (hsc) {
      hsc.innerHTML = '';
    }
  }

  /* ── NAVIGATE ─────────────────────────────────────── */
  function navigateTo(section) {
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.section === section));
    document.getElementById('main-content').innerHTML = '<div class="loading">⏳</div>';
    closeMobileSidebar();
    setTimeout(() => routeSection(section), 40);
  }

  /* ── LEGACY (portal cards on landing) ────────────── */
  function openPortal(role) {
    const user = { uid:'guest', username:'guest', role, name:`${role} (invité)` };
    sessionStorage.setItem('mc_user', JSON.stringify(user));
    afterLogin(user);
  }

  /* ── HOME ─────────────────────────────────────────── */
  function goHome() {
    Auth.logout();
  }

  /* ── REFRESH ──────────────────────────────────────── */
  function refresh() {
    updateLandingTexts();
    const lc = document.getElementById('lang-selector-container');
    if (lc) lc.innerHTML = I18n.renderSelector();
    const user = Auth.getUser();
    if (user) {
      buildNav(user);
      const active = document.querySelector('.nav-item.active');
      if (active) navigateTo(active.dataset.section);
    }
  }

  function updateLandingTexts() {
    const byId = (id, txt) => { const el=document.getElementById(id); if(el) el.textContent=txt; };
    byId('landing-subtitle',      I18n.t('landing_subtitle'));
    byId('portal-patient-title',  I18n.t('portal_patient'));
    byId('portal-patient-desc',   I18n.t('portal_patient_desc'));
    byId('portal-hospital-title', I18n.t('portal_hospital'));
    byId('portal-hospital-desc',  I18n.t('portal_hospital_desc'));
    byId('portal-pharmacy-title', I18n.t('portal_pharmacy'));
    byId('portal-pharmacy-desc',  I18n.t('portal_pharmacy_desc'));
  }

  /* ── THEME ────────────────────────────────────────── */
  function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('mc_theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
  }

  /* ── MODAL ────────────────────────────────────────── */
  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = html;
    document.getElementById('global-modal').classList.add('active');
  }
  function closeModal() {
    document.getElementById('global-modal').classList.remove('active');
    document.getElementById('modal-body').innerHTML = '';
  }

  /* ── TOAST ────────────────────────────────────────── */
  function toast(msg, type = 'success') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); }, 3200);
  }

  /* ── MOBILE ───────────────────────────────────────── */
  function closeMobileSidebar() { document.getElementById('sidebar').classList.remove('open'); }

  /* ── INIT ─────────────────────────────────────────── */
  function init() {
    I18n.init();
    if (localStorage.getItem('mc_theme') === 'light') document.body.classList.add('light-theme');
    if (window.ACL?.initDemoRegistry) ACL.initDemoRegistry();
    if (window.HospitalsRegistry?.initDemoHospitals) HospitalsRegistry.initDemoHospitals();

    const lc = document.getElementById('lang-selector-container');
    if (lc) lc.innerHTML = I18n.renderSelector();
    updateLandingTexts();

    document.getElementById('mobile-menu-btn').addEventListener('click', () =>
      document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('main-content').addEventListener('click', closeMobileSidebar);
    document.getElementById('global-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('global-modal')) closeModal();
    });

    // Auto-login if session still active
    const user = Auth.getUser();
    if (user) { afterLogin(user); return; }

    // Show login screen by default
    Auth.showLogin();
  }

  return {
    openPortal, afterLogin, buildNav, navigateTo, goHome, refresh,
    toggleTheme, openModal, closeModal, toast, init,
  };
})();

window.App = App;
window.addEventListener('DOMContentLoaded', App.init);

