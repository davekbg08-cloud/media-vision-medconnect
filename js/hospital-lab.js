/* =====================================================
   MedConnect 2.0 — HospitalLabModule (bundle desktop, recréé)
   Laboratoire côté hôpital : demandes d'analyses + résultats.

   Recréé selon la logique du projet (l'original du bundle
   n'a pas pu être récupéré) :
   - Collection cloud : labOrders (establishmentId + alias
     hospitalId, sourceDevice injecté par CloudDB) — distincte
     du LabModule mobile (js/lab.js, stockage DB local) pour
     ne pas toucher au module publié ;
   - Types d'analyses et plages normales alignés sur js/lab.js ;
   - Gating ExchangeBridge : 'request_lab' (nouvelle demande)
     et 'add_lab_result' (saisie résultat) — déjà présents dans
     DESKTOP_BLOCKED_ACTIONS ;
   - Patients identifiés par numéro MC.
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
    ordered:     { label: 'Demandée',   icon: '📨' },
    in_progress: { label: 'En cours',   icon: '⏳' },
    completed:   { label: 'Résultat disponible', icon: '✅' },
  };

  let _orders = [];

  async function render(container) {
    HospitalPermissions.requireRoute('lab');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement du laboratoire…</p></div>`;

    try {
      _orders = await CloudDB.listByHospital('labOrders', hospitalId);
    } catch (e) {
      console.error('[HospitalLab] Chargement :', e);
      container.innerHTML = `<div class="card empty-state"><p>Erreur de chargement : ${esc(e.message)}</p></div>`;
      return;
    }

    const pending = _orders.filter(o => o.status !== 'completed').length;
    const done = _orders.filter(o => o.status === 'completed').length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Laboratoire</h1><p>Demandes d'analyses et résultats de l'établissement</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalLabModule.openNew()">+ Nouvelle demande</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${_orders.length}</h3><p>Analyses au total</p></div>
        <div class="hospital-stat-card"><h3>${pending}</h3><p>⏳ En attente</p></div>
        <div class="hospital-stat-card"><h3>${done}</h3><p>✅ Terminées</p></div>
      </div>

      ${!_orders.length ? `<div class="card empty-state"><p>Aucune analyse enregistrée.</p></div>` : `
      <div class="records-list">
        ${_orders.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
          .map(o => orderCard(o)).join('')}
      </div>`}
    `;
  }

  function orderCard(o) {
    const st = STATUS[o.status] || STATUS.ordered;
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
          : `<p class="muted">Demandée le ${esc(String(o.createdAt || '').slice(0,10))}${o.requestedBy ? ' · par ' + esc(o.requestedBy) : ''}</p>`}
        <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap">
          ${o.status === 'ordered' ? `
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
      const orderId = DB.makeId('LAB');

      await CloudDB.createDoc('labOrders', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: name,
        type,
        status: 'ordered',
        requestedBy: user.name || user.uid,
        value: '', unit: '', comment: '',
      }, orderId);

      await CloudDB.createAuditLog('lab_requested', 'labOrders', orderId, { patientMc: mc, type });
      App.closeModal();
      App.toast('Demande d\'analyse envoyée.');
      HospitalDesktopUI.navigate('lab');
    } catch (e) {
      console.error('[HospitalLab] saveOrder :', e);
      App.toast(e.message || 'Erreur lors de la demande.', 'error');
    }
  }

  /* ── Statut & résultat ──────────────────────────── */

  async function setStatus(orderId, status) {
    try {
      await CloudDB.updateDoc('labOrders', orderId, { status });
      HospitalDesktopUI.navigate('lab');
    } catch (e) {
      console.error('[HospitalLab] setStatus :', e);
      App.toast(e.message || 'Erreur.', 'error');
    }
  }

  function openResult(orderId) {
    const o = _orders.find(x => x.id === orderId);
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
      <button class="btn btn-primary btn-full" onclick="HospitalLabModule.saveResult('${esc(orderId)}')">Enregistrer le résultat</button>
    `);
  }

  async function saveResult(orderId) {
    try {
      await CloudDB.requireWritableSubscription('add_lab_result');

      const value = document.getElementById('lab-value').value.trim();
      if (!value) { App.toast('Valeur requise.', 'error'); return; }
      const unit = document.getElementById('lab-unit').value.trim();
      const comment = document.getElementById('lab-comment').value.trim();

      await CloudDB.updateDoc('labOrders', orderId, {
        value, unit, comment,
        status: 'completed',
        completedAt: new Date().toISOString(),
      });

      await CloudDB.createAuditLog('lab_result_added', 'labOrders', orderId, {});
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
