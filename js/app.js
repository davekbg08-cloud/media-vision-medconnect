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

    // Sélecteur établissement pour médecins et infirmiers
    const hsc = document.getElementById('hospital-switcher-container');
    if (hsc && (role === 'doctor' || role === 'nurse')) {
      hsc.innerHTML = HospitalsRegistry.renderHospitalSwitcher(user.uid);
    } else if (hsc) {
      hsc.innerHTML = '';
    }

    // Info utilisateur
    const su = document.getElementById('sidebar-user');
    if (su) su.innerHTML = `
      <span>${Auth.getRoleIcon(role)}</span>
      <strong>${user.name}</strong>
      <br><small style="color:var(--text-muted)">${Auth.getRoleLabel(role)}</small>`;

    // Langue
    const slc = document.getElementById('sidebar-lang-container');
    if (slc) slc.innerHTML = I18n.renderSelector();
  }

  /* ── NAVIGATION ──────────────────────────────────── */
  function navigateTo(section) {
    document.querySelectorAll('.nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.section === section));
    document.getElementById('main-content').innerHTML =
      '<div class="loading">⏳</div>';
    closeMobileSidebar();
    setTimeout(() => routeSection(section), 40);
  }

  /* ── HOME / DÉCONNEXION ──────────────────────────── */
  function goHome() { Auth.logout(); }

  /* ── REFRESH ─────────────────────────────────────── */
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

  /* ── THEME ───────────────────────────────────────── */
  function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('mc_theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
  }

  /* ── MODAL ───────────────────────────────────────── */
  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = html;
    document.getElementById('global-modal').classList.add('active');
  }
  function closeModal() {
    document.getElementById('global-modal').classList.remove('active');
    document.getElementById('modal-body').innerHTML = '';
  }

  /* ── TOAST ───────────────────────────────────────── */
  function toast(msg, type = 'success') {
    const c  = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); }, 3500);
  }

  /* ── MOBILE ──────────────────────────────────────── */
  function closeMobileSidebar() { document.getElementById('sidebar')?.classList.remove('open'); }

  /* ── INIT ────────────────────────────────────────── */
  async function init() {
    I18n.init();
    if (localStorage.getItem('mc_theme') === 'light') document.body.classList.add('light-theme');

    // Injecter sélecteur langue landing
    const lc = document.getElementById('lang-selector-container');
    if (lc) lc.innerHTML = I18n.renderSelector();

    // Mobile menu
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () =>
      document.getElementById('sidebar')?.classList.toggle('open'));
    document.getElementById('main-content')?.addEventListener('click', closeMobileSidebar);
    document.getElementById('global-modal')?.addEventListener('click', e => {
      if (e.target === document.getElementById('global-modal')) closeModal();
    });

    ACL.initRegistry();

    // Sync Firebase
    await DB.init();

    // Auto-login si session active
    const user = Auth.getUser();
    if (user) { afterLogin(user); return; }

    // Afficher écran connexion
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
