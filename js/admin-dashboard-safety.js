/* =====================================================
   MedConnect — Admin Dashboard Safety Guard
   Objectif : ne jamais laisser le tableau de bord admin bloque sur le sablier
   ===================================================== */
(function () {
  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function safeArray(fn) {
    try {
      const value = fn?.();
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function safeStats() {
    try {
      return DB?.getStats?.() || {};
    } catch (_) {
      return {};
    }
  }

  function renderFallback(main, error) {
    const accounts = safeArray(() => DB.getAccounts());
    const requests = safeArray(() => DB.getRegistrationRequests?.());
    const affiliations = safeArray(() => HospitalsRegistry?.getAffiliations?.());
    const stats = safeStats();

    const pendingAccounts = accounts.filter(a => a.status === 'pending' && a.role !== 'patient');
    const pendingRequests = requests.filter(r => r.status === 'pending');
    const pendingAffiliations = affiliations.filter(a => a.status === 'pending');
    const activeAccounts = accounts.filter(a => ['approved', 'active'].includes(String(a.status || '').toLowerCase()));

    main.innerHTML = `
      <div class="page-header">
        <h2>⚙️ Administration</h2>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('dashboard')">🔄 Recharger</button>
      </div>

      <div class="auth-register-info" style="margin-bottom:1rem">
        Le tableau de bord principal a rencontre une erreur, mais l'espace administrateur reste accessible.
        ${error?.message ? `<br><small style="color:var(--danger)">${esc(error.message)}</small>` : ''}
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${activeAccounts.length}</div><div class="stat-label">Utilisateurs actifs</div></div>
        <div class="stat-card"><div class="stat-icon">⏳</div><div class="stat-value">${pendingAccounts.length || pendingRequests.length}</div><div class="stat-label">Inscriptions</div></div>
        <div class="stat-card"><div class="stat-icon">🏥</div><div class="stat-value">${pendingAffiliations.length}</div><div class="stat-label">Affiliations</div></div>
        <div class="stat-card"><div class="stat-icon">🩺</div><div class="stat-value">${stats.totalPatients || 0}</div><div class="stat-label">Patients</div></div>
        <div class="stat-card"><div class="stat-icon">📋</div><div class="stat-value">${stats.totalConsults || 0}</div><div class="stat-label">Consultations</div></div>
      </div>

      <div class="page-header" style="margin-top:1.5rem">
        <h3>⏳ Demandes d'inscription</h3>
      </div>
      <div class="records-list">
        ${pendingAccounts.length ? pendingAccounts.map(a => `
          <div class="record-card">
            <div class="record-header">
              <span>${Auth?.getRoleIcon?.(a.role) || '👤'}</span>
              <div style="flex:1">
                <strong>${esc(a.name || a.fullName || a.email || a.uid)}</strong>
                <span class="role-badge role-${esc(a.role)}">${esc(a.role)}</span><br>
                <small style="color:var(--text-muted);font-family:monospace">${esc(a.professionalNumber || a.order_num || a.matricule || a.username || '—')}</small>
              </div>
            </div>
            <div class="form-actions" style="margin-top:.65rem">
              <button class="btn btn-primary btn-sm" onclick="AdminModule.openDetail('${esc(a.uid)}')">🔍 Verifier</button>
            </div>
          </div>`).join('') : `<div class="card empty-state"><p>Aucune inscription en attente</p></div>`}
      </div>

      <div class="page-header" style="margin-top:1.5rem">
        <h3>🏥 Demandes d'affiliation</h3>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('hospitals')">Ouvrir</button>
      </div>
      <div class="records-list">
        ${pendingAffiliations.length ? pendingAffiliations.map(a => `
          <div class="record-card">
            <div class="record-header">
              <strong>${esc(a.establishmentName || a.hospital_name || 'Etablissement')}</strong>
              <span class="chip">${esc(a.requesterRole || a.role || 'professionnel')}</span>
            </div>
            <p style="color:var(--text-muted);font-size:.82rem">${esc(a.requesterName || a.doctor_name || 'Demandeur')} · ${esc(a.professionalNumber || a.order_num || a.matricule || '')}</p>
          </div>`).join('') : `<div class="card empty-state"><p>Aucune affiliation en attente</p></div>`}
      </div>
    `;
  }

  function patchAdminDashboard() {
    if (!window.AdminModule || AdminModule.__dashboardSafetyApplied) return false;
    const originalRender = AdminModule.renderDashboard?.bind(AdminModule);
    if (!originalRender) return false;

    AdminModule.renderDashboard = function (main) {
      try {
        return originalRender(main);
      } catch (error) {
        console.error('[MedConnect] Admin dashboard render failed:', error);
        renderFallback(main || document.getElementById('main-content'), error);
        return false;
      }
    };

    AdminModule.__dashboardSafetyApplied = true;
    return true;
  }

  function patchGlobalLoaderRecovery() {
    const recover = event => {
      const user = window.Auth?.getUser?.();
      const main = document.getElementById('main-content');
      if (!user || user.role !== 'admin' || !main) return;
      if (!main.querySelector('.loading')) return;
      renderFallback(main, event?.error || event?.reason || new Error('Erreur de chargement admin'));
    };
    window.addEventListener('error', recover);
    window.addEventListener('unhandledrejection', recover);
  }

  function start() {
    patchGlobalLoaderRecovery();
    if (patchAdminDashboard()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (patchAdminDashboard() || attempts > 60) clearInterval(timer);
    }, 100);
  }

  start();
})();
