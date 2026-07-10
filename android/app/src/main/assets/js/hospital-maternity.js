/* =====================================================
   MODULE MATERNITÉ — desktop hôpital
   Suivi des grossesses, accouchements et nouveau-nés.
   Contrairement aux Urgences (file instantanée), la
   maternité suit un DOSSIER dans la durée : grossesse
   déclarée → suivi prénatal → accouchement → post-partum.
   Mêmes conventions que les autres modules (CloudDB,
   guards de capacité, collection dédiée maternityCases).
   ===================================================== */
const HospitalMaternityModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const STATUS = {
    prenatal:   '🤰 Suivi prénatal',
    delivery:   '👶 Accouchement',
    postpartum: '🍼 Post-partum',
    closed:     '✅ Dossier clôturé',
  };

  let _cases = [];

  // Nombre de semaines d'aménorrhée depuis la date des dernières règles.
  function weeksOfAmenorrhea(lmpDate) {
    if (!lmpDate) return null;
    const ms = Date.now() - new Date(lmpDate).getTime();
    if (isNaN(ms) || ms < 0) return null;
    return Math.floor(ms / (7 * 24 * 3600 * 1000));
  }

  // Terme prévu ≈ DDR + 280 jours.
  function dueDate(lmpDate) {
    if (!lmpDate) return '';
    const d = new Date(lmpDate);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 280);
    return d.toISOString().slice(0, 10);
  }

  async function render(container) {
    HospitalPermissions.requireRoute('maternity');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement de la maternité…</p></div>`;

    try {
      _cases = await CloudDB.listByHospital('maternityCases', hospitalId);
    } catch (e) {
      console.error('[Maternité] Chargement :', e);
      _cases = [];
    }

    const active = _cases.filter(c => c.status !== 'closed')
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));
    const prenatal = active.filter(c => c.status === 'prenatal').length;
    const births = _cases.filter(c => c.status === 'postpartum' || c.bornAt).length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>🤰 Maternité</h1><p>Suivi des grossesses, accouchements et nouveau-nés</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalMaternityModule.openNew()">+ Nouveau dossier grossesse</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${active.length}</h3><p>Dossiers actifs</p></div>
        <div class="hospital-stat-card"><h3>${prenatal}</h3><p>🤰 Suivi prénatal</p></div>
        <div class="hospital-stat-card"><h3>${active.filter(c=>c.status==='delivery').length}</h3><p>👶 En travail</p></div>
        <div class="hospital-stat-card"><h3>${births}</h3><p>🍼 Naissances</p></div>
      </div>

      <div class="card">
        <h3>Dossiers de grossesse actifs</h3>
        ${!active.length ? `<p class="muted">Aucun dossier de grossesse en cours.</p>` : `
        <div class="records-list">
          ${active.map(c => caseCard(c)).join('')}
        </div>`}
      </div>
    `;
  }

  function caseCard(c) {
    const wa = weeksOfAmenorrhea(c.lmpDate);
    const canDeliver = window.HospitalCapabilities?.can?.(
      window.HospitalAuth?.getSession?.()?.role, 'create_consultation');
    return `
      <div class="record-card">
        <div class="record-header">
          <strong>${esc(c.patientName || '—')}</strong>
          <span class="id-tag">${esc(c.patientMc || '')}</span>
          <span class="record-date">${STATUS[c.status] || esc(c.status)}</span>
        </div>
        <p class="muted">
          ${wa != null ? `${wa} SA` : 'Terme inconnu'}
          ${c.dueDate ? ` · terme prévu ${esc(c.dueDate)}` : ''}
          ${c.prenatalVisits ? ` · ${c.prenatalVisits} consultation(s) prénatale(s)` : ''}
        </p>
        ${c.bornAt ? `<p>🍼 Né(e) le ${esc(String(c.bornAt).slice(0,10))}${c.newbornSex ? ` · ${esc(c.newbornSex)}` : ''}</p>` : ''}
        <div class="record-actions">
          ${c.status === 'prenatal' ? `
            <button class="btn btn-ghost btn-sm" onclick="HospitalMaternityModule.addPrenatalVisit('${esc(c.id)}')">➕ Consultation prénatale</button>
            ${canDeliver ? `<button class="btn btn-primary btn-sm" onclick="HospitalMaternityModule.openDelivery('${esc(c.id)}')">👶 Accouchement</button>` : ''}` : ''}
          ${c.status === 'delivery' || c.status === 'postpartum' ? `
            <button class="btn btn-ghost btn-sm" onclick="HospitalMaternityModule.closeCase('${esc(c.id)}')">✅ Clôturer le dossier</button>` : ''}
        </div>
      </div>`;
  }

  /* ── NOUVEAU DOSSIER GROSSESSE ─────────────────────── */

  async function openNew() {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;
    App.openModal('🤰 Nouveau dossier de grossesse', `
      <div class="form-group">
        <label>Numéro patiente (si connue)</label>
        <input id="mat-mc" placeholder="MC-2026-CD-XXXXXXXX" style="text-transform:uppercase"
          oninput="this.value=this.value.toUpperCase()" onblur="HospitalMaternityModule.lookupPatient()">
      </div>
      <div id="mat-patient-info"></div>
      <div class="form-row">
        <div class="form-group"><label>Prénom</label><input id="mat-fn" placeholder="Si nouvelle patiente"></div>
        <div class="form-group"><label>Nom</label><input id="mat-ln" placeholder="Si nouvelle patiente"></div>
      </div>
      <div class="form-group">
        <label>Date des dernières règles (DDR) *</label>
        <input id="mat-lmp" type="date">
        <small class="muted">Le terme prévu sera calculé automatiquement (DDR + 280 jours).</small>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary" onclick="HospitalMaternityModule.saveNew()">Créer le dossier</button>
      </div>
    `);
  }

  function lookupPatient() {
    const mc = document.getElementById('mat-mc').value.trim().toUpperCase();
    const box = document.getElementById('mat-patient-info');
    if (!mc) { box.innerHTML = ''; return; }
    const p = (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc);
    if (p) {
      box.innerHTML = `<p class="muted">✅ ${esc(p.firstname)} ${esc(p.lastname)}</p>`;
      const fn = document.getElementById('mat-fn'), ln = document.getElementById('mat-ln');
      if (fn) fn.value = p.firstname || '';
      if (ln) ln.value = p.lastname || '';
    } else {
      box.innerHTML = `<p class="muted">Nouvelle patiente — renseignez prénom et nom.</p>`;
    }
  }

  async function saveNew() {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;
      const lmp = document.getElementById('mat-lmp').value;
      if (!lmp) { App.toast('Renseignez la date des dernières règles.', 'error'); return; }

      const hospitalId = await CloudDB.getActiveHospitalId();
      const est = window.HospitalPortal?.currentEstablishmentFields?.() || {};
      let mc = document.getElementById('mat-mc').value.trim().toUpperCase();
      let patient = mc ? (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc) : null;

      if (!patient) {
        const fn = document.getElementById('mat-fn').value.trim();
        const ln = document.getElementById('mat-ln').value.trim();
        if (!fn || !ln) { App.toast('Patiente introuvable : renseignez prénom et nom.', 'error'); return; }
        if (!window.HospitalCapabilities?.guardHospitalAction?.('create_patient')) return;
        patient = window.DB?.addPatient?.({ firstname: fn, lastname: ln, gender: 'F', ...est });
        mc = patient.id;
      }

      const caseId = DB.makeId('MAT');
      await CloudDB.createDoc('maternityCases', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: `${patient.firstname||''} ${patient.lastname||''}`.trim(),
        lmpDate: lmp,
        dueDate: dueDate(lmp),
        prenatalVisits: 0,
        status: 'prenatal',
        openedAt: new Date().toISOString(),
        ...est,
      }, caseId);

      App.closeModal();
      App.toast('🤰 Dossier de grossesse créé.');
      HospitalDesktopUI.navigate('maternity');
    } catch (e) {
      console.error('[Maternité] saveNew :', e);
      App.toast(e.message || 'Création impossible.', 'error');
    }
  }

  /* ── SUIVI PRÉNATAL ────────────────────────────────── */

  async function addPrenatalVisit(caseId) {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;
    try {
      const c = _cases.find(x => x.id === caseId);
      await CloudDB.updateDoc('maternityCases', caseId, {
        prenatalVisits: (c?.prenatalVisits || 0) + 1,
        lastPrenatalAt: new Date().toISOString(),
      });
      App.toast('Consultation prénatale enregistrée.');
      HospitalDesktopUI.navigate('maternity');
    } catch (e) {
      console.error('[Maternité] addPrenatalVisit :', e);
      App.toast(e.message || 'Action impossible.', 'error');
    }
  }

  /* ── ACCOUCHEMENT ──────────────────────────────────── */

  async function openDelivery(caseId) {
    // L'accouchement est un acte médical : réservé aux soignants.
    if (!window.HospitalCapabilities?.guardHospitalAction?.('create_consultation')) return;
    App.openModal('👶 Enregistrer un accouchement', `
      <div class="form-group">
        <label>Date et heure de naissance *</label>
        <input id="mat-born" type="datetime-local">
      </div>
      <div class="form-group">
        <label>Sexe du nouveau-né</label>
        <select id="mat-sex"><option value="F">Fille</option><option value="M">Garçon</option></select>
      </div>
      <div class="form-group">
        <label>Type d'accouchement</label>
        <select id="mat-mode"><option value="voie basse">Voie basse</option><option value="césarienne">Césarienne</option></select>
      </div>
      <div class="form-group">
        <label>Observations</label>
        <input id="mat-obs" placeholder="Poids, état, remarques…">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary" onclick="HospitalMaternityModule.saveDelivery('${esc(caseId)}')">Enregistrer</button>
      </div>
    `);
  }

  async function saveDelivery(caseId) {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('create_consultation')) return;
      const born = document.getElementById('mat-born').value;
      if (!born) { App.toast('Renseignez la date de naissance.', 'error'); return; }
      const session = window.HospitalAuth?.getSession?.() || {};
      await CloudDB.updateDoc('maternityCases', caseId, {
        status: 'postpartum',
        bornAt: new Date(born).toISOString(),
        newbornSex: document.getElementById('mat-sex').value,
        deliveryMode: document.getElementById('mat-mode').value,
        deliveryNotes: document.getElementById('mat-obs').value,
        deliveredByUid: session.agentUid || '',
        deliveredByName: session.agentName || '',
      });
      App.closeModal();
      App.toast('👶 Accouchement enregistré.');
      HospitalDesktopUI.navigate('maternity');
    } catch (e) {
      console.error('[Maternité] saveDelivery :', e);
      App.toast(e.message || 'Action impossible.', 'error');
    }
  }

  async function closeCase(caseId) {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;
    try {
      await CloudDB.updateDoc('maternityCases', caseId, {
        status: 'closed',
        closedAt: new Date().toISOString(),
      });
      App.toast('✅ Dossier clôturé.');
      HospitalDesktopUI.navigate('maternity');
    } catch (e) {
      console.error('[Maternité] closeCase :', e);
      App.toast(e.message || 'Action impossible.', 'error');
    }
  }

  return { render, openNew, lookupPatient, saveNew, addPrenatalVisit, openDelivery, saveDelivery, closeCase };
})();

window.HospitalMaternityModule = HospitalMaternityModule;
