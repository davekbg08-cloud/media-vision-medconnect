/* MedConnect — Maintenance compte depuis le tableau Administration. */
(function () {
  function esc(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isAdmin() {
    try { return Auth?.getUser?.()?.role === 'admin'; } catch (_) { return false; }
  }

  function setActive() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.section === 'dashboard');
    });
  }

  function findMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    let accounts = [];
    let requests = [];
    try { accounts = DB?.getAccounts?.() || []; } catch (_) {}
    try { requests = DB?.getRegistrationRequests?.() || []; } catch (_) {}
    return [...accounts, ...requests].filter(item => {
      const haystack = [
        item.uid, item.authUid, item.requesterUid, item.email, item.username,
        item.name, item.fullName, item.requesterName, item.order_num,
        item.matricule, item.professionalNumber, item.patientId, item.hid,
        item.establishmentId, item.establishmentName,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    }).slice(0, 20);
  }

  function search() {
    const query = document.getElementById('maintenance-query')?.value || '';
    const box = document.getElementById('maintenance-results');
    if (!box) return;
    const results = findMatches(query);
    if (!query.trim()) {
      box.innerHTML = '<div class="card empty-state"><p>Saisis un email, UID, matricule, numéro d’ordre ou numéro de fiche.</p></div>';
      return;
    }
    if (!results.length) {
      box.innerHTML = '<div class="card empty-state"><p>Aucun compte correspondant trouvé localement.</p></div>';
      return;
    }
    box.innerHTML = `
      <div class="records-list">
        ${results.map(item => `
          <div class="record-card cleanup-preview-card">
            <div class="record-header">
              <span style="font-size:1.3rem">${esc(Auth?.getRoleIcon?.(item.role || item.requesterRole) || '👤')}</span>
              <div style="flex:1;min-width:0">
                <strong>${esc(item.name || item.fullName || item.requesterName || item.email || item.uid || 'Compte trouvé')}</strong>
                <br><small style="color:var(--text-muted)">${esc(item.email || 'Email non renseigné')}</small>
                <br><small style="color:var(--text-dim);font-family:monospace">${esc(item.uid || item.authUid || item.requesterUid || item.requestId || 'UID local inconnu')}</small>
              </div>
            </div>
            <div class="cleanup-preview-grid">
              <span>Rôle : <strong>${esc(item.role || item.requesterRole || '—')}</strong></span>
              <span>Statut : <strong>${esc(item.status || '—')}</strong></span>
              <span>Numéro : <strong>${esc(item.professionalNumber || item.order_num || item.matricule || item.username || item.patientId || '—')}</strong></span>
            </div>
          </div>`).join('')}
      </div>
      <div class="alert-box" style="margin-top:1rem">⚠️ Aperçu seulement : l’action finale demandera une confirmation forte.</div>`;
  }

  function render(main) {
    if (!main || !isAdmin()) return;
    setActive();
    main.innerHTML = `
      <div class="page-header">
        <h2>🧹 Maintenance compte</h2>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('dashboard')">⬅️ Retour administration</button>
      </div>
      <div class="auth-register-info" style="margin-bottom:1rem">Recherche contrôlée avant action administrative complète : utilisateur, demandes, établissements liés et dossiers associés.</div>
      <div class="card">
        <div class="form-group">
          <label>Email, UID, matricule, numéro d’ordre ou numéro de fiche</label>
          <input id="maintenance-query" type="text" placeholder="ex: davekbg08@gmail.com ou 1234567890" autocomplete="off">
        </div>
        <div class="form-actions" style="justify-content:flex-start">
          <button class="btn btn-primary" onclick="AdminAccountMaintenance.search()">🔍 Rechercher</button>
        </div>
      </div>
      <div id="maintenance-results"><div class="card empty-state"><p>Saisis un identifiant pour afficher l’aperçu avant action.</p></div></div>`;
  }

  function addDashboardButton() {
    if (!isAdmin()) return;
    const main = document.getElementById('main-content');
    if (!main || main.querySelector('#account-maintenance-button')) return;
    const header = main.querySelector('.page-header');
    if (!header) return;
    const button = document.createElement('button');
    button.id = 'account-maintenance-button';
    button.className = 'btn btn-ghost btn-sm account-maintenance-button';
    button.type = 'button';
    button.textContent = '🧹 Maintenance compte';
    button.addEventListener('click', () => render(main));
    header.appendChild(button);
  }

  function patchDashboard() {
    if (!window.AdminModule || AdminModule.__maintenanceButtonPatchApplied) return false;
    AdminModule.__maintenanceButtonPatchApplied = true;
    const originalRenderDashboard = AdminModule.renderDashboard.bind(AdminModule);
    AdminModule.renderDashboard = function (main) {
      const result = originalRenderDashboard(main);
      setTimeout(addDashboardButton, 0);
      return result;
    };
    return true;
  }

  function patchNavigation() {
    if (!window.App || App.__accountMaintenancePatchApplied) return false;
    App.__accountMaintenancePatchApplied = true;
    const originalNavigateTo = App.navigateTo.bind(App);
    App.navigateTo = function (section) {
      if (section === 'account_maintenance') {
        render(document.getElementById('main-content'));
        return;
      }
      const result = originalNavigateTo(section);
      if (section === 'dashboard') setTimeout(addDashboardButton, 80);
      return result;
    };
    return true;
  }

  function install() {
    patchDashboard();
    patchNavigation();
    setTimeout(addDashboardButton, 200);
  }

  window.AdminAccountMaintenance = { render, search, addDashboardButton };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install);
  else install();
})();
