/* =====================================================
   MedConnect 2.0 — Patient Portal
   ===================================================== */
const PatientPortal = (() => {
  const t   = k => I18n.t(k);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function getMe() {
    const id = localStorage.getItem('mc_my_patient_id');
    return id ? DB.getPatientById(id) : null;
  }
  function calcAge(dob) {
    if (!dob) return '?';
    return Math.floor((Date.now() - new Date(dob)) / (365.25*24*3600*1000));
  }
  function noRecord() {
    return `<div class="card empty-state">
      <p>⚠️ ${t('msg_no_record')}</p>
      <button class="btn btn-primary" style="margin-top:1rem" onclick="App.navigateTo('my_record')">${t('create_my_record')}</button>
    </div>`;
  }

  /* ── MA FICHE ─────────────────────────────────────── */
  function renderMyRecord(main) {
    const p = getMe();
    main.innerHTML = p ? buildCard(p) : buildCreateForm();
  }

  function buildCreateForm() {
    const yr = new Date().getFullYear();
    return `
      <div class="page-header"><h2>🪪 ${t('create_my_record')}</h2></div>
      <div class="id-preview-box">
        <div class="id-preview-badge" id="id-preview">🔐 MC-${yr}-??-????????</div>
        <small>${t('id_generated')}</small>
      </div>
      <div class="card">
        <form id="pcf" onsubmit="PatientPortal.saveNew(event)">
          <div class="form-grid">
            <div class="form-group"><label>${t('form_firstname')} *</label><input type="text" id="pf-fn" required></div>
            <div class="form-group"><label>${t('form_lastname')} *</label><input type="text" id="pf-ln" required></div>
            <div class="form-group"><label>${t('form_dob')} *</label><input type="date" id="pf-dob" required></div>
            <div class="form-group"><label>${t('form_gender')} *</label>
              <select id="pf-gender" required><option value="">—</option>
                <option value="M">${t('form_male')}</option><option value="F">${t('form_female')}</option>
              </select>
            </div>
            <div class="form-group"><label>${t('form_blood_type')}</label>
              <select id="pf-blood"><option value="">—</option>
                ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g=>`<option>${g}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>${t('form_country')} *</label>
              <select id="pf-country" required onchange="PatientPortal.previewId()">
                <option value="">—</option>
                ${getCountriesList().map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>${t('form_phone')}</label><input type="tel" id="pf-phone"></div>
            <div class="form-group"><label>${t('weight')}</label><input type="number" id="pf-weight" min="1" max="500"></div>
            <div class="form-group"><label>${t('height')}</label><input type="number" id="pf-height" min="30" max="250"></div>
            <div class="form-group full-width"><label>${t('form_address')}</label><input type="text" id="pf-address"></div>
            <div class="form-group full-width"><label>${t('form_allergies')}</label><textarea id="pf-allergies" rows="2"></textarea></div>
            <div class="form-group full-width"><label>${t('form_chronic')}</label><textarea id="pf-chronic" rows="2"></textarea></div>
            <div class="form-group full-width"><label>${t('emergency_contact')}</label><input type="text" id="pf-emergency"></div>
          </div>
          <button type="submit" class="btn btn-primary btn-full">✅ ${t('btn_save')}</button>
        </form>
      </div>`;
  }

  function previewId() {
    const cc = document.getElementById('pf-country')?.value || '??';
    const el = document.getElementById('id-preview');
    if (el) el.textContent = `🔐 MC-${new Date().getFullYear()}-${cc}-????????`;
  }

  function saveNew(e) {
    e.preventDefault();
    const p = DB.addPatient({
      firstname: document.getElementById('pf-fn').value.trim(),
      lastname:  document.getElementById('pf-ln').value.trim(),
      dob:       document.getElementById('pf-dob').value,
      gender:    document.getElementById('pf-gender').value,
      blood_type:document.getElementById('pf-blood').value,
      country_code:document.getElementById('pf-country').value,
      phone:     document.getElementById('pf-phone').value,
      weight:    document.getElementById('pf-weight').value,
      height:    document.getElementById('pf-height').value,
      address:   document.getElementById('pf-address').value,
      allergies: document.getElementById('pf-allergies').value,
      chronic:   document.getElementById('pf-chronic').value,
      emergency: document.getElementById('pf-emergency').value,
    });
    localStorage.setItem('mc_my_patient_id', p.id);
    App.toast(`${t('msg_saved')} — ${p.id}`);
    App.navigateTo('my_record');
  }

  function buildCard(p) {
    const age = calcAge(p.dob);
    const nc  = DB.getPatientConsultations(p.id).length;
    return `
      <div class="page-header">
        <h2>🪪 ${esc(p.firstname)} ${esc(p.lastname)}</h2>
        <div class="header-actions">
          <button class="btn btn-ghost btn-sm" onclick="PatientPortal.printRecord('${p.id}')">${t('btn_print')}</button>
          <button class="btn btn-ghost btn-sm" onclick="PatientPortal.openEdit('${p.id}')">${t('btn_edit')}</button>
        </div>
      </div>
      <div class="id-card-display">
        <div class="id-card-top">
          <div class="id-avatar">${p.gender==='F'?'👩':'👨'}</div>
          <div class="id-info">
            <h3>${esc(p.firstname)} ${esc(p.lastname)}</h3>
            <div class="id-number">${p.id}</div>
            <small style="color:var(--text-muted)">${t('patient_id')}</small>
          </div>
        </div>
        <div class="id-card-chips">
          <span class="chip">🎂 ${age} ${t('years')}</span>
          <span class="chip">🩸 ${p.blood_type||'—'}</span>
          <span class="chip">⚖️ ${p.weight?p.weight+' kg':'—'}</span>
          <span class="chip">📏 ${p.height?p.height+' cm':'—'}</span>
          <span class="chip">📋 ${nc} ${t('stat_consults')}</span>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-card">
          <h4>📋 Informations</h4>
          <table class="info-table">
            <tr><td>${t('form_dob')}</td><td>${p.dob||'—'}</td></tr>
            <tr><td>${t('form_country')}</td><td>${p.country_code||'—'}</td></tr>
            <tr><td>${t('form_phone')}</td><td>${p.phone||'—'}</td></tr>
            <tr><td>${t('form_address')}</td><td>${esc(p.address)||'—'}</td></tr>
            <tr><td>${t('emergency_contact')}</td><td>${esc(p.emergency)||'—'}</td></tr>
          </table>
        </div>
        <div class="info-card">
          <h4>⚕️ Médical</h4>
          <table class="info-table">
            <tr><td>${t('form_allergies')}</td><td>${esc(p.allergies)||'—'}</td></tr>
            <tr><td>${t('form_chronic')}</td><td>${esc(p.chronic)||'—'}</td></tr>
            <tr><td>${t('form_blood_type')}</td><td>${p.blood_type||'—'}</td></tr>
          </table>
        </div>
      </div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-top:.5rem">
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('timeline')">🗓️ Timeline médicale</button>
        <button class="btn btn-ghost btn-sm" onclick="App.navigateTo('appointments')">📅 Rendez-vous</button>
        <button class="btn btn-ghost btn-sm" onclick="ShareModule.sharePatient('${p.id}')">📤 ${t('btn_share')}</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="PatientPortal.resetRecord()">🔄 Réinitialiser</button>
      </div>`;
  }

  /* ── EDIT ─────────────────────────────────────────── */
  function openEdit(id) {
    const p = DB.getPatientById(id); if (!p) return;
    App.openModal(`✏️ ${t('btn_edit')} — ${p.id}`, `
      <form onsubmit="PatientPortal.saveEdit(event,'${id}')">
        <div class="form-grid">
          <div class="form-group"><label>${t('form_firstname')}</label><input type="text" id="ep-fn" value="${esc(p.firstname)}"></div>
          <div class="form-group"><label>${t('form_lastname')}</label><input type="text" id="ep-ln" value="${esc(p.lastname)}"></div>
          <div class="form-group"><label>${t('form_dob')}</label><input type="date" id="ep-dob" value="${p.dob||''}"></div>
          <div class="form-group"><label>${t('form_gender')}</label>
            <select id="ep-gender"><option value="">—</option>
              <option value="M" ${p.gender==='M'?'selected':''}>${t('form_male')}</option>
              <option value="F" ${p.gender==='F'?'selected':''}>${t('form_female')}</option>
            </select>
          </div>
          <div class="form-group"><label>${t('form_blood_type')}</label>
            <select id="ep-blood"><option value="">—</option>
              ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g=>`<option ${p.blood_type===g?'selected':''}>${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>${t('form_phone')}</label><input type="tel" id="ep-phone" value="${esc(p.phone)}"></div>
          <div class="form-group"><label>${t('weight')}</label><input type="number" id="ep-weight" value="${p.weight||''}"></div>
          <div class="form-group"><label>${t('height')}</label><input type="number" id="ep-height" value="${p.height||''}"></div>
          <div class="form-group full-width"><label>${t('form_allergies')}</label><textarea id="ep-allergies" rows="2">${esc(p.allergies)}</textarea></div>
          <div class="form-group full-width"><label>${t('form_chronic')}</label><textarea id="ep-chronic" rows="2">${esc(p.chronic)}</textarea></div>
          <div class="form-group full-width"><label>${t('emergency_contact')}</label><input type="text" id="ep-emergency" value="${esc(p.emergency)}"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">${t('btn_cancel')}</button>
          <button type="submit" class="btn btn-primary">${t('btn_save')}</button>
        </div>
      </form>`);
  }

  function saveEdit(e, id) {
    e.preventDefault();
    DB.updatePatient(id, {
      firstname: document.getElementById('ep-fn').value.trim(),
      lastname:  document.getElementById('ep-ln').value.trim(),
      dob:       document.getElementById('ep-dob').value,
      gender:    document.getElementById('ep-gender').value,
      blood_type:document.getElementById('ep-blood').value,
      phone:     document.getElementById('ep-phone').value,
      weight:    document.getElementById('ep-weight').value,
      height:    document.getElementById('ep-height').value,
      allergies: document.getElementById('ep-allergies').value,
      chronic:   document.getElementById('ep-chronic').value,
      emergency: document.getElementById('ep-emergency').value,
    });
    App.closeModal(); App.toast(t('msg_saved')); App.navigateTo('my_record');
  }

  function resetRecord() {
    if (!confirm('Détacher ce compte ?')) return;
    localStorage.removeItem('mc_my_patient_id');
    App.navigateTo('my_record');
  }

  /* ── HISTORY ──────────────────────────────────────── */
  function renderHistory(main) {
    const p = getMe(); if (!p) { main.innerHTML = noRecord(); return; }
    const list = DB.getPatientConsultations(p.id);
    main.innerHTML = `
      <div class="page-header"><h2>📋 ${t('nav_history')}</h2></div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(c => `
          <div class="record-card">
            <div class="record-header">
              <span class="record-date">📅 ${c.date}</span>
              <span class="record-doctor">👨‍⚕️ ${esc(c.doctor)||'—'}</span>
            </div>
            <p><strong>${t('consult_diagnosis')} :</strong> ${esc(c.diagnosis)}</p>
            ${c.treatment?`<p><strong>${t('consult_treatment')} :</strong> ${esc(c.treatment)}</p>`:''}
            ${c.notes?`<p><em>${esc(c.notes)}</em></p>`:''}
          </div>`).join('')}
      </div>`;
  }

  /* ── PRESCRIPTIONS ────────────────────────────────── */
  function renderPrescriptions(main) {
    const p = getMe(); if (!p) { main.innerHTML = noRecord(); return; }
    const list = DB.getPatientPrescriptions(p.id);
    main.innerHTML = `
      <div class="page-header"><h2>💊 ${t('nav_prescriptions')}</h2></div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(rx => `
          <div class="record-card presc-card">
            <div class="record-header">
              <span class="record-date">📅 ${rx.date}</span>
              <span class="record-doctor">👨‍⚕️ ${esc(rx.doctor)||'—'}</span>
              <button class="btn btn-ghost btn-xs" onclick="PatientPortal.printRx('${rx.pid}')">${t('btn_print')}</button>
            </div>
            <p><strong>${t('consult_diagnosis')} :</strong> ${esc(rx.diagnosis)}</p>
            <ul style="padding-left:1.2rem;margin-top:.4rem">
              ${(rx.medicines||[]).map(m=>`<li>💊 ${esc(m.name)} — ${esc(m.dosage)}</li>`).join('')}
            </ul>
          </div>`).join('')}
      </div>`;
  }

  /* ── VACCINATIONS ─────────────────────────────────── */
  function renderVaccinations(main) {
    const p = getMe(); if (!p) { main.innerHTML = noRecord(); return; }
    const list = DB.getPatientVaccinations(p.id);
    const user = Auth.getUser();
    main.innerHTML = `
      <div class="page-header">
        <h2>💉 Vaccinations</h2>
        ${user?.role==='nurse'||user?.role==='doctor' ? `<button class="btn btn-primary btn-sm" onclick="PatientPortal.openAddVacc('${p.id}')">+ Ajouter</button>` : ''}
      </div>
      ${!list.length ? `<div class="card empty-state"><p>${t('no_data')}</p></div>` : ''}
      <div class="records-list">
        ${list.map(v=>`
          <div class="record-card">
            <div class="record-header">
              <span>💉</span><strong>${esc(v.vaccine)}</strong>
              <span class="record-date">📅 ${v.date}</span>
              <span class="chip">Dose ${v.dose}</span>
              ${v.next_date ? `<span class="chip" style="color:var(--accent)">Prochain : ${v.next_date}</span>` : ''}
            </div>
            <p style="font-size:.84rem;color:var(--text-muted)">Dr. ${esc(v.doctor)||'—'} ${v.notes?'· '+esc(v.notes):''}</p>
          </div>`).join('')}
      </div>`;
  }

  function openAddVacc(patientId) {
    App.openModal('💉 Ajouter Vaccination', `
      <form onsubmit="PatientPortal.saveVacc(event,'${patientId}')">
        <div class="form-group"><label>Vaccin *</label><input type="text" id="v-vax" required placeholder="BCG, Polio, COVID-19…"></div>
        <div class="form-group"><label>Date *</label><input type="date" id="v-date" value="${new Date().toISOString().slice(0,10)}" required></div>
        <div class="form-group"><label>Dose</label><input type="text" id="v-dose" placeholder="1, 2, Rappel…" value="1"></div>
        <div class="form-group"><label>Médecin</label><input type="text" id="v-doc" value="${Auth.getUser()?.name||''}"></div>
        <div class="form-group"><label>Prochain rappel</label><input type="date" id="v-next"></div>
        <div class="form-group"><label>Notes</label><textarea id="v-notes" rows="2"></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">💾 Enregistrer</button>
        </div>
      </form>`);
  }

  function saveVacc(e, patientId) {
    e.preventDefault();
    DB.addVaccination({
      patient_id: patientId,
      vaccine:    document.getElementById('v-vax').value,
      date:       document.getElementById('v-date').value,
      dose:       document.getElementById('v-dose').value||'1',
      doctor:     document.getElementById('v-doc').value,
      next_date:  document.getElementById('v-next').value,
      notes:      document.getElementById('v-notes').value,
    });
    App.closeModal(); App.toast('✅ Vaccination enregistrée'); App.navigateTo('vaccinations');
  }

  /* ── PRINT ────────────────────────────────────────── */
  function printRecord(id) {
    const p = DB.getPatientById(id); if (!p) return;
    const age  = calcAge(p.dob);
    const list = DB.getPatientConsultations(id);
    const w    = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Fiche Patient</title>
      <style>body{font-family:Arial,sans-serif;max-width:800px;margin:auto;padding:20px}h1{color:#0EA5E9}
      .id{font-family:monospace;background:#e0f2fe;padding:8px 14px;border-radius:6px;display:inline-block;letter-spacing:1px;margin:6px 0}
      table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border:1px solid #cbd5e1;padding:8px;font-size:.88em}th{background:#f0f9ff}
      .evt{border:1px solid #e2e8f0;border-radius:6px;padding:8px;margin:6px 0;background:#f8fafc}</style></head><body>
      <h1>🏥 MedConnect — Fiche Médicale</h1>
      <p class="id">${p.id}</p>
      <h2>${p.firstname} ${p.lastname} · ${p.gender==='F'?'♀':'♂'} · ${age} ${t('years')}</h2>
      <table>
        <tr><th>Naissance</th><td>${p.dob||'—'}</td><th>Groupe sanguin</th><td>${p.blood_type||'—'}</td></tr>
        <tr><th>Pays</th><td>${p.country_code||'—'}</td><th>Téléphone</th><td>${p.phone||'—'}</td></tr>
        <tr><th>Poids</th><td>${p.weight?p.weight+' kg':'—'}</td><th>Taille</th><td>${p.height?p.height+' cm':'—'}</td></tr>
        <tr><th>Allergies</th><td colspan="3">${p.allergies||'—'}</td></tr>
        <tr><th>Maladies chroniques</th><td colspan="3">${p.chronic||'—'}</td></tr>
        <tr><th>Urgence</th><td colspan="3">${p.emergency||'—'}</td></tr>
      </table>
      <h3>Consultations (${list.length})</h3>
      ${list.map(c=>`<div class="evt"><strong>${c.date}</strong> — Dr. ${c.doctor||'?'}<br>${t('consult_diagnosis')}: ${c.diagnosis}<br>${c.treatment?t('consult_treatment')+': '+c.treatment:''}</div>`).join('')||'<p>Aucune.</p>'}
      <p style="text-align:center;color:#94a3b8;margin-top:2rem;font-size:.8em">MedConnect v2.0 — ${new Date().toLocaleDateString()}</p>
      </body></html>`);
    w.print();
  }

  function printRx(pid) {
    const rx = DB.getPrescriptions().find(x=>x.pid===pid); if (!rx) return;
    const user = Auth.getUser();
    const myPatientId = localStorage.getItem('mc_my_patient_id');
    if (user?.role === 'patient' && String(rx.patient_id) !== String(myPatientId)) {
      App.toast('Accès ordonnance non autorisé.', 'error');
      return;
    }
    if (user?.role !== 'patient' && user?.role !== 'admin' && !ACL.canAccessPatient(user, rx.patient_id)) {
      App.toast('Accès ordonnance non autorisé.', 'error');
      return;
    }
    const p  = DB.getPatientById(rx.patient_id);
    const w  = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ordonnance</title>
      <style>body{font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px}h1{color:#0EA5E9}
      .id{font-family:monospace;background:#e0f2fe;padding:3px 8px;border-radius:4px}li{margin:.3rem 0}</style></head><body>
      <h1>💊 Ordonnance — MedConnect</h1>
      ${p?`<p><strong>Patient :</strong> ${p.firstname} ${p.lastname} <span class="id">${p.id}</span></p>`:''}
      <p><strong>Date :</strong> ${rx.date} · <strong>Dr :</strong> ${rx.doctor||'—'}</p>
      <p><strong>Diagnostic :</strong> ${rx.diagnosis}</p>
      <h3>Médicaments</h3><ul>
      ${(rx.medicines||[]).map(m=>`<li>💊 <strong>${m.name}</strong> — ${m.dosage}</li>`).join('')}
      </ul><p style="color:#94a3b8;font-size:.8em;margin-top:2rem">MedConnect v2.0</p>
      </body></html>`);
    w.print();
  }

  /* ── COUNTRIES ────────────────────────────────────── */
  function getCountriesList() {
    return [
      {code:'AF',flag:'🇦🇫',name:'Afghanistan'},{code:'AL',flag:'🇦🇱',name:'Albania'},{code:'DZ',flag:'🇩🇿',name:'Algeria'},
      {code:'AO',flag:'🇦🇴',name:'Angola'},{code:'AR',flag:'🇦🇷',name:'Argentina'},{code:'AU',flag:'🇦🇺',name:'Australia'},
      {code:'AT',flag:'🇦🇹',name:'Austria'},{code:'BD',flag:'🇧🇩',name:'Bangladesh'},{code:'BE',flag:'🇧🇪',name:'Belgium'},
      {code:'BJ',flag:'🇧🇯',name:'Benin'},{code:'BO',flag:'🇧🇴',name:'Bolivia'},{code:'BR',flag:'🇧🇷',name:'Brazil'},
      {code:'BF',flag:'🇧🇫',name:'Burkina Faso'},{code:'BI',flag:'🇧🇮',name:'Burundi'},{code:'KH',flag:'🇰🇭',name:'Cambodia'},
      {code:'CM',flag:'🇨🇲',name:'Cameroon'},{code:'CA',flag:'🇨🇦',name:'Canada'},{code:'CF',flag:'🇨🇫',name:'Centrafrique'},
      {code:'TD',flag:'🇹🇩',name:'Chad'},{code:'CL',flag:'🇨🇱',name:'Chile'},{code:'CN',flag:'🇨🇳',name:'China'},
      {code:'CO',flag:'🇨🇴',name:'Colombia'},{code:'CD',flag:'🇨🇩',name:'Congo (DRC)'},{code:'CG',flag:'🇨🇬',name:'Congo (Rep.)'},
      {code:'CI',flag:'🇨🇮',name:"Côte d'Ivoire"},{code:'HR',flag:'🇭🇷',name:'Croatia'},{code:'CU',flag:'🇨🇺',name:'Cuba'},
      {code:'DK',flag:'🇩🇰',name:'Denmark'},{code:'DJ',flag:'🇩🇯',name:'Djibouti'},{code:'DO',flag:'🇩🇴',name:'Dominican Rep.'},
      {code:'EC',flag:'🇪🇨',name:'Ecuador'},{code:'EG',flag:'🇪🇬',name:'Egypt'},{code:'ER',flag:'🇪🇷',name:'Eritrea'},
      {code:'ET',flag:'🇪🇹',name:'Ethiopia'},{code:'FI',flag:'🇫🇮',name:'Finland'},{code:'FR',flag:'🇫🇷',name:'France'},
      {code:'GA',flag:'🇬🇦',name:'Gabon'},{code:'GM',flag:'🇬🇲',name:'Gambia'},{code:'DE',flag:'🇩🇪',name:'Germany'},
      {code:'GH',flag:'🇬🇭',name:'Ghana'},{code:'GR',flag:'🇬🇷',name:'Greece'},{code:'GT',flag:'🇬🇹',name:'Guatemala'},
      {code:'GN',flag:'🇬🇳',name:'Guinea'},{code:'GW',flag:'🇬🇼',name:'Guinea-Bissau'},{code:'HT',flag:'🇭🇹',name:'Haiti'},
      {code:'HN',flag:'🇭🇳',name:'Honduras'},{code:'HU',flag:'🇭🇺',name:'Hungary'},{code:'IN',flag:'🇮🇳',name:'India'},
      {code:'ID',flag:'🇮🇩',name:'Indonesia'},{code:'IR',flag:'🇮🇷',name:'Iran'},{code:'IQ',flag:'🇮🇶',name:'Iraq'},
      {code:'IE',flag:'🇮🇪',name:'Ireland'},{code:'IL',flag:'🇮🇱',name:'Israel'},{code:'IT',flag:'🇮🇹',name:'Italy'},
      {code:'JP',flag:'🇯🇵',name:'Japan'},{code:'JO',flag:'🇯🇴',name:'Jordan'},{code:'KZ',flag:'🇰🇿',name:'Kazakhstan'},
      {code:'KE',flag:'🇰🇪',name:'Kenya'},{code:'KR',flag:'🇰🇷',name:'Korea (South)'},{code:'LA',flag:'🇱🇦',name:'Laos'},
      {code:'LB',flag:'🇱🇧',name:'Lebanon'},{code:'LR',flag:'🇱🇷',name:'Liberia'},{code:'LY',flag:'🇱🇾',name:'Libya'},
      {code:'MG',flag:'🇲🇬',name:'Madagascar'},{code:'MW',flag:'🇲🇼',name:'Malawi'},{code:'MY',flag:'🇲🇾',name:'Malaysia'},
      {code:'ML',flag:'🇲🇱',name:'Mali'},{code:'MR',flag:'🇲🇷',name:'Mauritania'},{code:'MX',flag:'🇲🇽',name:'Mexico'},
      {code:'MA',flag:'🇲🇦',name:'Morocco'},{code:'MZ',flag:'🇲🇿',name:'Mozambique'},{code:'MM',flag:'🇲🇲',name:'Myanmar'},
      {code:'NA',flag:'🇳🇦',name:'Namibia'},{code:'NP',flag:'🇳🇵',name:'Nepal'},{code:'NL',flag:'🇳🇱',name:'Netherlands'},
      {code:'NZ',flag:'🇳🇿',name:'New Zealand'},{code:'NE',flag:'🇳🇪',name:'Niger'},{code:'NG',flag:'🇳🇬',name:'Nigeria'},
      {code:'NO',flag:'🇳🇴',name:'Norway'},{code:'PK',flag:'🇵🇰',name:'Pakistan'},{code:'PE',flag:'🇵🇪',name:'Peru'},
      {code:'PH',flag:'🇵🇭',name:'Philippines'},{code:'PL',flag:'🇵🇱',name:'Poland'},{code:'PT',flag:'🇵🇹',name:'Portugal'},
      {code:'QA',flag:'🇶🇦',name:'Qatar'},{code:'RO',flag:'🇷🇴',name:'Romania'},{code:'RU',flag:'🇷🇺',name:'Russia'},
      {code:'RW',flag:'🇷🇼',name:'Rwanda'},{code:'SA',flag:'🇸🇦',name:'Saudi Arabia'},{code:'SN',flag:'🇸🇳',name:'Senegal'},
      {code:'SL',flag:'🇸🇱',name:'Sierra Leone'},{code:'SO',flag:'🇸🇴',name:'Somalia'},{code:'ZA',flag:'🇿🇦',name:'South Africa'},
      {code:'SS',flag:'🇸🇸',name:'South Sudan'},{code:'ES',flag:'🇪🇸',name:'Spain'},{code:'LK',flag:'🇱🇰',name:'Sri Lanka'},
      {code:'SD',flag:'🇸🇩',name:'Sudan'},{code:'SE',flag:'🇸🇪',name:'Sweden'},{code:'CH',flag:'🇨🇭',name:'Switzerland'},
      {code:'SY',flag:'🇸🇾',name:'Syria'},{code:'TZ',flag:'🇹🇿',name:'Tanzania'},{code:'TH',flag:'🇹🇭',name:'Thailand'},
      {code:'TG',flag:'🇹🇬',name:'Togo'},{code:'TN',flag:'🇹🇳',name:'Tunisia'},{code:'TR',flag:'🇹🇷',name:'Turkey'},
      {code:'UG',flag:'🇺🇬',name:'Uganda'},{code:'UA',flag:'🇺🇦',name:'Ukraine'},{code:'AE',flag:'🇦🇪',name:'UAE'},
      {code:'GB',flag:'🇬🇧',name:'United Kingdom'},{code:'US',flag:'🇺🇸',name:'United States'},
      {code:'VE',flag:'🇻🇪',name:'Venezuela'},{code:'VN',flag:'🇻🇳',name:'Vietnam'},{code:'YE',flag:'🇾🇪',name:'Yemen'},
      {code:'ZM',flag:'🇿🇲',name:'Zambia'},{code:'ZW',flag:'🇿🇼',name:'Zimbabwe'},
    ];
  }

  return {
    renderMyRecord, previewId, saveNew, openEdit, saveEdit, resetRecord,
    renderHistory, renderPrescriptions, renderVaccinations, openAddVacc, saveVacc,
    printRecord, printRx, getCountriesList,
  };
})();

const PatientModule = PatientPortal;

window.PatientPortal = PatientPortal;
window.PatientModule = PatientModule;
