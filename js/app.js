// ========== MedConnect — Main Application Controller ==========

window.App = (() => {
  let currentPortal = null;
  const LANGUAGE_STORAGE_KEY = 'medconnect_language';
  const translations = {
    fr: {
      pageTitle: 'MedConnect — Plateforme Médicale Universelle',
      metaDescription: 'MedConnect — Application médicale gratuite pour patients, hôpitaux et pharmacies. Gestion des dossiers médicaux, vente de médicaments, localisation GPS.',
      languageChanged: 'Langue changée en Français',
      themeToggleLanding: '🌓 Mode Sombre/Clair',
      themeToggleSidebar: '🌓 Thème Clair / Sombre',
      themeLightActivated: 'Thème Clair activé',
      themeDarkActivated: 'Thème Sombre activé',
      landingSubtitle: 'Plateforme médicale universelle et gratuite — Gérez les dossiers patients, les ventes en pharmacie et localisez les établissements de santé.',
      portalPatientTitle: 'Patient',
      portalPatientText: 'Fiche médicale personnelle, historique des consultations, ordonnances et localisation.',
      portalHospitalTitle: 'Hôpital / Docteur',
      portalHospitalText: 'Gestion des patients, dossiers médicaux, rendez-vous et tableau de bord.',
      portalPharmacyTitle: 'Pharmacie',
      portalPharmacyText: "Point de vente, gestion d'inventaire, historique des ventes et localisation.",
      landingContact: '📞 Contact : +243 856 373 707 | ✉️ hallo.mediavision.tech@gmail.com | 100% Gratuit & Open Source',
      backHome: "← Retour à l'accueil",
      footerVersion: 'MedConnect v1.1 © 2026',
      footerOffline: '📱 App installable hors-ligne',
      sidebarPatient: 'Patient',
      sidebarHospital: 'Hôpital',
      sidebarPharmacy: 'Pharmacie',
    },
    en: {
      pageTitle: 'MedConnect — Universal Medical Platform',
      metaDescription: 'MedConnect — Free medical app for patients, hospitals, and pharmacies. Medical records, medicine sales, and GPS location tools.',
      languageChanged: 'Language changed to English',
      themeToggleLanding: '🌓 Dark / Light Mode',
      themeToggleSidebar: '🌓 Light / Dark Theme',
      themeLightActivated: 'Light theme enabled',
      themeDarkActivated: 'Dark theme enabled',
      landingSubtitle: 'A free universal medical platform to manage patient records, pharmacy sales, and nearby health facilities.',
      portalPatientTitle: 'Patient',
      portalPatientText: 'Personal medical profile, consultation history, prescriptions, and location tools.',
      portalHospitalTitle: 'Hospital / Doctor',
      portalHospitalText: 'Patient management, medical records, appointments, and dashboard.',
      portalPharmacyTitle: 'Pharmacy',
      portalPharmacyText: 'Point of sale, inventory management, sales history, and location tools.',
      landingContact: '📞 Contact: +243 856 373 707 | ✉️ hallo.mediavision.tech@gmail.com | 100% Free & Open Source',
      backHome: '← Back to home',
      footerVersion: 'MedConnect v1.1 © 2026',
      footerOffline: '📱 Offline installable app',
      sidebarPatient: 'Patient',
      sidebarHospital: 'Hospital',
      sidebarPharmacy: 'Pharmacy',
    },
  };

  async function initialize() {
    await MedDB.openDB();
    await MedDB.seedDemoData();
    await seedDemoPrescriptions();
    setupEventListeners();
    applySavedLanguage();
    applySavedTheme();
  }

  // Seed demo shared prescriptions if none exist
  async function seedDemoPrescriptions() {
    const patients = await MedDB.dbGetAll('patients');
    const findPatient = (serial, fallbackName, fallbackTel) => {
      const patient = patients.find(p => p.identiteNumero === serial);
      if (!patient) {
        return { id: null, name: fallbackName, tel: fallbackTel };
      }
      return { id: patient.id, name: `${patient.prenom} ${patient.nom}`, tel: patient.telephone || fallbackTel };
    };
    const marie = findPatient('MC-PAT-0001', 'Marie Dupont', '+243 999 123 456');
    const patrick = findPatient('MC-PAT-0002', 'Patrick Kabongo', '+243 998 456 789');
    const existing = JSON.parse(localStorage.getItem('medconnect_prescriptions') || '[]');
    const seedVersion = localStorage.getItem('medconnect_demo_prescriptions_seed_version');

    const demoPrescriptions = [
      {
        code: 'RX-MK7D3F9A',
        patientId: marie.id,
        patientNom: marie.name,
        patientTel: marie.tel,
        docteur: 'Dr. Mukendi',
        date: '2026-05-15',
        diagnostic: "Crise d'asthme modérée",
        traitement: 'Ventoline 100µg - 2 bouffées x3/jour pendant 7 jours',
        notes: 'Contrôle dans 2 semaines',
        statut: 'active',
        dispensedAt: null,
        dispensedBy: null,
      },
      {
        code: 'RX-KG4P8W2B',
        patientId: patrick.id,
        patientNom: patrick.name,
        patientTel: patrick.tel,
        docteur: 'Dr. Mukendi',
        date: '2026-05-18',
        diagnostic: 'Contrôle glycémie',
        traitement: 'Metformine 500mg - 2x/jour',
        notes: 'HbA1c à 7.2%, amélioration',
        statut: 'dispensée',
        dispensedAt: '2026-05-18T14:30:00',
        dispensedBy: 'Pharmacie Centrale',
      },
    ];

    const shouldAddMissing = seedVersion !== '2';
    let changed = false;
    for (const demoPrescription of demoPrescriptions) {
      if (!demoPrescription.patientId) continue;
      const index = existing.findIndex(p => p.code === demoPrescription.code);
      if (index === -1) {
        if (shouldAddMissing) {
          existing.push(demoPrescription);
          changed = true;
        }
        continue;
      }

      const current = existing[index];
      const updated = {
        ...current,
        patientId: demoPrescription.patientId,
        patientNom: demoPrescription.patientNom,
        patientTel: demoPrescription.patientTel,
      };
      if (JSON.stringify(current) !== JSON.stringify(updated)) {
        existing[index] = updated;
        changed = true;
      }
    }

    if (changed) {
      localStorage.setItem('medconnect_prescriptions', JSON.stringify(existing));
    }
    localStorage.setItem('medconnect_demo_prescriptions_seed_version', '2');
  }

  function setupEventListeners() {
    // Mobile menu toggle
    document.getElementById('mobile-menu-btn')?.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.toggle('open');
    });

    // Close sidebar on main content click (mobile)
    document.querySelector('.main-content')?.addEventListener('click', () => {
      document.querySelector('.sidebar')?.classList.remove('open');
    });

    // Close modal on overlay click
    document.getElementById('global-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'global-modal') closeModal();
    });

    // Keyboard shortcut
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    document.querySelectorAll('[data-language-select]').forEach((select) => {
      select.addEventListener('change', (e) => setLanguage(e.target.value));
    });
  }

  async function openPortal(portalName) {
    currentPortal = portalName;
    MapModule.destroyMap();

    // Hide landing
    document.getElementById('landing').style.display = 'none';

    // Show app layout
    const appLayout = document.getElementById('app-layout');
    appLayout.classList.add('active');
    document.getElementById('mobile-menu-btn')?.classList.add('active');

    // Set sidebar
    const sidebarBrand = document.getElementById('sidebar-brand');
    const sidebarNav = document.getElementById('sidebar-nav');
    const mainContent = document.getElementById('main-content');

    let module;
    switch (portalName) {
      case 'patient':
        sidebarBrand.innerHTML = `<span>🩺</span> ${translate('sidebarPatient')}`;
        sidebarNav.innerHTML = PatientModule.getSidebarNav();
        mainContent.innerHTML = PatientModule.getHTML();
        module = PatientModule;
        break;
      case 'hospital':
        sidebarBrand.innerHTML = `<span>🏥</span> ${translate('sidebarHospital')}`;
        sidebarNav.innerHTML = HospitalModule.getSidebarNav();
        mainContent.innerHTML = HospitalModule.getHTML();
        module = HospitalModule;
        break;
      case 'pharmacy':
        sidebarBrand.innerHTML = `<span>💊</span> ${translate('sidebarPharmacy')}`;
        sidebarNav.innerHTML = PharmacyModule.getSidebarNav();
        mainContent.innerHTML = PharmacyModule.getHTML();
        module = PharmacyModule;
        break;
    }

    // Animate in
    appLayout.style.animation = 'fadeIn 0.4s ease';

    // Initialize module data
    await module.init();
  }

  function goHome() {
    MapModule.destroyMap();
    currentPortal = null;
    document.getElementById('app-layout').classList.remove('active');
    document.getElementById('mobile-menu-btn')?.classList.remove('active');
    document.getElementById('landing').style.display = 'flex';
    document.getElementById('landing').style.animation = 'fadeIn 0.4s ease';
  }

  function closeModal() {
    const modal = document.getElementById('global-modal');
    modal.classList.remove('active');
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function applySavedTheme() {
    const savedTheme = localStorage.getItem('medconnect_theme') || 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }

  function getCurrentLanguage() {
    const savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY) || document.documentElement.lang || 'fr';
    return translations[savedLanguage] ? savedLanguage : 'fr';
  }

  function translate(key) {
    const lang = getCurrentLanguage();
    return translations[lang]?.[key] || translations.fr[key] || key;
  }

  function applySavedLanguage() {
    setLanguage(getCurrentLanguage(), false);
  }

  function setLanguage(lang, notify = true) {
    const nextLanguage = translations[lang] ? lang : 'fr';
    localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    document.documentElement.lang = nextLanguage;
    document.title = translate('pageTitle');

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) metaDescription.setAttribute('content', translate('metaDescription'));

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = translate(element.dataset.i18n);
    });

    document.querySelectorAll('[data-language-select]').forEach((select) => {
      select.value = nextLanguage;
    });

    refreshPortalBrand();
    if (notify) showToast(translate('languageChanged'), 'success');
  }

  function refreshPortalBrand() {
    if (!currentPortal) return;

    const sidebarBrand = document.getElementById('sidebar-brand');
    const labels = {
      patient: ['🩺', translate('sidebarPatient')],
      hospital: ['🏥', translate('sidebarHospital')],
      pharmacy: ['💊', translate('sidebarPharmacy')],
    };
    const [icon, label] = labels[currentPortal] || ['🏥', 'MedConnect'];
    sidebarBrand.innerHTML = `<span>${icon}</span> ${label}`;
  }

  function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('medconnect_theme', isLight ? 'light' : 'dark');
    showToast(translate(isLight ? 'themeLightActivated' : 'themeDarkActivated'), 'success');
  }

  // Init on DOM ready
  document.addEventListener('DOMContentLoaded', initialize);

  return { openPortal, goHome, closeModal, showToast, toggleTheme, setLanguage };
})();
