/* =====================================================
   MedConnect 2.0 — Rendez-vous / Appointments
   ===================================================== */
const AppointmentsModule = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const STATUS = {
    pending:   { label:'En attente',  color:'#F59E0B', icon:'⏳' },
    confirmed: { label:'Confirmé',    color:'#10B981', icon:'✅' },
    cancelled: { label:'Annulé',      color:'#EF4444', icon:'❌' },
    done:      { label:'Terminé',     color:'#94A3B8', icon:'☑️' },
  };

  function patientName(p) {
    if (!p) return '';
    return `${p.firstname || p.prenom || ''} ${p.lastname || p.nom || ''}`.trim();
  }

  function patientsForContext() {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return DB.getPatients();
    if (user.role === 'patient') {
      const pid = localStorage.getItem('mc_my_patient_id');
      return pid ? DB.getPatients().filter(p => p.id === pid) : [];
    }
    return window.HospitalsRegistry?.getPatientsForContext?.(user.uid) ||
      DB.getPatients().filter(p => !p.created_by || p.created_by === user.uid);
  }

  function appointmentsForContext() {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return DB.getAppointments();
    if (user.role === 'patient') {
      const pid = localStorage.getItem('mc_my_patient_id');
      return DB.getAppointments().filter(a => String(a.patient_id) === String(pid));
    }
    return window.HospitalsRegistry?.getAppointmentsForContext?.(user.uid) ||
      DB.getAppointments().filter(a => {
        const patientIds = new Set(patientsForContext().map(p => p.id));
        return patientIds.has(a.patient_id) || a.created_by === user.uid || a.doctor_uid === user.uid;
      });
  }

  function canUseAppointment(aid) {
    return appointmentsForContext().some(a => a.aid === aid);
  }

  function currentEstablishmentFields() {
    const user = Auth.getUser() || {};
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return {
      created_by: user.uid || '',
      doctor_uid: user.role === 'doctor' ? user.uid : '',
      hospital_id: h?.establishmentId || h?.hid || '',
      establishmentId: h?.establishmentId || h?.hid || '',
      establishmentName: h?.name || '',
    };
  }

  function render(main, filterPatientId) {
    const apts = filterPatientId
      ? DB.getAppointments().filter(a => String(a.patient_id) === String(filterPatientId))
      : appointmentsForContext();
    const today = new Date().toISOString().slice(0,10);
    const upcoming = apts.filter(a => a.date >= today && a.status !== 'cancelled').sort((a,b)=>a.date.localeCompare(b.date));
    const past     = apts.filter(a => a.date < today  || a.status === 'cancelled').sort((a,b)=>b.date.localeCompare(a.date));

    main.innerHTML = `
      <div class="page-header">
        <h2>📅 Rendez-vous</h2>
        <button class="btn btn-primary btn-sm" onclick="AppointmentsModule.openNew()">+ Nouveau RDV</button>
      </div>

      ${upcoming.length ? `
        <h3 style="margin-bottom:.75rem;color:var(--secondary)">🔔 À venir (${upcoming.length})</h3>
        <div class="records-list" style="margin-bottom:1.5rem">
          ${upcoming.map(a => aptCard(a)).join('')}
        </div>` : `<div class="card empty-state"><p>Aucun rendez-vous à venir</p></div>`}

      ${past.length ? `
        <h3 style="margin-bottom:.75rem;color:var(--text-muted)">📁 Passés (${past.length})</h3>
        <div class="records-list">
          ${past.map(a => aptCard(a, true)).join('')}
        </div>` : ''}`;
  }

  function aptCard(a, dim=false) {
    const s  = STATUS[a.status] || STATUS.pending;
    const p  = DB.getPatientById(a.patient_id);
    return `
      <div class="record-card" style="${dim?'opacity:.65':''}">
        <div class="record-header">
          <span style="font-size:1.1rem">${s.icon}</span>
          <span style="color:${s.color};font-weight:600">${s.label}</span>
          <span class="record-date">📅 ${a.date} à ${a.time}</span>
          ${p ? `<span class="id-tag">${p.id}</span><strong>${esc(patientName(p))}</strong>` : ''}
          <span class="record-doctor">👨‍⚕️ ${esc(a.doctor)||'—'}</span>
        </div>
        <p style="font-size:.87rem"><strong>Motif :</strong> ${esc(a.reason)||'—'}</p>
        ${a.notes ? `<p style="font-size:.82rem;color:var(--text-muted)">${esc(a.notes)}</p>` : ''}
        <div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap">
          ${a.status==='pending' ? `
            <button class="btn btn-ghost btn-xs" style="color:var(--secondary)"
              onclick="AppointmentsModule.setStatus('${a.aid}','confirmed')">✅ Confirmer</button>
            <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
              onclick="AppointmentsModule.setStatus('${a.aid}','cancelled')">❌ Annuler</button>` : ''}
          ${a.status==='confirmed' ? `
            <button class="btn btn-ghost btn-xs"
              onclick="AppointmentsModule.setStatus('${a.aid}','done')">☑️ Terminé</button>
            <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
              onclick="AppointmentsModule.setStatus('${a.aid}','cancelled')">❌ Annuler</button>` : ''}
          <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
            onclick="AppointmentsModule.deleteApt('${a.aid}')">🗑️</button>
        </div>
      </div>`;
  }

  function openNew(prefillPatientId) {
    const patients  = patientsForContext();
    const tomorrow  = new Date(Date.now()+86400000).toISOString().slice(0,10);
    App.openModal('📅 Nouveau Rendez-vous', `
      <form onsubmit="AppointmentsModule.save(event)">
        <div class="form-group">
          <label>Patient *</label>
          <select id="apt-pid" required>
            <option value="">— Choisir un patient —</option>
            ${patients.map(p=>`<option value="${p.id}" ${p.id===prefillPatientId?'selected':''}>${esc(patientName(p))} — ${p.id}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Médecin *</label><input type="text" id="apt-doc" required value="${Auth.getUser()?.role==='doctor'?esc(Auth.getUser().name):''}"></div>
        <div class="form-group"><label>Date *</label><input type="date" id="apt-date" required value="${tomorrow}"></div>
        <div class="form-group"><label>Heure *</label><input type="time" id="apt-time" required value="08:00"></div>
        <div class="form-group"><label>Motif *</label><input type="text" id="apt-reason" required placeholder="Consultation, Contrôle…"></div>
        <div class="form-group"><label>Notes</label><textarea id="apt-notes" rows="2"></textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">💾 Enregistrer</button>
        </div>
      </form>`);
  }

  async function save(e) {
    e.preventDefault();
    try {
      // Pré-contrôle client (même pattern que js/hospital.js
      // saveConsult) : le serveur (hospitalCanWriteFromDevice,
      // firestore.rules mc_appointments) bloquera de toute façon en
      // desktop expiré — ceci donne un message clair au lieu d'un
      // refus Firestore brut.
      await CloudDB.requireWritableSubscription('create_appointment');
    } catch (err) {
      App.toast(err.message || 'Abonnement expiré — action bloquée.', 'error');
      return;
    }
    const a = DB.addAppointment({
      patient_id: document.getElementById('apt-pid').value,
      doctor:     document.getElementById('apt-doc').value,
      date:       document.getElementById('apt-date').value,
      time:       document.getElementById('apt-time').value,
      reason:     document.getElementById('apt-reason').value,
      notes:      document.getElementById('apt-notes').value,
      status:     'pending',
      ...currentEstablishmentFields(),
    });
    if (window.Network?.notify) {
      Network.notify({
        to_role:'patient', to_id:a.patient_id,
        type:'appointment',
        subject:`📅 Nouveau RDV le ${a.date} à ${a.time}`,
        body:`Motif : ${a.reason} — Dr. ${a.doctor}`,
      });
    }
    App.closeModal();
    App.toast('✅ Rendez-vous créé');
    if (window.App?.navigateTo) App.navigateTo('appointments');
  }

  function setStatus(aid, status) {
    if (!canUseAppointment(aid)) { App.toast('Accès rendez-vous non autorisé.', 'error'); return; }
    DB.updateAppointment(aid, { status });
    App.toast(`RDV → ${STATUS[status].label}`);
    if (window.App?.navigateTo) App.navigateTo('appointments');
  }

  function deleteApt(aid) {
    if (!canUseAppointment(aid)) { App.toast('Accès rendez-vous non autorisé.', 'error'); return; }
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    DB.deleteAppointment(aid);
    App.toast('🗑️ Supprimé');
    if (window.App?.navigateTo) App.navigateTo('appointments');
  }

  return { render, openNew, save, setStatus, deleteApt };
})();

window.AppointmentsModule = AppointmentsModule;
