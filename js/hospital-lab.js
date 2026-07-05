/* =====================================================
   MedConnect 2.0 — HospitalLabModule (bundle desktop, recréé)
   Laboratoire côté hôpital : demandes d'analyses + résultats.

   CONTRAT D'ÉCHANGE mobile ↔ desktop :
   - Collections du contrat existant : labRequests (demande,
     statuts requested → in_progress → completed) et labResults
     (résultat émis vers le médecin demandeur) — PAS de
     collection parallèle (labOrders supprimée, dérive de
     schéma évitée) ;
   - Les statuts sont ceux écoutés par le listener infirmier
     mobile d'ExchangeBridge ('requested','sample_pending',
     'in_progress') ;
   - À la saisie du résultat : le résumé est stocké sur la
     demande (affichage desktop en une lecture) ET un document
     labResults est émis avec doctorUid = demandeur → le
     listener médecin mobile le reçoit en quasi temps réel ;
   - Écritures gatées par l'abonnement desktop (request_lab /
     add_lab_result) côté client ET côté règles.
   ===================================================== */
const HospitalLabModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Aligné sur LAB_TYPES de js/lab.js (liste privée là-bas, non exportée).
  const LAB_TYPES = [
    'Numération Formule Sanguine (NFS)',
    'Glycémie à jeun',
    'Cholestérol total / LDL / HDL',
    'Triglycérides',
    'Créatinine / Urée',
    'Transaminases (ASAT/ALAT)',
    'Bilan thyroïdien (TSH)',
    'Test de grossesse (βhCG)',
    'CRP (Protéine C-réactive)',
    'Groupe sanguin + RAI',
    'Sérologie VIH',
    'Sérologie Hépatite B/C',
    'Paludisme / Goutte épaisse',
    'ECBU (Examen cytobactériologique urinaire)',
    'Autre',
  ];

  const NORMAL_RANGES = {
    'Glycémie à jeun':            { min: 0.7, max: 1.1, unit: 'g/L' },
    'CRP (Protéine C-réactive)':  { min: 0,   max: 5,   unit: 'mg/L' },
  };

  const STATUS = {
    requested:      { label: 'Demandée',             icon: '📨' },
    sample_pending: { label: 'Prélèvement en cours', icon: '🩸' },
    in_progress:    { label: 'En cours d\'analyse',  icon: '⏳' },
    completed:      { label: 'Résultat disponible',  icon: '✅' },
  };

  let _requests = [];

  async function render(container) {
    HospitalPermissions.requireRoute('lab');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement du laboratoire…</p></div>`;

    try {
      _requests = await CloudDB.listByHospital('labRequests', hospitalId);
    } catch (e) {
      console.error('[HospitalLab] Chargement :', e);
      container.innerHTML = `<div class="card empty-state"><p>Erreur de chargement : ${esc(e.message)}</p></div>`;
      return;
    }

    const pending = _requests.filter(o => o.status !== 'completed').length;
    const done = _requests.filter(o => o.status === 'completed').length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Laboratoire</h1><p>Demandes d'analyses et résultats de l'établissement</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalLabModule.openNew()">+ Nouvelle demande</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${_requests.length}</h3><p>Analyses au total</p></div>
        <div class="hospital-stat-card"><h3>${pending}</h3><p>⏳ En attente</p></div>
        <div class="hospital-stat-card"><h3>${done}</h3><p>✅ Terminées</p></div>
      </div>

      ${!_requests.length ? `<div class="card empty-state"><p>Aucune analyse enregistrée.</p></div>` : `
      <div class="records-list">
        ${_requests.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
          .map(o => requestCard(o)).join('')}
      </div>`}
    `;
  }

  function requestCard(o) {
    const st = STATUS[o.status] || STATUS.requested;
    let flag = '';
    const norm = NORMAL_RANGES[o.type];
    const val = parseFloat(o.value);
    if (o.status === 'completed' && norm && !isNaN(val)) {
      flag = val < norm.min ? ' 🔵 Bas' : val > norm.max ? ' 🔴 Élevé' : ' 🟢 Normal';
    }
    return `
      <div class="card record-card">
        <p><strong>${esc(o.type || '—')}</strong> ${st.icon} ${st.label}</p>
        <p>👤 ${esc(o.patientName || '—')} · ${esc(o.patientMc || '')}</p>
        ${o.status === 'completed'
          ? `<p>Résultat : <strong>${esc(o.value || '—')} ${esc(o.unit || norm?.unit || '')}</strong>${flag}</p>
             ${o.comment ? `<p class="muted">${esc(o.comment)}</p>` : ''}`
          : `<p class="muted">Demandée le ${esc(String(o.createdAt || '').slice(0,10))}${o.requestedByName ? ' · par ' + esc(o.requestedByName) : ''}</p>`}
        <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap">
          ${o.status === 'requested' ? `
            <button class="btn btn-ghost btn-sm"
              onclick="HospitalLabModule.setStatus('${esc(o.id)}','in_progress')">▶️ Prise en charge</button>` : ''}
          ${o.status !== 'completed' ? `
            <button class="btn btn-ghost btn-sm" style="color:var(--secondary)"
              onclick="HospitalLabModule.openResult('${esc(o.id)}')">🧪 Saisir le résultat</button>` : ''}
        </div>
      </div>`;
  }

  /* ── Nouvelle demande ───────────────────────────── */

  function openNew() {
    App.openModal('🧪 Nouvelle demande d\'analyse', `
      <div class="form-group"><label>Numéro MC du patient *</label>
        <input id="lab-mc" placeholder="MC-2026-CD-XXXXXXXX"></div>
      <div class="form-group"><label>Nom du patient</label>
        <input id="lab-name" placeholder="Rempli automatiquement si le patient est connu"></div>
      <div class="form-group"><label>Type d'analyse *</label>
        <select id="lab-type">
          ${LAB_TYPES.map(lt => `<option value="${esc(lt)}">${esc(lt)}</option>`).join('')}
        </select></div>
      <button class="btn btn-primary btn-full" onclick="HospitalLabModule.saveOrder()">Envoyer la demande</button>
    `);
  }

  async function saveOrder() {
    try {
      await CloudDB.requireWritableSubscription('request_lab');

      const mc = document.getElementById('lab-mc').value.trim().toUpperCase();
      if (!mc) { App.toast('Numéro MC requis.', 'error'); return; }
      let name = document.getElementById('lab-name').value.trim();
      const type = document.getElementById('lab-type').value;

      if (!name && window.DB?.getPatients) {
        const p = DB.getPatients().find(x => String(x.id || '').toUpperCase() === mc);
        if (p) name = `${p.firstname || ''} ${p.lastname || ''}`.trim();
      }

      const hospitalId = await CloudDB.getActiveHospitalId();
      const user = await CloudDB.getCurrentUserProfile();
      const requestId = DB.makeId('LAB');

      await CloudDB.createDoc('labRequests', {
        establishmentId: hospitalId,
        hospitalId, // alias — les listeners mobile filtrent sur ce nom
        patientMc: mc,
        patientName: name,
        type,
        status: 'requested', // statut du contrat, écouté côté mobile
        requestedByUid: user.uid,
        requestedByName: user.name || user.uid,
        // Si le demandeur est médecin : le résultat lui sera notifié
        // via labResults (listener médecin mobile filtre doctorUid).
        doctorUid: user.role === 'doctor' ? user.uid : '',
        value: '', unit: '', comment: '',
      }, requestId);

      await CloudDB.createAuditLog('lab_requested', 'labRequests', requestId, { patientMc: mc, type });
      App.closeModal();
      App.toast('Demande d\'analyse envoyée.');
      HospitalDesktopUI.navigate('lab');
    } catch (e) {
      console.error('[HospitalLab] saveOrder :', e);
      App.toast(e.message || 'Erreur lors de la demande.', 'error');
    }
  }

  /* ── Statut & résultat ──────────────────────────── */

  async function setStatus(requestId, status) {
    try {
      await CloudDB.updateDoc('labRequests', requestId, { status });
      HospitalDesktopUI.navigate('lab');
    } catch (e) {
      console.error('[HospitalLab] setStatus :', e);
      App.toast(e.message || 'Erreur.', 'error');
    }
  }

  function openResult(requestId) {
    const o = _requests.find(x => x.id === requestId);
    if (!o) return;
    const norm = NORMAL_RANGES[o.type];
    App.openModal('🧪 Saisir le résultat', `
      <p><strong>${esc(o.type)}</strong> — ${esc(o.patientName || o.patientMc || '')}</p>
      <div class="form-group"><label>Valeur *</label>
        <input id="lab-value" placeholder="${norm ? `Plage normale : ${norm.min}–${norm.max} ${norm.unit}` : 'Valeur ou conclusion'}"></div>
      <div class="form-group"><label>Unité</label>
        <input id="lab-unit" value="${esc(norm?.unit || '')}"></div>
      <div class="form-group"><label>Commentaire</label>
        <textarea id="lab-comment" rows="3"></textarea></div>
      <button class="btn btn-primary btn-full" onclick="HospitalLabModule.saveResult('${esc(requestId)}')">Enregistrer le résultat</button>
    `);
  }

  async function saveResult(requestId) {
    try {
      await CloudDB.requireWritableSubscription('add_lab_result');

      const req = _requests.find(x => x.id === requestId);
      if (!req) return;
      const value = document.getElementById('lab-value').value.trim();
      if (!value) { App.toast('Valeur requise.', 'error'); return; }
      const unit = document.getElementById('lab-unit').value.trim();
      const comment = document.getElementById('lab-comment').value.trim();
      const hospitalId = await CloudDB.getActiveHospitalId();

      // 1) Résumé sur la demande — l'écran desktop reste en une lecture.
      await CloudDB.updateDoc('labRequests', requestId, {
        value, unit, comment,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      // 2) Document labResults du contrat — reçu en quasi temps réel
      //    par le médecin demandeur sur mobile (listener doctorUid).
      await CloudDB.createDoc('labResults', {
        establishmentId: hospitalId,
        hospitalId,
        labRequestId: requestId,
        patientMc: req.patientMc || '',
        patientName: req.patientName || '',
        type: req.type || '',
        value, unit, comment,
        doctorUid: req.doctorUid || req.requestedByUid || '',
      }, DB.makeId('LABR'));

      await CloudDB.createAuditLog('lab_result_added', 'labRequests', requestId, {});
      App.closeModal();
      App.toast('Résultat enregistré.');
      HospitalDesktopUI.navigate('lab');
    } catch (e) {
      console.error('[HospitalLab] saveResult :', e);
      App.toast(e.message || 'Erreur lors de l\'enregistrement.', 'error');
    }
  }

  return { render, openNew, saveOrder, setStatus, openResult, saveResult };
})();

window.HospitalLabModule = HospitalLabModule;
