/* =====================================================
   MedConnect 2.0 — Timeline Médicale
   Vue chronologique complète du parcours patient
   ===================================================== */
const Timeline = (() => {
  const t   = k => I18n.t(k);
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const TYPE_META = {
    consultation: { icon:'🩺', label:'Consultation',        color:'var(--primary)' },
    prescription: { icon:'💊', label:'Ordonnance',           color:'var(--secondary)' },
    lab:          { icon:'🧪', label:'Analyse laboratoire',  color:'#F59E0B' },
    vaccination:  { icon:'💉', label:'Vaccination',          color:'#A855F7' },
    appointment:  { icon:'📅', label:'Rendez-vous',          color:'#06B6D4' },
    // 'document' sert UNIQUEMENT de repli de rendu (renderEvents :
    // TYPE_META[ev.type] || TYPE_META.document) ; ce n'est pas un filtre.
    // buildEvents() ne produit jamais d'événement de type 'document' :
    // la seule source (establishment_documents) ne contient que des
    // copies d'audit de consultations/ordonnances déjà affichées sous
    // leur propre type — l'afficher en filtre était décoratif (jamais
    // alimenté) et créerait des doublons s'il l'était. Exclu des chips.
    document:     { icon:'📄', label:'Document',             color:'var(--text-muted)' },
    admission:    { icon:'🏥', label:'Hospitalisation',      color:'var(--danger)' },
    emergency:    { icon:'🚑', label:'Urgences',             color:'var(--danger)' },
    maternity:    { icon:'🤰', label:'Maternité',            color:'#EC4899' },
  };

  function render(main, patientId) {
    const events = buildEvents(patientId);
    main.innerHTML = `
      <div class="page-header">
        <h2>🗓️ Timeline Médicale</h2>
        <div class="header-actions">
          ${Object.entries(TYPE_META).filter(([k]) => k !== 'document').map(([k,v])=>`
            <button class="chip-filter active" data-type="${k}"
              onclick="Timeline.toggleFilter(this,'${k}','${patientId}')"
              style="border-color:${v.color};color:${v.color}">
              ${v.icon} ${v.label}
            </button>`).join('')}
        </div>
      </div>
      <div id="timeline-body">
        ${renderEvents(events)}
      </div>`;
  }

  function buildEvents(patientId) {
    const events = [];

    DB.getPatientConsultations(patientId).forEach(c => events.push({
      type:'consultation', date:c.date, id:c.cid,
      title: c.diagnosis || 'Consultation',
      sub:   `Dr. ${esc(c.doctor)||'—'} · ${esc(c.treatment)||''}`,
    }));

    DB.getPatientPrescriptions(patientId).forEach(p => events.push({
      type:'prescription', date:p.date, id:p.pid,
      title:`Ordonnance — ${(p.medicines||[]).length} médicament(s)`,
      sub:  esc(p.diagnosis),
    }));

    DB.getPatientLabResults(patientId).forEach(l => events.push({
      type:'lab', date:l.date, id:l.lid,
      title:esc(l.type)||'Analyse',
      sub:  esc(l.notes)||'',
    }));

    DB.getPatientVaccinations(patientId).forEach(v => events.push({
      type:'vaccination', date:v.date, id:v.vid,
      title:esc(v.vaccine),
      sub:  `Dose ${v.dose} · Dr. ${esc(v.doctor)||'—'}`,
    }));

    DB.getAppointments().filter(a => a.patient_id===patientId || String(a.patientId)===String(patientId)).forEach(a => events.push({
      type:'appointment', date:a.date, id:a.aid || a.id,
      title:esc(a.reason || a.motif)||'Rendez-vous',
      sub:  `${a.time || a.heure || ''} · Dr. ${esc(a.doctor || a.docteur)||'—'} · ${a.status || a.statut || ''}`,
    }));

    (DB.getPatientAdmissions?.(patientId) || []).forEach(a => events.push({
      type:'admission', date:(a.admittedAt || a.date || '').slice(0,10), id:a.aid,
      title:'Hospitalisation',
      sub:  `${a.ward ? 'Service ' + esc(a.ward) + ' · ' : ''}${esc(a.reason)||''}${a.status === 'discharged' ? ' · Sortie' : ''}`,
    }));

    (DB.getPatientEmergencyCases?.(patientId) || []).forEach(e => events.push({
      type:'emergency', date:(e.arrivedAt || e.date || '').slice(0,10), id:e.eid,
      title:'Passage aux urgences',
      sub:  esc(e.complaint)||'',
    }));

    (DB.getPatientMaternityCases?.(patientId) || []).forEach(m => events.push({
      type:'maternity', date:(m.openedAt || m.date || '').slice(0,10), id:m.mid,
      title:'Dossier de grossesse',
      sub:  `DPA : ${esc(m.dueDate)||'—'}`,
    }));

    return events.filter(ev => ev.date).sort((a,b) => b.date.localeCompare(a.date));
  }

  function renderEvents(events) {
    if (!events.length) return `<div class="card empty-state"><p>${t('no_data')}</p></div>`;
    let lastYear = '';
    return `<div class="timeline">` + events.map(ev => {
      const m = TYPE_META[ev.type] || TYPE_META.document;
      const yr = ev.date.slice(0,4);
      const yearBadge = yr !== lastYear ? ((lastYear=yr), `<div class="tl-year">${yr}</div>`) : '';
      return `${yearBadge}
        <div class="tl-item" data-type="${ev.type}">
          <div class="tl-dot" style="background:${m.color}"></div>
          <div class="tl-connector"></div>
          <div class="tl-content">
            <div class="tl-header">
              <span class="tl-icon">${m.icon}</span>
              <span class="tl-type" style="color:${m.color}">${m.label}</span>
              <span class="tl-date">📅 ${ev.date}</span>
            </div>
            <p class="tl-title"><strong>${ev.title}</strong></p>
            ${ev.sub ? `<p class="tl-sub">${ev.sub}</p>` : ''}
          </div>
        </div>`;
    }).join('') + `</div>`;
  }

  function toggleFilter(btn, type, patientId) {
    btn.classList.toggle('active');
    const hidden = [...document.querySelectorAll('.chip-filter')]
      .filter(b => !b.classList.contains('active'))
      .map(b => b.dataset.type);
    document.querySelectorAll('.tl-item').forEach(el => {
      el.style.display = hidden.includes(el.dataset.type) ? 'none' : '';
    });
  }

  return { render, buildEvents, toggleFilter };
})();

window.Timeline = Timeline;
