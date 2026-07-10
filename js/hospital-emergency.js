/* =====================================================
   MODULE URGENCES — desktop hôpital
   Prise en charge des arrivées urgentes avec TRIAGE.
   Calqué sur HospitalReceptionModule (mêmes conventions :
   CloudDB, guards de capacité, réutilisation des
   collections admissions/patients). Le triage suit une
   échelle à 5 niveaux (inspirée de CIMU/ESI) : le niveau 1
   est le plus grave (réanimation immédiate), le 5 le moins
   urgent. La file est TOUJOURS triée par priorité.
   ===================================================== */
const HospitalEmergencyModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Niveaux de triage : 1 = le plus grave. Couleur + délai indicatif.
  const TRIAGE = {
    1: { label: 'Réanimation', color: '#dc2626', hint: 'Immédiat — pronostic vital engagé' },
    2: { label: 'Très urgent', color: '#ea580c', hint: 'Prise en charge < 20 min' },
    3: { label: 'Urgent',      color: '#d97706', hint: 'Prise en charge < 60 min' },
    4: { label: 'Peu urgent',  color: '#65a30d', hint: 'Prise en charge < 120 min' },
    5: { label: 'Non urgent',  color: '#0891b2', hint: 'Consultation simple' },
  };

  const STATUS = {
    waiting:     '⏳ En attente de prise en charge',
    in_care:     '🩺 En cours de prise en charge',
    hospitalized:'🛏️ Hospitalisé',
    discharged:  '✅ Sortie',
    transferred: '↗️ Transféré',
  };

  let _cases = [];

  async function render(container) {
    HospitalPermissions.requireRoute('emergency');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement des urgences…</p></div>`;

    try {
      _cases = await CloudDB.listByHospital('emergencyCases', hospitalId);
    } catch (e) {
      console.error('[Urgences] Chargement :', e);
      _cases = [];
    }

    // File active = non clôturée, triée par gravité (1 d'abord) puis
    // par ancienneté d'arrivée.
    const active = _cases
      .filter(c => c.status === 'waiting' || c.status === 'in_care')
      .sort((a, b) =>
        (a.triageLevel || 5) - (b.triageLevel || 5) ||
        String(a.arrivedAt || '').localeCompare(String(b.arrivedAt || '')));

    const today = new Date().toISOString().slice(0, 10);
    const todayCount = _cases.filter(c => String(c.arrivedAt || '').slice(0, 10) === today).length;
    const critical = active.filter(c => (c.triageLevel || 5) <= 2).length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>🚑 Urgences</h1><p>Prise en charge et triage des arrivées urgentes</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalEmergencyModule.openIntake()">+ Nouvelle arrivée urgente</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${active.length}</h3><p>Dans la file</p></div>
        <div class="hospital-stat-card"><h3 style="color:#dc2626">${critical}</h3><p>🔴 Urgences vitales</p></div>
        <div class="hospital-stat-card"><h3>${active.filter(c=>c.status==='in_care').length}</h3><p>🩺 En cours</p></div>
        <div class="hospital-stat-card"><h3>${todayCount}</h3><p>Arrivées aujourd'hui</p></div>
      </div>

      <div class="card">
        <h3>File des urgences (par priorité)</h3>
        ${!active.length ? `<p class="muted">Aucune urgence en cours.</p>` : `
        <div class="records-list">
          ${active.map(c => caseCard(c)).join('')}
        </div>`}
      </div>
    `;
  }

  function triageBadge(level) {
    const tri = TRIAGE[level] || TRIAGE[5];
    return `<span class="triage-badge" style="background:${tri.color}">${level} · ${tri.label}</span>`;
  }

  function caseCard(c) {
    const canCare = window.HospitalCapabilities?.can?.(
      window.HospitalAuth?.getSession?.()?.role, 'create_consultation');
    return `
      <div class="record-card">
        <div class="record-header">
          ${triageBadge(c.triageLevel)}
          <strong>${esc(c.patientName || '—')}</strong>
          <span class="id-tag">${esc(c.patientMc || '')}</span>
        </div>
        <p class="muted">${STATUS[c.status] || esc(c.status)} · ${esc(c.complaint || '')} · arrivé à ${esc(String(c.arrivedAt||'').slice(11,16))}</p>
        ${c.doctorName ? `<p>👨‍⚕️ ${esc(c.doctorName)}</p>` : ''}
        <div class="record-actions">
          ${c.status === 'waiting' && canCare ? `
            <button class="btn btn-primary btn-sm" onclick="HospitalEmergencyModule.takeCharge('${esc(c.id)}')">🩺 Prendre en charge</button>` : ''}
          ${c.status === 'in_care' ? `
            <button class="btn btn-ghost btn-sm" onclick="HospitalEmergencyModule.closeCase('${esc(c.id)}','discharged')">✅ Sortie</button>
            <button class="btn btn-ghost btn-sm" onclick="HospitalEmergencyModule.closeCase('${esc(c.id)}','hospitalized')">🛏️ Hospitaliser</button>` : ''}
        </div>
      </div>`;
  }

  /* ── ENREGISTREMENT D'UNE ARRIVÉE URGENTE ──────────── */

  async function openIntake() {
    // Enregistrer une arrivée = capacité d'accueil patient. La prise en
    // charge médicale, elle, sera gardée séparément.
    if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;

    const triageOptions = Object.entries(TRIAGE)
      .map(([lvl, t]) => `<option value="${lvl}">${lvl} — ${t.label} (${t.hint})</option>`).join('');

    App.openModal('🚑 Nouvelle arrivée urgente', `
      <div class="form-group">
        <label>Numéro patient (si connu)</label>
        <input id="er-mc" placeholder="MC-2026-CD-XXXXXXXX" style="text-transform:uppercase"
          oninput="this.value=this.value.toUpperCase()" onblur="HospitalEmergencyModule.lookupPatient()">
      </div>
      <div id="er-patient-info"></div>
      <div class="form-row">
        <div class="form-group"><label>Prénom</label><input id="er-fn" placeholder="Si nouveau patient"></div>
        <div class="form-group"><label>Nom</label><input id="er-ln" placeholder="Si nouveau patient"></div>
      </div>
      <div class="form-group">
        <label>Motif / plainte principale *</label>
        <input id="er-complaint" placeholder="Ex : douleur thoracique, traumatisme…">
      </div>
      <div class="form-group">
        <label>Niveau de triage *</label>
        <select id="er-triage">${triageOptions}</select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary" onclick="HospitalEmergencyModule.saveIntake()">Enregistrer l'urgence</button>
      </div>
    `);
  }

  function lookupPatient() {
    const mc = document.getElementById('er-mc').value.trim().toUpperCase();
    const box = document.getElementById('er-patient-info');
    if (!mc) { box.innerHTML = ''; return; }
    const p = (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc);
    if (p) {
      box.innerHTML = `<p class="muted">✅ ${esc(p.firstname)} ${esc(p.lastname)}</p>`;
      const fn = document.getElementById('er-fn'), ln = document.getElementById('er-ln');
      if (fn) fn.value = p.firstname || '';
      if (ln) ln.value = p.lastname || '';
    } else {
      box.innerHTML = `<p class="muted">Nouveau patient — renseignez prénom et nom.</p>`;
    }
  }

  async function saveIntake() {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;

      const complaint = document.getElementById('er-complaint').value.trim();
      const triageLevel = parseInt(document.getElementById('er-triage').value, 10) || 5;
      if (!complaint) { App.toast('Renseignez le motif de l\'urgence.', 'error'); return; }

      const hospitalId = await CloudDB.getActiveHospitalId();
      const est = window.HospitalPortal?.currentEstablishmentFields?.() || {};
      let mc = document.getElementById('er-mc').value.trim().toUpperCase();
      let patient = mc ? (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc) : null;

      if (!patient) {
        const fn = document.getElementById('er-fn').value.trim();
        const ln = document.getElementById('er-ln').value.trim();
        if (!fn || !ln) { App.toast('Patient introuvable : renseignez prénom et nom.', 'error'); return; }
        if (!window.HospitalCapabilities?.guardHospitalAction?.('create_patient')) return;
        patient = window.DB?.addPatient?.({ firstname: fn, lastname: ln, ...est });
        mc = patient.id;
      }

      const caseId = DB.makeId('ER');
      await CloudDB.createDoc('emergencyCases', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: `${patient.firstname||''} ${patient.lastname||''}`.trim(),
        complaint,
        triageLevel,
        status: 'waiting',
        arrivedAt: new Date().toISOString(),
        ...est,
      }, caseId);

      App.closeModal();
      App.toast('🚑 Urgence enregistrée.');
      render(document.getElementById('hospital-native-content') || document.body);
    } catch (e) {
      console.error('[Urgences] saveIntake :', e);
      App.toast(e.message || 'Enregistrement impossible.', 'error');
    }
  }

  /* ── PRISE EN CHARGE / CLÔTURE ─────────────────────── */

  async function takeCharge(caseId) {
    // Prise en charge médicale : réservée aux soignants habilités.
    if (!window.HospitalCapabilities?.guardHospitalAction?.('create_consultation')) return;
    try {
      const session = window.HospitalAuth?.getSession?.() || {};
      await CloudDB.updateDoc('emergencyCases', caseId, {
        status: 'in_care',
        doctorUid: session.agentUid || '',
        doctorName: session.agentName || '',
        takenChargeAt: new Date().toISOString(),
      });
      App.toast('Prise en charge enregistrée.');
      render(document.getElementById('hospital-native-content') || document.body);
    } catch (e) {
      console.error('[Urgences] takeCharge :', e);
      App.toast(e.message || 'Action impossible.', 'error');
    }
  }

  async function closeCase(caseId, outcome) {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('create_consultation')) return;
    try {
      await CloudDB.updateDoc('emergencyCases', caseId, {
        status: outcome,
        closedAt: new Date().toISOString(),
      });
      App.toast(outcome === 'hospitalized' ? '🛏️ Patient hospitalisé.' : '✅ Sortie enregistrée.');
      render(document.getElementById('hospital-native-content') || document.body);
    } catch (e) {
      console.error('[Urgences] closeCase :', e);
      App.toast(e.message || 'Action impossible.', 'error');
    }
  }

  return { render, openIntake, lookupPatient, saveIntake, takeCharge, closeCase };
})();

window.HospitalEmergencyModule = HospitalEmergencyModule;
