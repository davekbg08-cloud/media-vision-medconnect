/* =====================================================
   MedConnect 2.0 — Hospital / Doctor Portal
   Ordonnance intelligente + Réseau + Labo
   ===================================================== */
const HospitalPortal = (() => {
  const t   = k => I18n.t(k);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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
    const s   = DB.getStats();
    const apts = DB.getAppointments().filter(a=>a.status==='pending' && a.date>=new Date().toISOString().slice(0,10)).slice(0,3);
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
        ${DB.getPatients().slice(-4).reverse().map(p=>patRow(p)).join('')
          || `<div class="card empty-state"><p>${t('no_data')}</p></div>`}
      </div>`;
  }

  /* ── PATIENTS ───────────────────────────────────── */
  function renderPatients(main) {
    main.innerHTML = `
      <div class="page-header">
        <h2>👥 ${t('nav_patients')}</h2>
        <button class="btn btn-primary btn-sm" onclick="HospitalPortal.openNewPatient()">+ ${t('btn_new_patient')}</button>
      </div>
      <div class="search-bar">
        <input type="search" id="h-srch" placeholder="${t('search_placeholder')}"
               oninput="HospitalPortal.filter(this.value)">
      </div>
      <div id="pat-list" class="records-list">
        ${DB.getPatients().reverse().map(p=>patRow(p)).join('')
          || `<div class="card empty-state"><p>${t('no_data')}</p></div>`}
      </div>`;
  }

  function filter(q) {
    document.getElementById('pat-list').innerHTML =
      DB.searchPatients(q).reverse().map(p=>patRow(p)).join('')
      || `<div class="card empty-state"><p>${t('msg_no_record')}</p></div>`;
  }

  function patRow(p) {
    const age = p.dob ? Math.floor((Date.now()-new Date(p.dob))/(365.25*24*3600*1000)) : '?';
    const nc  = DB.getPatientConsultations(p.id).length;
    return `
      <div class="record-card patient-row" onclick="HospitalPortal.openDetail('${p.id}')">
        <div class="patient-row-avatar">${p.gender==='F'?'👩':'👨'}</div>
        <div class="patient-row-info">
          <strong>${esc(p.firstname)} ${esc(p.lastname)}</strong>
          <span class="id-tag">${p.id}</span>
          <small>${age} ${t('years')} · 🩸 ${p.blood_type||'—'} · 📋 ${nc}</small>
        </div>
        <div class="patient-row-actions">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();HospitalPortal.openConsult('${p.id}')">🩺</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();HospitalPortal.deletePatient('${p.id}')">🗑️</button>
        </div>
      </div>`;
  }

  /* ── PATIENT DETAIL ─────────────────────────────── */
  function openDetail(id) {
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
        <button class="btn btn-primary btn-sm" onclick="App.closeModal();HospitalPortal.openConsult('${id}')">🩺 ${t('new_consultation')}</button>
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
    });
    App.closeModal(); App.toast(`✅ ${t('msg_saved')} — ${p.id}`); App.navigateTo('patients');
  }

  function deletePatient(id) {
    if (!confirm(t('msg_confirm_delete'))) return;
    DB.deletePatient(id); App.toast(t('msg_deleted')); App.navigateTo('patients');
  }

  /* ── CONSULTATION + ORDONNANCE INTELLIGENTE ───── */
  function openConsult(patientId) {
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
        <div class="form-group">
          <label>💊 Ordonnance <button type="button" class="btn btn-ghost btn-xs" onclick="HospitalPortal.addRxItem()">+ Ajouter</button></label>
          <div id="rx-list"></div>
        </div>
        <div id="smart-check-result"></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="HospitalPortal.runSmartCheck('${patientId}')">🔍 Vérif. intelligente</button>
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
  }

  function addRxItem() {
    const el = document.createElement('div');
    el.className = 'rx-item';
    el.innerHTML = `
      <input type="text" class="rx-name"   placeholder="${t('med_name')}">
      <input type="text" class="rx-dosage" placeholder="Dosage / fréquence">
      <button type="button" class="btn btn-ghost btn-xs" onclick="this.parentElement.remove()">✕</button>`;
    document.getElementById('rx-list').appendChild(el);
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
    const diag = document.getElementById('c-diag').value;
    const meds = [...document.querySelectorAll('.rx-item')]
      .map(el => ({ name: el.querySelector('.rx-name').value, dosage: el.querySelector('.rx-dosage').value }))
      .filter(m => m.name?.trim());
    DB.addConsultation({
      patient_id: patientId,
      date:       document.getElementById('c-date').value,
      doctor:     document.getElementById('c-doc').value,
      reason:     document.getElementById('c-reason').value,
      diagnosis:  diag,
      treatment:  document.getElementById('c-treat').value,
      notes:      document.getElementById('c-notes').value,
    });
    if (meds.length) {
      const rx = DB.addPrescription({ patient_id:patientId, date:document.getElementById('c-date').value, doctor:document.getElementById('c-doc').value, diagnosis:diag, medicines:meds });
      // Send to pharmacy
      Network.sendPrescriptionToPharmacy(rx.pid, 'Pharmacie Centrale');
    }
    App.closeModal(); App.toast(t('msg_saved')); App.navigateTo('consultations');
  }

  function delConsult(cid, patientId) {
    if (!confirm(t('msg_confirm_delete'))) return;
    DB.deleteConsultation(cid); App.toast(t('msg_deleted')); openDetail(patientId);
  }

  /* ── CONSULTATIONS LIST ─────────────────────────── */
  function renderConsultations(main) {
    const list = DB.getConsultations().reverse();
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
    const list = DB.getPrescriptions().reverse();
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
              <button class="btn btn-ghost btn-xs" onclick="Network.sendPrescriptionToPharmacy('${rx.pid}','Pharmacie')">📤 Pharmacie</button>
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
    openConsult, addRxItem, runSmartCheck, saveConsult, delConsult,
    renderConsultations, renderPrescriptions,
  };
})();

const HospitalModule = HospitalPortal;

window.HospitalPortal = HospitalPortal;
window.HospitalModule = HospitalModule;
