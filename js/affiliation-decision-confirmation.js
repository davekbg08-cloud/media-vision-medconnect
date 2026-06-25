/* =====================================================
   MedConnect — Confirmation detaillee des affiliations
   Objectif : l'admin verifie les informations avant decision
   ===================================================== */
(function () {
  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function roleLabel(role) {
    return window.Auth?.getRoleLabel?.(role) || role || 'Role non precise';
  }

  function patch() {
    if (!window.HospitalsRegistry || HospitalsRegistry.__affiliationDecisionConfirmationApplied) return false;

    const originalRespond = HospitalsRegistry.respondAffiliation?.bind(HospitalsRegistry);
    const originalRender = HospitalsRegistry.renderManagePage?.bind(HospitalsRegistry);

    if (!originalRespond) return false;

    function findRequest(requestId) {
      return (HospitalsRegistry.getAffiliations?.() || [])
        .find(item => item.requestId === requestId || item.afid === requestId) || null;
    }

    function currentUserIsAdmin() {
      const user = window.Auth?.getUser?.() || {};
      return String(user.role || '').toLowerCase() === 'admin';
    }

    function openReviewModal(requestId, approved) {
      const req = findRequest(requestId);
      if (!req) {
        window.App?.toast?.('Demande introuvable.', 'error');
        return false;
      }

      const actionTitle = approved ? 'Approuver affiliation' : 'Refuser affiliation';
      const actionIcon = approved ? '✅' : '❌';
      const actionColor = approved ? 'var(--secondary)' : 'var(--danger)';
      const role = req.requesterRole || req.role || '';
      const number = req.professionalNumber || req.order_num || req.matricule || '';

      window.App?.openModal?.(`${actionIcon} ${actionTitle}`, `
        <div class="auth-register-info" style="margin-bottom:1rem">
          Verifiez les informations avant de prendre une decision. Cette action concerne uniquement cette demande.
        </div>
        <table class="info-table">
          <tr><td>Demandeur</td><td><strong>${esc(req.requesterName || req.doctor_name || '—')}</strong></td></tr>
          <tr><td>Role</td><td><span class="role-badge role-${esc(role)}">${esc(roleLabel(role))}</span></td></tr>
          <tr><td>Numero professionnel</td><td style="font-family:monospace;color:var(--secondary)">${esc(number || '—')}</td></tr>
          <tr><td>Etablissement</td><td><strong>${esc(req.establishmentName || req.hospital_name || '—')}</strong></td></tr>
          <tr><td>Date demande</td><td>${esc((req.createdAt || req.requested_at || '').slice(0, 10) || '—')}</td></tr>
          <tr><td>Statut actuel</td><td>${esc(req.status || 'pending')}</td></tr>
        </table>
        <div class="card" style="margin-top:1rem;padding:1rem">
          <h4 style="margin-bottom:.5rem">Checklist de verification</h4>
          <p style="font-size:.82rem;color:var(--text-muted)">☐ Identite professionnelle coherente</p>
          <p style="font-size:.82rem;color:var(--text-muted)">☐ Numero officiel verifie</p>
          <p style="font-size:.82rem;color:var(--text-muted)">☐ Etablissement exact</p>
          <p style="font-size:.82rem;color:var(--text-muted)">☐ Role demande justifie</p>
        </div>
        <div class="form-actions" style="margin-top:1rem">
          <button class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button class="btn btn-primary" style="border-color:${actionColor};background:${actionColor}" onclick="HospitalsRegistry.confirmAffiliationDecision('${esc(requestId)}', ${approved ? 'true' : 'false'})">
            ${actionIcon} Confirmer
          </button>
        </div>
      `);
      return false;
    }

    HospitalsRegistry.confirmAffiliationDecision = function (requestId, approved) {
      if (!currentUserIsAdmin()) {
        window.App?.toast?.('Seul administrateur peut traiter une affiliation.', 'error');
        return false;
      }
      window.App?.closeModal?.();
      const result = originalRespond(requestId, approved);
      originalRender?.(document.getElementById('main-content'), 'requests');
      return result;
    };

    HospitalsRegistry.respondAffiliation = function (requestId, approved) {
      if (!currentUserIsAdmin()) {
        window.App?.toast?.('Seul administrateur peut approuver ou refuser une affiliation.', 'error');
        return false;
      }
      return openReviewModal(requestId, approved);
    };

    HospitalsRegistry.__affiliationDecisionConfirmationApplied = true;
    return true;
  }

  function start() {
    if (patch()) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (patch() || tries > 60) clearInterval(timer);
    }, 100);
  }

  start();
})();
