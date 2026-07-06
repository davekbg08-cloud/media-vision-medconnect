/* =====================================================
   MedConnect — Sauvegarde de session locale
   -----------------------------------------------------
   La restauration cloud après réinstallation est gérée
   directement par auth.js::_restoreProfessional() (recherche
   par numéro professionnel seul, sans champ email — PARTIE M).
   Cette couche ne fait plus que sauvegarder/relire une copie
   de la session courante dans localStorage, pour limiter une
   perte de session due à un sessionStorage vidé par le système
   (PWA réinstallée mais Firestore déjà synchronisé).
   ===================================================== */
(function () {
  const BACKUP_KEY = 'mc_user_backup';

  function hasAuth() { return typeof Auth !== 'undefined' && !!Auth; }
  function safeJson(value) { try { return JSON.parse(value || 'null'); } catch { return null; } }
  function readBackup() { return safeJson(localStorage.getItem(BACKUP_KEY)); }
  function saveBackup(user) { if (!user) return; try { localStorage.setItem(BACKUP_KEY, JSON.stringify(user)); } catch (_) {} }
  function clearBackup() { try { localStorage.removeItem(BACKUP_KEY); } catch (_) {} }

  function patchAuth() {
    if (!hasAuth() || Auth.__restorePatchApplied) return;
    Auth.__restorePatchApplied = true;
    const originalGetUser = Auth.getUser?.bind(Auth);
    const originalLogout  = Auth.logout?.bind(Auth);
    const originalDoPatient    = Auth._doPatient?.bind(Auth);
    const originalDoDoctor     = Auth._doDoctor?.bind(Auth);
    const originalDoPharmacist = Auth._doPharmacist?.bind(Auth);
    const originalDoNurse      = Auth._doNurse?.bind(Auth);

    Auth.getUser = function () { return originalGetUser?.() || readBackup(); };
    Auth.logout  = function () { clearBackup(); return originalLogout?.(); };
    Auth._doPatient = async function () {
      const result = await originalDoPatient?.();
      saveBackup(Auth.getUser?.());
      return result;
    };
    async function wrapProfessional(originalFn) {
      const result = await originalFn?.();
      saveBackup(Auth.getUser?.());
      return result;
    }
    Auth._doDoctor     = function () { return wrapProfessional(originalDoDoctor); };
    Auth._doPharmacist = function () { return wrapProfessional(originalDoPharmacist); };
    Auth._doNurse      = function () { return wrapProfessional(originalDoNurse); };
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
      { label:I18n.t('nav_my_record'),     icon:'🪪', s:'my_record'     },
      { label:I18n.t('nav_timeline'),      icon:'🗓️', s:'timeline'      },
      { label:I18n.t('nav_history'),       icon:'📋', s:'history'       },
      { label:I18n.t('nav_prescriptions'), icon:'💊', s:'prescriptions' },
      { label:I18n.t('nav_lab'),           icon:'🧪', s:'lab'           },
      { label:I18n.t('nav_vaccinations'),  icon:'💉', s:'vaccinations'  },
      { label:I18n.t('nav_appointments'),  icon:'📅', s:'appointments'  },
      { label:I18n.t('nav_inbox'),         icon:'📨', s:'inbox'         },
      { label:I18n.t('nav_pharmacy_map'),  icon:'💊', s:'pharmacy_map'  },
      { label:I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
      { label:I18n.t('nav_settings'),      icon:'⚙️', s:'settings'      },
    ],
    doctor: () => [
      { label:I18n.t('nav_dashboard'),     icon:'📊', s:'dashboard'     },
      { label:I18n.t('nav_patients'),      icon:'👥', s:'patients'      },
      { label:I18n.t('nav_consultations'), icon:'🩺', s:'consultations' },
      { label:I18n.t('nav_prescriptions'), icon:'💊', s:'prescriptions' },
      { label:'Transferts',                icon:'🚑', s:'transfers'     },
      { label:I18n.t('nav_lab'),           icon:'🧪', s:'lab'           },
      { label:I18n.t('nav_appointments'),  icon:'📅', s:'appointments'  },
      { label:I18n.t('nav_inbox'),         icon:'📨', s:'inbox'         },
      { label:I18n.t('nav_hospitals'),     icon:'🏥', s:'hospitals'     },
      { label:I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
      { label:I18n.t('nav_settings'),      icon:'⚙️', s:'settings'      },
    ],
    nurse: () => [
      { label:I18n.t('nav_patients'),      icon:'👥', s:'patients'      },
      { label:I18n.t('nav_prescriptions'), icon:'💊', s:'prescriptions' },
      { label:I18n.t('nav_vaccinations'),  icon:'💉', s:'vaccinations'  },
      { label:'Transferts',                icon:'🚑', s:'transfers'     },
      { label:I18n.t('nav_appointments'),  icon:'📅', s:'appointments'  },
      { label:I18n.t('nav_inbox'),         icon:'📨', s:'inbox'         },
      { label:I18n.t('nav_hospitals'),     icon:'🏥', s:'hospitals'     },
      { label:I18n.t('nav_pharmacy_map'),  icon:'💊', s:'pharmacy_map'  },
      { label:I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
      { label:I18n.t('nav_settings'),      icon:'⚙️', s:'settings'      },
    ],
    pharmacist: () => [
      { label:I18n.t('nav_dashboard'),     icon:'📊', s:'dashboard'     },
      { label:I18n.t('nav_pharmacy_rx'),   icon:'💊', s:'pharmacy_rx'   },
      { label:I18n.t('nav_pos'),           icon:'🛒', s:'pos'           },
      { label:I18n.t('nav_inventory'),     icon:'📦', s:'inventory'     },
      { label:I18n.t('nav_sales'),         icon:'📈', s:'sales'         },
      { label:I18n.t('nav_inbox'),         icon:'📨', s:'inbox'         },
      { label:I18n.t('nav_pharmacy_map'),  icon:'💊', s:'pharmacy_map'  },
      { label:I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
      { label:I18n.t('nav_settings'),      icon:'⚙️', s:'settings'      },
    ],
    admin: () => [
      { label:I18n.t('nav_admin_dashboard'),icon:'⚙️', s:'dashboard'    },
      { label:I18n.t('nav_hospitals'),     icon:'🏥', s:'hospitals'     },
      { label:I18n.t('nav_appointments'),  icon:'📅', s:'appointments'  },
      { label:I18n.t('nav_map'),           icon:'🗺️', s:'map'           },
      { label:I18n.t('nav_inbox'),         icon:'📨', s:'inbox'         },
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
        // L'infirmière passait dans la vue PATIENT (qui filtre sur un
        // patient_id qu'elle n'a pas → toujours vide). Elle partage la
        // vue établissement, filtrée par consentement dans itemInContext.
        if (role === 'doctor' || role === 'admin' || role === 'nurse') HospitalPortal.renderPrescriptions(main);
        else PatientPortal.renderPrescriptions(main);
        break;
      case 'transfers':
        HospitalPortal.renderTransfers(main);
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
    try { buildNav(user); } catch (e) { console.warn('[App] buildNav :', e); }
    try {
      const first = (MENUS[user.role] || MENUS.patient)()[0];
      navigateTo(first.s);
    } catch (e) {
      console.warn('[App] navigation initiale :', e);
    }
    startExchangeSync(user);
  }

  /* ── ÉCOUTE DU CONTRAT D'ÉCHANGE mobile ↔ desktop ──
     ExchangeBridge.startRoleListeners existait mais n'était
     branché nulle part : le desktop écrivait, le mobile ne
     recevait jamais. Première émission de chaque collection =
     état initial (silencieux, sauf compteur de notifications
     non lues) ; les suivantes = vraie nouveauté, notifiée.
     Les écritures restent gatées par l'abonnement desktop
     (ExchangeBridge + règles) ; l'écoute est de la lecture,
     toujours autorisée par le contrat à deux vitesses. */
  const _exchangeSeen = new Set();
  function startExchangeSync(user) {
    if (!user) return;
    // Tout ce bloc est secondaire à l'affichage de l'écran : s'il
    // échoue (listener rejeté, module absent…), il ne doit JAMAIS
    // empêcher l'ouverture de la session — sinon un simple souci de
    // pont d'échange fait « planter » un compte (ex. admin) au login.
    try {
      window.DB?.setupUserScopedListeners?.();
    } catch (e) {
      console.warn('[App] setupUserScopedListeners a échoué (ignoré) :', e);
    }
    if (!window.ExchangeBridge?.startRoleListeners) return;
    _exchangeSeen.clear();
    const LIVE_LABELS = {
      labResults:            '🧪 Nouveau résultat d\'analyse disponible',
      labRequests:           '🧪 Nouvelle demande d\'analyse au laboratoire',
      prescriptions:         '💊 Ordonnance mise à jour',
      consultations:         '🩺 Consultation mise à jour',
      notifications:         '📨 Nouvelle notification',
      registration_requests: '🆕 Nouvelle demande d\'inscription',
    };
    try {
      ExchangeBridge.startRoleListeners((col, docs) => {
        if (!_exchangeSeen.has(col)) {
          _exchangeSeen.add(col);
          if (col === 'notifications' && docs.length) {
            toast(`📨 ${docs.length} notification(s) non lue(s)`);
          }
          return;
        }
        if (LIVE_LABELS[col] && docs.length) toast(LIVE_LABELS[col]);
        // Rafraîchit la section affichée si elle correspond à la donnée reçue.
        const related = { labResults:'lab', labRequests:'lab', prescriptions:'prescriptions', consultations:'consultations' };
        if (related[col] && related[col] === currentSection) {
          try { routeSection(currentSection); } catch (_) {}
        }
      });
    } catch (e) {
      console.warn('[App] startRoleListeners a échoué (ignoré) :', e);
    }
  }

  /* ── BUILD NAV ───────────────────────────────────── */
  function buildNav(user) {
    const role  = user?.role || 'patient';
    const items = (MENUS[role] || MENUS.patient)();
    // Comptage par destinataire réel (uid/matricule/n° patient) via
    // Network.getUnread — l'ancien filtre to_role comptait les
    // messages de TOUS les utilisateurs du même rôle et ignorait
    // readStatus (lecture faite sur un autre appareil).
    const unread = window.Network?.getUnread ? Network.getUnread(role)
      : DB.getMessages().filter(m => m.to_role === role && !m.read).length;

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

    // ── AIGUILLAGE DESKTOP vs MOBILE ──
    // Le desktop est destiné à l'hôpital : entrée par connexion
    // d'établissement (matricule + mot de passe), jamais l'écran
    // mobile d'inscription médecin/patient/infirmier/pharmacien.
    const isDesktop = window.ExchangeBridge?.currentSourceDevice?.() === 'desktop';
    if (isDesktop && window.HospitalAuth) {
      const hs = HospitalAuth.getSession();
      if (hs && window.HospitalDesktopUI?.openForSession) {
        document.getElementById('auth-screen').style.display = 'none';
        HospitalDesktopUI.openForSession(hs);
      } else {
        HospitalAuth.renderScreen();
      }
      return;
    }

    const user = Auth.getUser();
    if (user) { afterLogin(user); return; }

    Auth.showLogin();
  }

  return {
    afterLogin, buildNav, navigateTo, goHome, refresh, startExchangeSync,
    toggleTheme, openModal, closeModal, toast, init,
    closeMobileSidebar,
  };
})();

window.App = App;
window.addEventListener('DOMContentLoaded', App.init);
