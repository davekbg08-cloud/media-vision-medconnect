/* =====================================================
   MedConnect 2.0 — HospitalReceptionModule (desktop)
   Réception / Accueil : point d'entrée du patient à l'hôpital.

   Flux organisé :
     1. Identifier le patient : par numéro MC (existant) ou en
        créer un nouveau dossier.
     2. Enregistrer une PRISE EN CHARGE :
          - orientation : chez tel médecin affilié, OU
          - hospitalisation : dans un lit/chambre libre, OU
          - les deux.
     3. La prise en charge crée une entrée dans la file d'accueil
        (receptionVisits) ET, si hospitalisation, une admission
        (collection admissions déjà existante — pas de doublon).

   Capacités : create_patient + view_patient (réception, médecin,
   admin_hôpital). L'orientation/hospitalisation via réception ne
   pose PAS d'acte médical : c'est de l'enregistrement.
   ===================================================== */
const HospitalReceptionModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const REASONS = ['Consultation', 'Urgence', 'Suivi', 'Hospitalisation programmée', 'Maternité', 'Analyses', 'Autre'];

  let _visits = [];

  async function render(container) {
    HospitalPermissions.requireRoute('reception');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement de l'accueil…</p></div>`;

    try {
      _visits = await CloudDB.listByHospital('receptionVisits', hospitalId);
    } catch (e) {
      console.error('[Reception] Chargement :', e);
      _visits = [];
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayVisits = _visits.filter(v => String(v.arrivedAt || '').slice(0, 10) === today);
    const waiting = todayVisits.filter(v => v.status === 'waiting');

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>🛎️ Réception / Accueil</h1><p>Enregistrement et orientation des patients</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalReceptionModule.openIntake()">+ Enregistrer une arrivée</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${todayVisits.length}</h3><p>Arrivées aujourd'hui</p></div>
        <div class="hospital-stat-card"><h3>${waiting.length}</h3><p>⏳ En attente</p></div>
        <div class="hospital-stat-card"><h3>${todayVisits.filter(v=>v.status==='oriented').length}</h3><p>➡️ Orientés</p></div>
        <div class="hospital-stat-card"><h3>${todayVisits.filter(v=>v.status==='hospitalized').length}</h3><p>🛏️ Hospitalisés</p></div>
      </div>

      <div class="card">
        <h3>File d'accueil du jour</h3>
        ${!todayVisits.length ? `<p class="muted">Aucune arrivée enregistrée aujourd'hui.</p>` : `
        <div class="records-list">
          ${todayVisits.sort((a,b)=>String(b.arrivedAt||'').localeCompare(String(a.arrivedAt||''))).map(v => visitCard(v)).join('')}
        </div>`}
      </div>
    `;
  }

  function statusLabel(s) {
    return ({ waiting:'⏳ En attente', oriented:'➡️ Orienté', hospitalized:'🛏️ Hospitalisé', done:'✅ Clôturé' })[s] || s;
  }

  function visitCard(v) {
    return `
      <div class="record-card">
        <p><strong>${esc(v.patientName || '—')}</strong> <span class="id-tag">${esc(v.patientMc || '')}</span></p>
        <p class="muted">${statusLabel(v.status)} · ${esc(v.reason || '')} · arrivé à ${esc(String(v.arrivedAt||'').slice(11,16))}</p>
        ${v.doctorName ? `<p>👨‍⚕️ Orienté vers ${esc(v.doctorName)}</p>` : ''}
        ${v.bedLabel ? `<p>🛏️ ${esc(v.bedLabel)}</p>` : ''}
        ${v.status === 'waiting' ? `
          <button class="btn btn-ghost btn-sm" onclick="HospitalReceptionModule.closeVisit('${esc(v.id)}')">Clôturer</button>` : ''}
      </div>`;
  }

  /* ── ENREGISTREMENT D'UNE ARRIVÉE ──────────────────── */

  async function openIntake() {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;
    const hospitalId = await CloudDB.getActiveHospitalId();

    // Médecins affiliés actifs de l'établissement (orientation).
    const hospital = window.HospitalsRegistry?.getHospitalById?.(hospitalId);
    const doctors = (hospital?.staff || []).filter(s =>
      s.role === 'doctor' && (s.status === 'active' || s.status === 'approved'));

    // Lits libres (hospitalisation).
    let freeBeds = [];
    try {
      const beds = await CloudDB.listByHospital('beds', hospitalId);
      freeBeds = beds.filter(b => b.status === 'free');
    } catch (_) {}

    App.openModal('🛎️ Enregistrer une arrivée', `
      <div class="form-group">
        <label>Numéro MC du patient</label>
        <input id="rc-mc" placeholder="MC-2026-CD-XXXXXXXX (laisser vide si nouveau patient)">
        <button class="btn btn-ghost btn-xs" style="margin-top:.3rem" onclick="HospitalReceptionModule.lookupPatient()">🔍 Rechercher</button>
        <div id="rc-found" style="margin-top:.3rem"></div>
      </div>

      <details id="rc-new-details" style="margin-bottom:.6rem">
        <summary style="cursor:pointer;opacity:.8">Nouveau patient (si non trouvé)</summary>
        <div class="form-group" style="margin-top:.5rem"><label>Prénom</label><input id="rc-fn"></div>
        <div class="form-group"><label>Nom</label><input id="rc-ln"></div>
        <div class="form-group"><label>Date de naissance</label><input id="rc-dob" type="date"></div>
        <div class="form-group"><label>Téléphone</label><input id="rc-phone"></div>
      </details>

      <div class="form-group">
        <label>Motif de visite</label>
        <select id="rc-reason">${REASONS.map(r=>`<option>${r}</option>`).join('')}</select>
      </div>

      <div class="form-group">
        <label>Orienter vers un médecin (optionnel)</label>
        <select id="rc-doctor">
          <option value="">— Aucun —</option>
          ${doctors.map(d => `<option value="${esc(d.uid)}" data-name="${esc(d.name)}">${esc(d.name)} (${esc(d.professionalNumber||'')})</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label>Loger dans un lit / chambre (optionnel)</label>
        <select id="rc-bed">
          <option value="">— Aucun —</option>
          ${freeBeds.map(b => `<option value="${esc(b.id)}" data-label="Lit ${esc(b.number)} — ${esc(b.ward||'')}">Lit ${esc(b.number)} — ${esc(b.ward||'')}</option>`).join('')}
        </select>
      </div>

      <button class="btn btn-primary btn-full" onclick="HospitalReceptionModule.saveIntake()">Enregistrer l'arrivée</button>
    `);
  }

  function lookupPatient() {
    const mc = document.getElementById('rc-mc').value.trim().toUpperCase();
    const box = document.getElementById('rc-found');
    if (!mc) { box.innerHTML = ''; return; }
    const p = (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc);
    if (p) {
      box.innerHTML = `<small style="color:var(--secondary)">✅ ${esc(p.firstname||'')} ${esc(p.lastname||'')} trouvé.</small>`;
      const fn = document.getElementById('rc-fn'); if (fn) fn.value = p.firstname || '';
      const ln = document.getElementById('rc-ln'); if (ln) ln.value = p.lastname || '';
    } else {
      box.innerHTML = `<small style="color:var(--accent)">⚠️ Aucun patient avec ce numéro. Renseignez la section « Nouveau patient ».</small>`;
    }
  }

  async function saveIntake() {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;

      const hospitalId = await CloudDB.getActiveHospitalId();
      const est = window.HospitalPortal?.currentEstablishmentFields?.() || {};
      let mc = document.getElementById('rc-mc').value.trim().toUpperCase();
      let patient = mc ? (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc) : null;

      // Nouveau patient si non trouvé.
      if (!patient) {
        const fn = document.getElementById('rc-fn').value.trim();
        const ln = document.getElementById('rc-ln').value.trim();
        if (!fn || !ln) { App.toast('Patient introuvable : renseignez au moins prénom et nom.', 'error'); return; }
        if (!window.HospitalCapabilities?.guardHospitalAction?.('create_patient')) return;
        // Enregistrement normal (réception) = action desktop soumise à
        // l'abonnement. Seul l'intake d'urgence (js/hospital-emergency.js)
        // est exempté. Message clair au lieu d'un échec silencieux.
        try {
          await CloudDB.requireWritableSubscription('create_patient');
        } catch (subErr) {
          App.toast(subErr.message || "Enregistrement bloqué : abonnement de l'établissement expiré.", 'error');
          return;
        }
        patient = window.DB?.addPatient?.({
          firstname: fn, lastname: ln,
          dob: document.getElementById('rc-dob').value,
          phone: document.getElementById('rc-phone').value.trim(),
          ...est,
        });
        mc = patient.id;
      }

      const reason = document.getElementById('rc-reason').value;
      const docSel = document.getElementById('rc-doctor');
      const doctorUid = docSel.value;
      const doctorName = docSel.selectedOptions[0]?.dataset?.name || '';
      const bedSel = document.getElementById('rc-bed');
      const bedId = bedSel.value;
      const bedLabel = bedSel.selectedOptions[0]?.dataset?.label || '';

      let status = 'waiting';
      if (bedId) status = 'hospitalized';
      else if (doctorUid) status = 'oriented';

      const visitId = DB.makeId('RCV');
      await CloudDB.createDoc('receptionVisits', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: `${patient.firstname||''} ${patient.lastname||''}`.trim(),
        reason,
        doctorUid, doctorName,
        bedId, bedLabel,
        status,
        arrivedAt: new Date().toISOString(),
        ...est,
      }, visitId);

      // Hospitalisation → crée l'admission (collection existante) et
      // occupe le lit. On réutilise le contrat admissions, pas de doublon.
      if (bedId) {
        const admissionId = DB.makeId('ADM');
        await CloudDB.createDoc('admissions', {
          establishmentId: hospitalId, hospitalId,
          patientMc: mc,
          patientName: `${patient.firstname||''} ${patient.lastname||''}`.trim(),
          bedId, ward: bedLabel,
          reason,
          doctorUid, doctorName,
          status: 'admitted',
          admittedAt: new Date().toISOString(),
          dischargedAt: '',
          ...est,
        }, admissionId);
        try {
          await CloudDB.updateDoc('beds', bedId, { status: 'occupied' });
        } catch (bedErr) {
          // L'admission a réussi mais le lit n'a pas pu être marqué
          // occupé : incohérence à signaler (sinon le lit paraît libre).
          console.error('[Reception] Occupation du lit échouée :', bedErr);
          App.toast('⚠️ Patient admis, mais le lit n\'a pas pu être marqué occupé. Vérifiez l\'état des lits.', 'error');
        }

        // Miroir vers mc_admissions — correctif (audit) : même besoin
        // que hospital-beds.js saveAdmission(), sinon cette admission-là
        // (créée depuis le flux réception) reste elle aussi invisible
        // au patient.
        if (window.DB?.addAdmissionRecord) {
          DB.addAdmissionRecord({
            // Lien vers l'admission desktop pour que la sortie mette à
            // jour ce miroir (cf. DB.updateAdmissionRecord).
            sourceAdmissionId: admissionId,
            patient_id: mc,
            patient_uid: patient?.patient_uid || patient?.patientAuthUid || '',
            bedId, ward: bedLabel, reason,
            status: 'admitted',
            admittedAt: new Date().toISOString(),
            hospital_id: hospitalId, establishmentId: hospitalId,
          });
        }
      }

      // Notifie le médecin orienté (file de travail côté mobile/desktop).
      if (doctorUid) {
        try {
          await CloudDB.createNotification({
            establishmentId: hospitalId,
            recipientUserId: doctorUid,
            type: 'reception_orientation',
            title: '🛎️ Nouveau patient orienté',
            message: `${patient.firstname||''} ${patient.lastname||''} (${mc}) vous est orienté — motif : ${reason}.`,
            targetType: 'receptionVisits',
            targetId: visitId,
          });
        } catch (notifErr) {
          console.error('[Reception] Notification médecin échouée :', notifErr);
        }
      }

      await CloudDB.createAuditLog('reception_intake', 'receptionVisits', visitId, { patientMc: mc, doctorUid, bedId });
      App.closeModal();
      App.toast('✅ Arrivée enregistrée.');
      HospitalDesktopUI.navigate('reception');
    } catch (e) {
      console.error('[Reception] saveIntake :', e);
      App.toast(e.message || 'Erreur lors de l\'enregistrement.', 'error');
    }
  }

  async function closeVisit(visitId) {
    try {
      await CloudDB.updateDoc('receptionVisits', visitId, { status: 'done', closedAt: new Date().toISOString() });
      HospitalDesktopUI.navigate('reception');
    } catch (e) {
      console.error('[Reception] closeVisit :', e);
      App.toast(e.message || 'Erreur.', 'error');
    }
  }

  return { render, openIntake, lookupPatient, saveIntake, closeVisit };
})();

window.HospitalReceptionModule = HospitalReceptionModule;
