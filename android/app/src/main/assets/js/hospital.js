/* =====================================================
   MedConnect 2.0 — Hospital / Doctor Portal
   Ordonnance intelligente + Réseau + Labo
   ===================================================== */
const HospitalPortal = (() => {
  const t   = k => I18n.t(k);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function currentEstablishmentFields() {
    const user = Auth.getUser() || {};
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return {
      created_by: user.uid || '',
      created_by_role: user.role || '',
      created_by_name: user.name || '',
      hospital_id: h?.establishmentId || h?.hid || '',
      establishmentId: h?.establishmentId || h?.hid || '',
      establishmentName: h?.name || '',
    };
  }

  function patientsForContext() {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return DB.getPatients();
    return window.HospitalsRegistry?.getPatientsForContext?.(user.uid) ||
      DB.getPatients().filter(p => !p.created_by || p.created_by === user.uid);
  }

  function itemInContext(item, patientIds) {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return true;
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return patientIds.has(item.patient_id) ||
      item.created_by === user.uid ||
      item.doctor_uid === user.uid ||
      (h && (item.establishmentId === h.establishmentId || item.hospital_id === h.establishmentId));
  }

  function consultationsForContext() {
    const patientIds = new Set(patientsForContext().map(p => p.id));
    return DB.getConsultations().filter(c => itemInContext(c, patientIds));
  }

  function prescriptionsForContext() {
    const patientIds = new Set(patientsForContext().map(p => p.id));
    return DB.getPrescriptions().filter(rx => itemInContext(rx, patientIds));
  }

  function appointmentsForContext() {
    const user = Auth.getUser() || {};
    return window.HospitalsRegistry?.getAppointmentsForContext?.(user.uid) ||
      DB.getAppointments().filter(a => itemInContext(a, new Set(patientsForContext().map(p => p.id))));
  }

  function canUsePatient(patientId) {
    return patientsForContext().some(p => p.id === patientId) ||
      ACL.canAccessPatient(Auth.getUser(), patientId);
  }

  function searchContextPatients(q) {
    const list = patientsForContext();
    if (!q) return list;
    const ql = q.toLowerCase();
    return list.filter(p =>
      (p.id||'').toLowerCase().includes(ql) ||
      (p.firstname||'').toLowerCase().includes(ql) ||
      (p.lastname||'').toLowerCase().includes(ql) ||
      (p.phone||'').includes(ql));
  }

  function render(section) {
    const main = document.getElementById('main-content');
    switch (section) {
      case 'dashboard':     renderDashboard(main);    break;
      case 'patients':      renderPatients(main);      break;
      case 'consultations': renderConsultations(main); break;
      case 'prescriptions': renderPrescriptions(main); break;
      case 'lab':           LabModule.renderForHospital(main); break;
      case 'map':           MapModule.render(main);    break;
      default:              renderDashboard(main);
    }
  }

  /* ── DASHBOARD ──────────────────────────────────── */
  function renderDashboard(main) {
    const td = new Date().toISOString().slice(0,10);
    const patients = patientsForContext();
    const consultations = consultationsForContext();
    const appointments = appointmentsForContext();
    const unreadMessages = DB.getMessages().filter(m => m.to_role === Auth.getUser()?.role && !m.read).length;
    const s = {
      totalPatients: patients.length,
      todayPatients: patients.filter(p => (p.created_at || '').startsWith(td)).length,
      totalConsults: consultations.length,
      todayConsults: consultations.filter(c => c.date === td).length,
      pendingApts: appointments.filter(a => a.status === 'pending' && a.date >= td).length,
      unreadMessages,
    };
    const apts = appointments.filter(a=>a.status==='pending' && a.date>=td).slice(0,3);
    main.innerHTML = `
      <div class="page-header">
        <h2>📊 ${t('nav_dashboard')}</h2>
        <button class="btn btn-primary btn-sm" onclick="HospitalPortal.openNewPatient()">+ ${t('btn_new_patient')}</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card" style="border-top:3px solid var(--primary)">
          <div class="stat-icon">👥</div><div class="stat-value">${s.totalPatients}</div>
          <div class="stat-label">${t('stat_total_patients')}</div>
          <div class="stat-sub">+${s.todayPatients} ${t('stat_today')}</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--secondary)">
          <div class="stat-icon">🩺</div><div class="stat-value">${s.totalConsults}</div>
          <div class="stat-label">${t('stat_consults')}</div>
          <div class="stat-sub">${s.todayConsults} ${t('stat_today')}</div>
        </div>
        <div class="stat-card" style="border-top:3px solid #F59E0B">
          <div class="stat-icon">📅</div><div class="stat-value">${s.pendingApts}</div>
          <div class="stat-label">RDV en attente</div>
          <div class="stat-sub"><button class="btn btn-ghost btn-xs" onclick="App.navigateTo('appointments')">Voir →</button></div>
        </div>
        <div class="stat-card" style="border-top:3px solid #A855F7">
          <div class="stat-icon">📨</div><div class="stat-value">${s.unreadMessages}</div>
          <div class="stat-label">Messages non lus</div>
          <div class="stat-sub"><button class="btn btn-ghost btn-xs" onclick="App.navigateTo('inbox')">Voir →</button></div>
        </div>
      </div>
      ${apts.length ? `
        <h3 style="margin:.75rem 0 .5rem;color:var(--accent)">📅 RDV à venir</h3>
        <div class="records-list" style="margin-bottom:1.5rem">
          ${apts.map(a=>{const p=DB.getPatientById(a.patient_id); return `
            <div class="record-card" style="display:flex;align-items:center;gap:.85rem">
              <span>⏳</span>
              <div style="flex:1">
                <strong>${a.date} à ${a.time}</strong> — ${esc(a.reason)||'—'}
                ${p?`<span class="id-tag" style="margin-left:.4rem">${p.id}</span>`:''}
              </div>
              <button class="btn btn-ghost btn-xs" onclick="AppointmentsModule.setStatus('${a.aid}','confirmed')">✅</button>
            </div>`}).join('')}
        </div>` : ''}
      <div class="page-header" style="margin-top:1rem">
        <h3>Patients récents</h3>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('patients')">Tous →</button>
      </div>
      <div class="records-list">
        ${patients.slice(-4).reverse().map(p=>patRow(p)).join('')
          || `<div class="card empty-state"><p>${t('no_data')}</p></div>`}
      </div>`;
  }

  /* ── PATIENTS ───────────────────────────────────── */
  function renderPatients(main) {
    main.innerHTML = `
      <div class="page-header">
        <h2>👥 ${t('nav_patients')}</h2>
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" onclick="HospitalPortal.openExternalSearch()">🔍 Patient d'un autre établissement</button>
          <button class="btn btn-primary btn-sm" onclick="HospitalPortal.openNewPatient()">+ ${t('btn_new_patient')}</button>
        </div>
      </div>
      <div class="search-bar">
        <input type="search" id="h-srch" placeholder="${t('search_placeholder')}"
               oninput="HospitalPortal.filter(this.value)">
      </div>
      <div id="pat-list" class="records-list">
        ${patientsForContext().slice().reverse().map(p=>patRow(p)).join('')
          || `<div class="card empty-state"><p>${t('no_data')}</p></div>`}
      </div>`;
  }

  /* ── PARTIE K — accès à un patient hors de mon périmètre ── */
  function openExternalSearch() {
    App.openModal('🔍 Rechercher un patient — numéro unique', `
      <p style="font-size:.83rem;color:var(--text-muted);margin-bottom:.75rem">
        Pour un patient déjà suivi ailleurs, entrez son numéro unique exact (MC-...).
        Une demande d'accès lui sera envoyée — il devra l'autoriser.
      </p>
      <div class="form-group">
        <label>Numéro unique patient</label>
        <input type="text" id="ext-pid" placeholder="MC-2026-CD-XXXXXXXX"
          style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()">
      </div>
      <div id="ext-result"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Fermer</button>
        <button type="button" class="btn btn-primary" onclick="HospitalPortal.searchExternalPatient()">Rechercher</button>
      </div>`);
  }

  function searchExternalPatient() {
    const id = (document.getElementById('ext-pid')?.value || '').trim().toUpperCase();
    const box = document.getElementById('ext-result');
    const p = DB.getPatientById(id);
    if (!p) { box.innerHTML = `<p style="color:var(--danger);font-size:.83rem;margin-top:.5rem">${t('msg_no_record')}</p>`; return; }
    if (canUsePatient(id)) {
      box.innerHTML = `<p style="color:var(--secondary);font-size:.83rem;margin-top:.5rem">✅ Vous avez déjà accès à ce patient.</p>`;
      return;
    }
    const user = Auth.getUser();
    const already = ACL.getPatientConsents(id).find(c => c.doctor_id === user.uid && c.status === 'pending');
    box.innerHTML = `
      <div class="record-card" style="margin-top:.6rem">
        <strong>${esc(p.firstname)} ${esc(p.lastname)}</strong> <span class="id-tag">${p.id}</span>
        <p style="font-size:.82rem;color:var(--text-muted);margin-top:.3rem">Vous n'avez pas accès à ce dossier. Le patient doit autoriser votre demande.</p>
        ${already
          ? `<p style="font-size:.8rem;color:var(--accent);margin-top:.4rem">⏳ Demande déjà envoyée — en attente de réponse.</p>`
          : `<button class="btn btn-primary btn-sm" style="margin-top:.5rem" onclick="HospitalPortal.requestPatientAccess('${id}')">🔐 Demander l'accès</button>`}
      </div>`;
  }

  function requestPatientAccess(patientId) {
    const user = Auth.getUser();
    ACL.requestConsent(patientId, user.uid, user.name);
    App.toast('📤 Demande envoyée au patient');
    App.closeModal();
  }

  function filter(q) {
    document.getElementById('pat-list').innerHTML =
      searchContextPatients(q).slice().reverse().map(p=>patRow(p)).join('')
      || `<div class="card empty-state"><p>${t('msg_no_record')}</p></div>`;
  }

  function patRow(p) {
    const age = p.dob ? Math.floor((Date.now()-new Date(p.dob))/(365.25*24*3600*1000)) : '?';
    const nc  = DB.getPatientConsultations(p.id).length;
    const pending = p.medical_completion_status === 'pending';
    return `
      <div class="record-card patient-row" onclick="HospitalPortal.openDetail('${p.id}')">
        <div class="patient-row-avatar">${p.gender==='F'?'👩':'👨'}</div>
        <div class="patient-row-info">
          <strong>${esc(p.firstname)} ${esc(p.lastname)}</strong>
          <span class="id-tag">${p.id}</span>
          ${pending ? `<span class="badge-pending">🩺 À compléter par le médecin</span>` : ''}
          <small>${age} ${t('years')} · 🩸 ${p.blood_type||'—'} · 📋 ${nc}</small>
        </div>
        <div class="patient-row-actions">
          ${window.HospitalCapabilities?.can?.(Auth.getUser()?.role, 'create_consultation')
            ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();HospitalPortal.openConsult('${p.id}')">🩺</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();HospitalPortal.deletePatient('${p.id}')">🗑️</button>
        </div>
      </div>`;
  }

  /* ── PATIENT DETAIL ─────────────────────────────── */
  function openDetail(id) {
    if (!canUsePatient(id)) { App.toast('Accès patient non autorisé.', 'error'); return; }
    const p = DB.getPatientById(id); if (!p) return;
    const age  = p.dob ? Math.floor((Date.now()-new Date(p.dob))/(365.25*24*3600*1000)) : '?';
    const cons = DB.getPatientConsultations(id);
    const vacc = DB.getPatientVaccinations(id);
    const labs = DB.getPatientLabResults(id);
    App.openModal(`🪪 ${p.firstname} ${p.lastname}`, `
      <div class="id-badge-large">${p.id}</div>
      <div style="font-size:.87rem">
        <p><strong>${t('form_dob')} :</strong> ${p.dob||'—'} (${age} ${t('years')}) · ${p.gender==='F'?'♀':'♂'}</p>
        <p><strong>${t('form_blood_type')} :</strong> ${p.blood_type||'—'} · <strong>${t('form_country')} :</strong> ${p.country_code||'—'}</p>
        <p><strong>${t('form_phone')} :</strong> ${p.phone||'—'}</p>
        <p><strong>${t('form_allergies')} :</strong> <span style="color:var(--danger)">${esc(p.allergies)||'Aucune'}</span></p>
        <p><strong>${t('form_chronic')} :</strong> ${esc(p.chronic)||'—'}</p>
      </div>
      <div style="display:flex;gap:.5rem;margin:.75rem 0;flex-wrap:wrap">
        <span class="chip">📋 ${cons.length} consultations</span>
        <span class="chip">💉 ${vacc.length} vaccins</span>
        <span class="chip">🧪 ${labs.length} analyses</span>
      </div>
      <h4 style="margin-bottom:.5rem">📋 Dernières consultations</h4>
      ${cons.slice(0,3).map(c=>`
        <div class="mini-record">
          <span>📅 ${c.date}</span><span>${esc(c.diagnosis)}</span>
          <button class="btn btn-ghost btn-xs" onclick="HospitalPortal.delConsult('${c.cid}','${id}')">🗑️</button>
        </div>`).join('')||`<p style="color:var(--text-muted);font-size:.85rem">${t('no_data')}</p>`}
      <div class="modal-footer">
        ${window.HospitalCapabilities?.can?.(Auth.getUser()?.role, 'create_consultation')
          ? `<button class="btn btn-primary btn-sm" onclick="App.closeModal();HospitalPortal.openConsult('${id}')">🩺 ${t('new_consultation')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="App.closeModal();LabModule.openNew('${id}')">🧪 Analyse</button>
        <button class="btn btn-ghost btn-sm" onclick="App.closeModal();AppointmentsModule.openNew('${id}')">📅 RDV</button>
        <button class="btn btn-ghost btn-sm" onclick="PatientPortal.printRecord('${id}')">🖨️ ${t('btn_print')}</button>
      </div>`);
  }

  /* ── NEW PATIENT ────────────────────────────────── */
  function openNewPatient() {
    const countries = PatientPortal.getCountriesList();
    App.openModal(`➕ ${t('btn_new_patient')}`, `
      <form onsubmit="HospitalPortal.saveNewPatient(event)">
        <div class="form-grid">
          <div class="form-group"><label>${t('form_firstname')} *</label><input type="text" id="hp-fn" required></div>
          <div class="form-group"><label>${t('form_lastname')} *</label><input type="text" id="hp-ln" required></div>
          <div class="form-group"><label>${t('form_dob')}</label><input type="date" id="hp-dob"></div>
          <div class="form-group"><label>${t('form_gender')}</label>
            <select id="hp-gender"><option value="">—</option>
              <option value="M">${t('form_male')}</option><option value="F">${t('form_female')}</option></select>
          </div>
          <div class="form-group"><label>${t('form_blood_type')}</label>
            <select id="hp-blood"><option value="">—</option>
              ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g=>`<option>${g}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label>${t('form_country')} *</label>
            <select id="hp-country" required><option value="">—</option>
              ${countries.map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}</select>
          </div>
          <div class="form-group"><label>${t('form_phone')}</label><input type="tel" id="hp-phone"></div>
          <div class="form-group"><label>${t('weight')}</label><input type="number" id="hp-weight" min="1" max="500"></div>
          <div class="form-group full-width"><label>${t('form_allergies')}</label><textarea id="hp-allergies" rows="2"></textarea></div>
          <div class="form-group full-width"><label>${t('form_chronic')}</label><textarea id="hp-chronic" rows="2"></textarea></div>
          <div class="form-group full-width"><label>${t('emergency_contact')}</label><input type="text" id="hp-emerg"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
  }

  function saveNewPatient(e) {
    e.preventDefault();
    const user = Auth.getUser() || {};
    const isNurse = user.role === 'nurse';
    const completionFields = isNurse
      ? {
          created_by: user.uid || '',
          created_by_role: 'nurse',
          nurse_uid: user.uid || '',
          nurse_name: user.name || '',
          nurse_registration_number: user.matricule || user.order_num || '',
          status: 'awaiting_doctor',
          medical_completion_status: 'pending',
        }
      : {
          created_by: user.uid || '',
          created_by_role: user.role || '',
          medical_completion_status: (user.role === 'doctor') ? 'completed' : 'pending',
        };
    const p = DB.addPatient({
      firstname: document.getElementById('hp-fn').value.trim(),
      lastname:  document.getElementById('hp-ln').value.trim(),
      dob:       document.getElementById('hp-dob').value,
      gender:    document.getElementById('hp-gender').value,
      blood_type:document.getElementById('hp-blood').value,
      country_code:document.getElementById('hp-country').value,
      phone:     document.getElementById('hp-phone').value,
      weight:    document.getElementById('hp-weight').value,
      allergies: document.getElementById('hp-allergies').value,
      chronic:   document.getElementById('hp-chronic').value,
      emergency: document.getElementById('hp-emerg').value,
      ...currentEstablishmentFields(),
      ...completionFields,
    });
    App.closeModal(); App.toast(`✅ ${t('msg_saved')} — ${p.id}`); App.navigateTo('patients');
  }

  function deletePatient(id) {
    if (!canUsePatient(id)) { App.toast('Accès patient non autorisé.', 'error'); return; }
    if (!confirm(t('msg_confirm_delete'))) return;
    DB.deletePatient(id); App.toast(t('msg_deleted')); App.navigateTo('patients');
  }

  /* ── CONSULTATION + ORDONNANCE INTELLIGENTE ───── */
  function openConsult(patientId) {
    if (!canUsePatient(patientId)) { App.toast('Accès patient non autorisé.', 'error'); return; }
    const p = DB.getPatientById(patientId); if (!p) return;
    App.openModal(`🩺 ${t('new_consultation')} — ${p.firstname} ${p.lastname}`, `
      <div class="id-badge-large">${p.id}</div>
      ${p.allergies ? `<div class="alert-box">⚠️ ${t('form_allergies')} : <strong>${esc(p.allergies)}</strong></div>` : ''}
      <form onsubmit="HospitalPortal.saveConsult(event,'${patientId}')">
        <div class="form-group"><label>${t('consult_doctor')}</label>
          <input type="text" id="c-doc" value="${Auth.getUser()?.name||''}"></div>
        <div class="form-group"><label>Date</label>
          <input type="date" id="c-date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group"><label>Motif</label><input type="text" id="c-reason" placeholder="Fièvre, douleur…"></div>
        <div class="form-group"><label>${t('consult_diagnosis')} *</label><textarea id="c-diag" rows="3" required></textarea></div>
        <div class="form-group"><label>${t('consult_treatment')}</label><textarea id="c-treat" rows="2"></textarea></div>
        <div class="form-group"><label>${t('consult_notes')}</label><textarea id="c-notes" rows="2"></textarea></div>
        <div class="rx-block">
          <div class="rx-block-header">
            <span class="rx-block-title">💊 Ordonnance</span>
          </div>
          <p class="rx-block-hint">Ajoutez au moins un médicament pour créer une ordonnance.</p>
          <div id="rx-list"></div>
          <button type="button" class="btn btn-ghost btn-sm rx-add-btn" onclick="HospitalPortal.addRxItem()">+ Ajouter un médicament</button>
        </div>
        <div id="smart-check-result"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="HospitalPortal.runSmartCheck('${patientId}')">🔍 Vérif. intelligente</button>
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
    // Première ligne médicament affichée automatiquement à l'ouverture.
    addRxItem();
  }

  function addRxItem() {
    const list = document.getElementById('rx-list');
    if (!list) return;
    const el = document.createElement('div');
    el.className = 'rx-item';
    el.innerHTML = `
      <input type="text" class="rx-name"   placeholder="${t('med_name')}">
      <input type="text" class="rx-dosage" placeholder="Dosage / fréquence">
      <button type="button" class="btn btn-ghost btn-sm rx-remove" onclick="HospitalPortal.removeRxItem(this)">✕ Retirer</button>`;
    list.appendChild(el);
    _refreshRxRemoveButtons();
  }

  function removeRxItem(btn) {
    const item = btn.closest('.rx-item');
    if (item) item.remove();
    _refreshRxRemoveButtons();
  }

  function _refreshRxRemoveButtons() {
    const items = [...document.querySelectorAll('#rx-list .rx-item')];
    items.forEach(it => {
      const rm = it.querySelector('.rx-remove');
      if (rm) rm.style.display = items.length <= 1 ? 'none' : '';
    });
  }

  function runSmartCheck(patientId) {
    const meds = [...document.querySelectorAll('.rx-item')]
      .map(el => ({ name: el.querySelector('.rx-name')?.value, dosage: el.querySelector('.rx-dosage')?.value }))
      .filter(m => m.name?.trim());
    if (!meds.length) { App.toast('Ajoutez des médicaments d\'abord', 'error'); return; }
    const warns = Network.smartCheck(patientId, meds);
    document.getElementById('smart-check-result').innerHTML = Network.renderSmartCheckResult(warns);
  }

  function saveConsult(e, patientId) {
    e.preventDefault();
    const user = Auth.getUser() || {};
    const hosp = window.HospitalsRegistry?.getCurrentHospital?.();

    /* ── PARTIE A/E — garde obligatoire avant toute création ── */
    if (user.role === 'doctor' && !user.order_num) {
      App.toast("Impossible de créer l'ordonnance : numéro d'ordre manquant.", 'error'); return;
    }
    if (user.role === 'doctor' && !hosp) {
      App.toast("Impossible de créer l'ordonnance : aucun établissement actif. Sélectionnez un établissement.", 'error'); return;
    }

    const fDate    = document.getElementById('c-date').value;
    const fDoctor  = document.getElementById('c-doc').value;
    const fReason  = document.getElementById('c-reason').value;
    const fTreat   = document.getElementById('c-treat').value;
    const fNotes   = document.getElementById('c-notes').value;
    const diag = document.getElementById('c-diag').value;
    const meds = [...document.querySelectorAll('.rx-item')]
      .map(el => ({ name: el.querySelector('.rx-name').value, dosage: el.querySelector('.rx-dosage').value }))
      .filter(m => m.name?.trim());

    const est = currentEstablishmentFields();
    const consult = DB.addConsultation({
      patient_id: patientId,
      date:       fDate,
      doctor:     fDoctor,
      doctorOrderNumber: user.order_num || '',
      doctorSpecialty:   user.specialty || '',
      reason:     fReason,
      diagnosis:  diag,
      treatment:  fTreat,
      notes:      fNotes,
      ...est,
    });

    // Parcours infirmière → médecin : la 1ère consultation médicale
    // marque la fiche complétée (traçabilité conservée).
    if (user.role === 'doctor') {
      const pat = DB.getPatientById(patientId);
      if (pat && pat.medical_completion_status === 'pending') {
        DB.updatePatient(patientId, {
          medical_completion_status: 'completed',
          status: 'active',
          completed_by_doctor_uid: user.uid || '',
          completed_by_doctor_name: fDoctor || user.name || '',
          completed_at: new Date().toISOString(),
        });
      }
    }

    DB.addEstablishmentDocument({
      relatedId:        consult.cid,
      documentType:     'consultation',
      documentTitle:     `Consultation — ${fReason || diag}`,
      establishmentId:   est.establishmentId || '',
      establishmentName: est.establishmentName || '',
      doctorUid:          user.uid || '',
      doctorName:         fDoctor,
      doctorOrderNumber:  user.order_num || '',
      patientUid:         patientId,
      patientCode:        patientId,
      status:             'active',
      createdByUid:       user.uid || '',
      createdByRole:      user.role || '',
      accessLevel:        'establishment',
    });

    let rxId = null;
    if (meds.length) {
      const rx = DB.addPrescription({
        patient_id: patientId,
        date:       fDate,
        doctor:     fDoctor,
        doctor_uid: user.uid || '',
        doctorOrderNumber: user.order_num || '',
        doctorSpecialty:   user.specialty || '',
        diagnosis:  diag,
        medicines:  meds,
        ...est,
      });

      DB.addEstablishmentDocument({
        relatedId:        rx.pid,
        documentType:      'prescription',
        documentTitle:      `Ordonnance — ${meds.length} médicament(s)`,
        establishmentId:    est.establishmentId || '',
        establishmentName:  est.establishmentName || '',
        doctorUid:           user.uid || '',
        doctorName:          fDoctor,
        doctorOrderNumber:   user.order_num || '',
        patientUid:          patientId,
        patientCode:         patientId,
        status:              'active',
        createdByUid:        user.uid || '',
        createdByRole:       user.role || '',
        accessLevel:         'establishment',
      });
      rxId = rx.pid;
    }

    // Fermeture APRÈS création complète (consultation + ordonnance +
    // documents) : plus aucune lecture du formulaire ensuite.
    App.closeModal();

    if (rxId) { openPrescriptionTarget(rxId); return; }

    App.toast(t('msg_saved')); App.navigateTo('consultations');
  }

  /* ── PARTIE E/F — choix de la destination de l'ordonnance ── */
  function openPrescriptionTarget(pid) {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('prescribe')) return;
    const pharmacies = Network.getAvailablePharmacies();
    App.openModal('💊 Envoyer l\'ordonnance', `
      <p style="font-size:.84rem;color:var(--text-muted);margin-bottom:1rem">
        Choisissez la destination. Par défaut, aucune pharmacie n'a accès à l'ordonnance.
      </p>
      <div class="form-group">
        <label>Destination</label>
        <select id="rx-target">
          <option value="patient">Patient seulement (aucune pharmacie)</option>
          ${pharmacies.map(ph => `<option value="${ph.uid}">${esc(ph.pharmacy || ph.name)}${ph.country?' — '+ph.country:''}</option>`).join('')}
        </select>
        ${!pharmacies.length ? `<small style="color:var(--accent)">Aucune pharmacie validée disponible pour le moment.</small>` : ''}
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="HospitalPortal.confirmPrescriptionTarget('${pid}')">📤 Confirmer l'envoi</button>
      </div>`);
  }

  function confirmPrescriptionTarget(pid) {
    if (!window.HospitalCapabilities?.guardHospitalAction?.('prescribe')) return;
    const target = document.getElementById('rx-target')?.value || 'patient';
    Network.sendPrescriptionToPharmacy(pid, target);
    App.closeModal();
    App.navigateTo('consultations');
  }

  function delConsult(cid, patientId) {
    if (!confirm(t('msg_confirm_delete'))) return;
    DB.deleteConsultation(cid); App.toast(t('msg_deleted')); openDetail(patientId);
  }

  /* ── CONSULTATIONS LIST ─────────────────────────── */
  function renderConsultations(main) {
    const list = consultationsForContext().slice().reverse();
    main.innerHTML = `
      <div class="page-header"><h2>🩺 ${t('nav_consultations')}</h2></div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(c => {
          const p = DB.getPatientById(c.patient_id);
          return `<div class="record-card">
            <div class="record-header">
              <span class="record-date">📅 ${c.date}</span>
              ${p?`<span class="id-tag">${p.id}</span><strong>${esc(p.firstname)} ${esc(p.lastname)}</strong>`:''}
              <span class="record-doctor">👨‍⚕️ ${esc(c.doctor)||'—'}</span>
            </div>
            <p><strong>${t('consult_diagnosis')} :</strong> ${esc(c.diagnosis)}</p>
            ${c.treatment?`<p><strong>${t('consult_treatment')} :</strong> ${esc(c.treatment)}</p>`:''}
          </div>`;
        }).join('')}
      </div>`;
  }

  /* ── PRESCRIPTIONS LIST ─────────────────────────── */
  function renderPrescriptions(main) {
    const list = prescriptionsForContext().slice().reverse();
    const curs = t('currency');
    main.innerHTML = `
      <div class="page-header"><h2>💊 Ordonnances</h2></div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(rx => {
          const p = DB.getPatientById(rx.patient_id);
          return `<div class="record-card presc-card">
            <div class="record-header">
              <span class="record-date">📅 ${rx.date}</span>
              ${p?`<span class="id-tag">${p.id}</span><strong>${esc(p.firstname)} ${esc(p.lastname)}</strong>`:''}
              <span class="record-doctor">👨‍⚕️ ${esc(rx.doctor)||'—'}</span>
              ${window.HospitalCapabilities?.can?.(Auth.getUser()?.role, 'prescribe')
                ? `<button class="btn btn-ghost btn-xs" onclick="Network.sendPrescriptionToPharmacy('${rx.pid}','Pharmacie')">📤 Pharmacie</button>` : ''}
              <button class="btn btn-ghost btn-xs" onclick="PatientPortal.printRx('${rx.pid}')">🖨️</button>
            </div>
            <p><strong>Diagnostic :</strong> ${esc(rx.diagnosis)}</p>
            <ul style="padding-left:1.2rem;margin-top:.4rem">
              ${(rx.medicines||[]).map(m=>`<li>💊 ${esc(m.name)} — ${esc(m.dosage)}</li>`).join('')}
            </ul>
          </div>`;
        }).join('')}
      </div>`;
  }

  return {
    render, filter, openDetail, openNewPatient, saveNewPatient, deletePatient,
    openExternalSearch, searchExternalPatient, requestPatientAccess,
    openConsult, addRxItem, removeRxItem, runSmartCheck, saveConsult, delConsult,
    openPrescriptionTarget, confirmPrescriptionTarget,
    renderConsultations, renderPrescriptions,
  };
})();

const HospitalModule = HospitalPortal;

window.HospitalPortal = HospitalPortal;
window.HospitalModule = HospitalModule;
