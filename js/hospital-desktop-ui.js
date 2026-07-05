/* =====================================================
   MedConnect 2.0 — HospitalDesktopUI (bundle desktop, adapté)
   Tableau de bord hôpital : ÉCRAN PLEIN ÉCRAN SÉPARÉ.

   DÉCISION D'ARCHITECTURE (validée) : ce shell ne s'imbrique
   PAS dans #main-content (sa sidebar entrerait en conflit
   visuel avec celle de App.buildNav()). Il se monte comme un
   overlay plein écran au-dessus du shell existant, avec :
   - sa propre sidebar (menu filtré par HospitalPermissions) ;
   - sa propre topbar (établissement, rôle, retour explicite) ;
   - un bouton « Retour à l'application » qui démonte l'overlay
     sans toucher à l'état du shell principal.

   Routes desktop natives : dashboard, beds, lab, ai,
   subscription. Les sections déjà couvertes par l'app
   (patients, consultations, médecins, pharmacie, paramètres)
   renvoient vers l'écran existant — on réutilise, on ne
   duplique pas.

   Lanceur : auto-installé dans la sidebar principale,
   uniquement sur desktop (produit sous abonnement) et pour
   le personnel (jamais pour les patients).
   ===================================================== */
const HospitalDesktopUI = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const ROOT_ID = 'hospital-desktop-root';
  const STAFF_ROLES = ['admin', 'doctor', 'nurse', 'pharmacist'];
  // Routes rendues nativement dans le shell desktop.
  const NATIVE_ROUTES = {
    dashboard:    (c) => renderDashboard(c),
    beds:         (c) => HospitalBedsModule.render(c),
    lab:          (c) => HospitalLabModule.render(c),
    ai:           (c) => MedicalAIModule.render(c),
    subscription: (c) => HospitalSubscriptionModule.render(c),
  };
  // Routes déjà couvertes par l'app principale → renvoi.
  const APP_SECTIONS = {
    patients: 'patients',
    consultations: 'consultations',
    doctors: 'hospitals',
    pharmacy: 'pos',
    settings: 'settings',
  };

  let _current = 'dashboard';

  function isOpen() { return !!document.getElementById(ROOT_ID); }

  function open() {
    try {
      const user = window.Auth?.getUser?.();
      if (!user || !STAFF_ROLES.includes(user.role)) {
        App.toast('Espace réservé au personnel hospitalier.', 'error');
        return;
      }
      const hospital = window.HospitalsRegistry?.getCurrentHospital?.();
      if (!hospital) {
        App.toast('Sélectionnez d\'abord un établissement actif.', 'error');
        return;
      }
      if (isOpen()) { navigate(_current); return; }

      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.innerHTML = buildShell(user, hospital);
      document.body.appendChild(root);
      document.body.classList.add('hospital-desktop-open');
      navigate('dashboard');
    } catch (e) {
      console.error('[HospitalDesktopUI] open :', e);
      App.toast(e.message || 'Impossible d\'ouvrir l\'espace hôpital.', 'error');
    }
  }

  function close() {
    document.getElementById(ROOT_ID)?.remove();
    document.body.classList.remove('hospital-desktop-open');
  }

  function buildShell(user, hospital) {
    const menu = HospitalPermissions.visibleMenuFor(user.role);
    return `
      <aside class="hospital-sidebar">
        <div class="hospital-sidebar-brand">
          <span>🏥</span>
          <div>
            <strong>${esc(hospital.name || 'Établissement')}</strong>
            <small>Espace hôpital — Desktop</small>
          </div>
        </div>
        <nav class="hospital-sidebar-nav">
          ${menu.map(m => `
            <button class="hospital-nav-item" data-route="${esc(m.key)}"
              onclick="HospitalDesktopUI.navigate('${esc(m.key)}')">
              <span>${m.icon}</span> ${esc(m.label)}
            </button>`).join('')}
        </nav>
        <button class="hospital-sidebar-exit" onclick="HospitalDesktopUI.close()">
          ← Retour à l'application
        </button>
      </aside>
      <div class="hospital-main">
        <header class="hospital-topbar">
          <div id="hospital-topbar-title">Tableau de bord</div>
          <div class="hospital-topbar-user">
            👤 ${esc(user.name || user.uid)} · ${esc(HospitalPermissions.roleLabel(user.role))}
          </div>
        </header>
        <div class="hospital-content" id="hospital-content"></div>
      </div>
    `;
  }

  async function navigate(route) {
    if (!isOpen()) return;

    // Sections déjà couvertes par l'app : on ferme l'espace hôpital
    // et on route dans le shell principal (réutilisation, pas de doublon).
    if (APP_SECTIONS[route]) {
      close();
      App.navigateTo(APP_SECTIONS[route]);
      return;
    }

    const renderer = NATIVE_ROUTES[route];
    if (!renderer) return;

    _current = route;
    document.querySelectorAll('.hospital-nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.route === route));

    const menu = HospitalPermissions.visibleMenuFor(HospitalPermissions.getCurrentRole());
    const entry = menu.find(m => m.key === route);
    const titleEl = document.getElementById('hospital-topbar-title');
    if (titleEl) titleEl.textContent = entry?.label || 'Tableau de bord';

    const content = document.getElementById('hospital-content');
    content.innerHTML = '<div class="loading">⏳</div>';
    try {
      await renderer(content);
    } catch (e) {
      console.error(`[HospitalDesktopUI] route ${route} :`, e);
      content.innerHTML = `<div class="card empty-state"><p>${esc(e.message || 'Erreur de chargement.')}</p></div>`;
    }
  }

  /* ── Tableau de bord ────────────────────────────── */

  async function renderDashboard(container) {
    HospitalPermissions.requireRoute('dashboard');
    const hospital = await CloudDB.getActiveHospital();
    const hospitalId = hospital.establishmentId || hospital.id;

    container.innerHTML = `<div class="card empty-state"><p>Chargement…</p></div>`;

    let beds = [], admissions = [], labOrders = [];
    let sub = { status: 'active' };
    try {
      [beds, admissions, labOrders, sub] = await Promise.all([
        CloudDB.listByHospital('beds', hospitalId),
        CloudDB.listByHospital('admissions', hospitalId),
        CloudDB.listByHospital('labOrders', hospitalId),
        ExchangeBridge.getSubscriptionStatus(hospitalId).catch(() => ({ status: 'active' })),
      ]);
    } catch (e) {
      console.warn('[HospitalDesktopUI] dashboard :', e);
    }

    const occupied = beds.filter(b => b.status === 'occupied').length;
    const admitted = admissions.filter(a => a.status === 'admitted').length;
    const labPending = labOrders.filter(o => o.status !== 'completed').length;
    const subLabels = { active:'✅ Actif', grace_period:'⏳ Grâce', expired:'❌ Expiré', suspended:'⛔ Suspendu' };

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>${esc(hospital.name || 'Établissement')}</h1>
        <p>Vue d'ensemble de l'activité hospitalière</p></div>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${beds.length}</h3><p>🛏️ Lits (${occupied} occupés)</p></div>
        <div class="hospital-stat-card"><h3>${admitted}</h3><p>👥 Patients hospitalisés</p></div>
        <div class="hospital-stat-card"><h3>${labPending}</h3><p>🧪 Analyses en attente</p></div>
        <div class="hospital-stat-card"><h3>${subLabels[sub.status] || esc(sub.status)}</h3><p>💳 Abonnement</p></div>
      </div>

      <div class="card">
        <h3>Accès rapides</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
          <button class="btn btn-primary btn-sm" onclick="HospitalDesktopUI.navigate('beds')">🛏️ Admissions</button>
          <button class="btn btn-primary btn-sm" onclick="HospitalDesktopUI.navigate('lab')">🧪 Laboratoire</button>
          <button class="btn btn-ghost btn-sm" onclick="HospitalDesktopUI.navigate('patients')">👥 Patients (application)</button>
        </div>
      </div>
    `;
  }

  /* ── Lanceur (desktop + personnel uniquement) ───── */

  function installLauncher() {
    // Produit desktop : jamais proposé sur mobile/PWA, jamais aux patients.
    if (window.ExchangeBridge?.currentSourceDevice?.() !== 'desktop') return;

    const tryInstall = () => {
      if (document.getElementById('hospital-desktop-launcher')) return;
      const user = window.Auth?.getUser?.();
      if (!user || !STAFF_ROLES.includes(user.role)) return;
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;

      const btn = document.createElement('button');
      btn.id = 'hospital-desktop-launcher';
      btn.className = 'hospital-desktop-launcher';
      btn.innerHTML = '🏥 Espace hôpital <small>Desktop</small>';
      btn.onclick = () => open();
      sidebar.appendChild(btn);
    };

    window.addEventListener('DOMContentLoaded', () => setTimeout(tryInstall, 800));
    // La sidebar est reconstruite à chaque login/changement de langue :
    // on revérifie périodiquement à faible coût.
    setInterval(tryInstall, 3000);
  }

  installLauncher();

  return { open, close, navigate, isOpen };
})();

window.HospitalDesktopUI = HospitalDesktopUI;
