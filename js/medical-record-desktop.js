/* =====================================================
   MedConnect 2.0 — MedicalRecordDesktop
   Dossier médical électronique (DME) — vue desktop hôpital.

   Volet gauche : liste des patients de l'établissement actif
   (recherche incluse). Volet droit : dossier complet à onglets
   (Résumé / Historique / Consultations / Ordonnances /
   Laboratoire / Imagerie / Documents / Historique des accès).

   PRINCIPES DE SÉCURITÉ (ne pas affaiblir) :
   - Toujours scopé à HospitalsRegistry.getCurrentHospital() —
     jamais de repli sur "tous les patients", y compris pour le
     rôle admin : cet écran vit DANS un établissement précis.
   - Les onglets visibles dépendent strictement du rôle vérifié
     via HospitalCapabilities.visibleRecordSections(role) — même
     matrice explicite que le reste du desktop hôpital.
   - Aucune donnée clinique (allergies, historique, labo...) pour
     un rôle non clinique (réception) : seul un résumé administratif
     est montré, jamais les données médicales elles-mêmes.

   PERFORMANCE : seule la liste des patients (identité) est
   chargée au départ. Le dossier complet (consultations,
   ordonnances, labo, documents, historique des accès) n'est
   chargé qu'au clic sur un patient, et mis en cache pour la
   session en cours pour éviter de le recharger à chaque
   changement d'onglet.
   ===================================================== */
const MedicalRecordDesktop = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const TAB_LABELS = {
    summary:      '🪪 Résumé',
    history:      '🗓️ Historique',
    consultations:'🩺 Consultations',
    prescriptions:'💊 Ordonnances',
    lab:          '🧪 Laboratoire',
    imaging:      '🩻 Imagerie',
    documents:    '📄 Documents',
    access_log:   '🔒 Historique des accès',
  };

  let _query = '';
  let _activeId = null;
  let _activeTab = null;
  let _filters = { doctor: '', from: '', to: '', diagnosis: '', status: '' };
  const _recordCache = {}; // patientId -> assembled record (dure le temps de la session desktop)

  function currentHospital() { return window.HospitalsRegistry?.getCurrentHospital?.() || null; }
  function currentRole()     { return window.HospitalPermissions?.getCurrentRole?.() || ''; }

  function calcAge(dob) {
    if (!dob) return '?';
    const age = Math.floor((Date.now() - new Date(dob)) / (365.25*24*3600*1000));
    return Number.isFinite(age) ? age : '?';
  }

  /* ── Entrée de la route ─────────────────────────── */
  function render(container) {
    const hospital = currentHospital();
    if (!hospital) {
      container.innerHTML = `
        <div class="hospital-page-header"><div><h1>📁 Dossiers médicaux</h1></div></div>
        <div class="card empty-state"><p>Veuillez sélectionner un établissement.</p></div>`;
      return;
    }

    const role = currentRole();
    const sections = HospitalCapabilities.visibleRecordSections(role);
    if (!sections.length) {
      container.innerHTML = `
        <div class="hospital-page-header"><div><h1>📁 Dossiers médicaux</h1></div></div>
        <div class="card empty-state"><p>Votre rôle ne permet pas de consulter les dossiers médicaux.</p></div>`;
      return;
    }

    _query = ''; _activeId = null; _activeTab = sections[0];

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>📁 Dossiers médicaux</h1><p>${esc(hospital.name || '')} — dossiers de cet établissement uniquement</p></div>
      </div>
      <div class="mrd-layout">
        <div class="mrd-list-pane">
          <input type="search" class="inp" id="mrd-search" placeholder="🔎 Nom, téléphone, n° dossier…"
            oninput="MedicalRecordDesktop.filter(this.value)">
          <div class="mrd-list" id="mrd-patient-list"></div>
        </div>
        <div class="mrd-detail-pane" id="mrd-detail">
          <div class="card empty-state"><p>Sélectionnez un patient pour ouvrir son dossier.</p></div>
        </div>
      </div>`;
    renderPatientList();
  }

  /* ── Liste patients (stricte à l'établissement actif) ── */
  function establishmentPatients() {
    const hospital = currentHospital();
    if (!hospital) return [];
    return window.HospitalsRegistry?.getPatientsForEstablishment?.(hospital.establishmentId) || [];
  }

  function patientsForList() {
    const list = establishmentPatients();
    if (!_query) return list;
    const q = _query.toLowerCase();
    return list.filter(p =>
      (p.id||'').toLowerCase().includes(q) ||
      (p.firstname||'').toLowerCase().includes(q) ||
      (p.lastname||'').toLowerCase().includes(q) ||
      (p.phone||'').includes(q));
  }

  function filter(q) { _query = q || ''; renderPatientList(); }

  function renderPatientList() {
    const box = document.getElementById('mrd-patient-list');
    if (!box) return;
    const list = patientsForList();
    box.innerHTML = !list.length
      ? `<div class="card empty-state"><p>Aucun patient trouvé.</p></div>`
      : list.map(p => `
        <div class="record-card patient-row mrd-patient-row${p.id===_activeId?' active':''}" onclick="MedicalRecordDesktop.open('${esc(p.id)}')">
          <div class="patient-row-avatar">${p.gender==='F' ? '👩' : p.gender==='M' ? '👨' : '🧑'}</div>
          <div class="patient-row-info">
            <strong>${esc(p.firstname||'')} ${esc(p.lastname||'')}</strong>
            <span class="id-tag">${esc(p.id||'')}</span>
            <br><small class="muted">${calcAge(p.dob)} ans${p.blood_type ? ' · '+esc(p.blood_type) : ''}</small>
          </div>
        </div>`).join('');
  }

  /* ── Ouverture d'un dossier ─────────────────────── */
  async function open(patientId) {
    _activeId = patientId;
    _filters = { doctor:'', from:'', to:'', diagnosis:'', status:'' };
    renderPatientList(); // ré-affiche la liste pour surligner la ligne active (_activeId déjà à jour)

    const detail = document.getElementById('mrd-detail');
    if (!detail) return;
    detail.innerHTML = `<div class="card empty-state"><p>⏳ Chargement du dossier…</p></div>`;

    if (!_recordCache[patientId]) _recordCache[patientId] = loadRecord(patientId);
    const record = _recordCache[patientId];
    if (!record.patient) {
      detail.innerHTML = `<div class="card empty-state"><p>Dossier introuvable.</p></div>`;
      return;
    }

    const sections = HospitalCapabilities.visibleRecordSections(currentRole());
    _activeTab = sections[0] || 'summary';
    renderDetail();

    // Traçabilité de la consultation du dossier — best effort, ne
    // bloque jamais l'affichage (cf. CloudDB.createAuditLog déjà
    // utilisé partout ailleurs dans le desktop hôpital).
    try {
      const hospital = currentHospital();
      await CloudDB.createAuditLog('record_viewed', 'patient', patientId, {
        establishmentId: hospital?.establishmentId,
        patientCode: patientId,
      });
    } catch (_) {}
  }

  /* Rassemble tout ce qui est déjà en mémoire locale (rapide,
     synchrone) pour CE patient uniquement — jamais pour toute la
     liste. Le journal d'accès (Firestore) reste chargé à part,
     seulement si l'onglet correspondant est ouvert. */
  function loadRecord(pid) {
    return {
      patient:       DB.getPatientById(pid),
      consultations: DB.getPatientConsultations(pid),
      prescriptions: DB.getPatientPrescriptions(pid),
      labs:          DB.getPatientLabResults(pid),
      vaccinations:  DB.getPatientVaccinations(pid),
      appointments:  DB.getPatientAppointments(pid),
      documents:     DB.getPatientEstablishmentDocuments(pid).filter(d => d.documentType !== 'imaging'),
      imaging:       DB.getPatientEstablishmentDocuments(pid, 'imaging'),
      admissions:    null, // chargé à la demande (Firestore, cf. renderHistory)
      accessLog:     null, // chargé à la demande (Firestore, cf. renderAccessLog)
    };
  }

  function switchTab(key) { _activeTab = key; renderDetail(); }

  function setFilter(key, value) {
    _filters[key] = value;
    renderTabContent();
  }

  /* ── Rendu du volet droit ───────────────────────── */
  function renderDetail() {
    const detail = document.getElementById('mrd-detail');
    const record = _recordCache[_activeId];
    if (!detail || !record?.patient) return;
    const role = currentRole();
    const sections = HospitalCapabilities.visibleRecordSections(role);
    const p = record.patient;

    detail.innerHTML = `
      <div class="mrd-detail-header">
        <div class="mrd-avatar">${p.gender==='F' ? '👩' : p.gender==='M' ? '👨' : '🧑'}</div>
        <div>
          <strong style="font-size:1.05rem">${esc(p.firstname||'')} ${esc(p.lastname||'')}</strong>
          <span class="id-tag">${esc(p.id||'')}</span>
          <br><small class="muted">${calcAge(p.dob)} ans · ${esc(p.gender==='F'?'Féminin':p.gender==='M'?'Masculin':'—')}</small>
        </div>
      </div>
      <div class="mrd-tabs">
        ${sections.map(s => `<button class="mrd-tab${s===_activeTab?' active':''}" onclick="MedicalRecordDesktop.switchTab('${s}')">${TAB_LABELS[s]||s}</button>`).join('')}
      </div>
      <div class="mrd-tab-content" id="mrd-tab-content"></div>`;
    renderTabContent();
  }

  function renderTabContent() {
    const container = document.getElementById('mrd-tab-content');
    const record = _recordCache[_activeId];
    if (!container || !record) return;
    const role = currentRole();

    switch (_activeTab) {
      case 'summary':       container.innerHTML = renderSummary(record.patient, role); break;
      case 'history':       container.innerHTML = renderHistoryShell(record); loadHistoryAdmissions(); break;
      case 'consultations': container.innerHTML = renderConsultations(record); break;
      case 'prescriptions': container.innerHTML = renderPrescriptions(record.prescriptions); break;
      case 'lab':           container.innerHTML = renderLab(record.labs); break;
      case 'imaging':       container.innerHTML = renderImaging(record.imaging); break;
      case 'documents':     container.innerHTML = renderDocuments(record.documents); break;
      case 'access_log':    container.innerHTML = `<div class="loading">⏳</div>`; loadAccessLog(); break;
      default:              container.innerHTML = '';
    }
  }

  /* ── Résumé ─────────────────────────────────────── */
  function renderSummary(p, role) {
    const clinicalAllowed = role !== 'reception' && role !== 'lab';
    const rows = [
      ['Nom', esc(p.lastname||'—')],
      ['Prénom', esc(p.firstname||'—')],
      ['Sexe', p.gender==='F'?'Féminin':p.gender==='M'?'Masculin':'—'],
      ['Date de naissance', esc(p.dob||'—')],
      ['Âge', `${calcAge(p.dob)} ans`],
      ['Téléphone', esc(p.phone||'—')],
      ['Adresse', esc(p.address||'—')],
    ];
    if (clinicalAllowed) {
      rows.push(
        ['Groupe sanguin', esc(p.blood_type||'—')],
        ['Allergies', esc(p.allergies||'—')],
        ['Maladies chroniques', esc(p.chronic||'—')],
      );
    }
    rows.push(['Personne à prévenir', esc(p.emergency||'—')]);

    return `
      <div class="card">
        <div class="mrd-photo-row">
          <div class="mrd-photo">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="">` : '🧑'}</div>
          <table class="info-table">
            ${rows.map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
          </table>
        </div>
        ${!clinicalAllowed ? `<p class="muted" style="margin-top:.6rem;font-size:.78rem">ℹ️ Informations administratives uniquement pour votre rôle.</p>` : ''}
      </div>`;
  }

  /* ── Filtres (historique / consultations) ──────── */
  function distinctDoctors(consultations) {
    return [...new Set(consultations.map(c => c.doctor).filter(Boolean))];
  }

  function renderFilterBar(consultations) {
    const doctors = distinctDoctors(consultations);
    return `
      <div class="mrd-filters">
        <select onchange="MedicalRecordDesktop.setFilter('doctor', this.value)">
          <option value="">Tous les médecins</option>
          ${doctors.map(d => `<option value="${esc(d)}"${_filters.doctor===d?' selected':''}>${esc(d)}</option>`).join('')}
        </select>
        <input type="date" value="${esc(_filters.from)}" onchange="MedicalRecordDesktop.setFilter('from', this.value)" title="Depuis">
        <input type="date" value="${esc(_filters.to)}" onchange="MedicalRecordDesktop.setFilter('to', this.value)" title="Jusqu'au">
        <input type="text" value="${esc(_filters.diagnosis)}" placeholder="Diagnostic…" oninput="MedicalRecordDesktop.setFilter('diagnosis', this.value)">
        <select onchange="MedicalRecordDesktop.setFilter('status', this.value)">
          <option value="">Tous statuts</option>
          <option value="pending"${_filters.status==='pending'?' selected':''}>En attente</option>
          <option value="completed"${_filters.status==='completed'?' selected':''}>Terminé</option>
        </select>
      </div>`;
  }

  function matchesFilters(item) {
    if (_filters.doctor && item.doctor !== _filters.doctor) return false;
    if (_filters.from && (item.date||'') < _filters.from) return false;
    if (_filters.to && (item.date||'') > _filters.to) return false;
    if (_filters.diagnosis && !(item.diagnosis||'').toLowerCase().includes(_filters.diagnosis.toLowerCase())) return false;
    if (_filters.status && (item.status||'') !== _filters.status) return false;
    return true;
  }

  /* ── Consultations ──────────────────────────────── */
  function renderConsultations(record) {
    const list = record.consultations.filter(matchesFilters);
    return `
      ${renderFilterBar(record.consultations)}
      ${!list.length ? `<div class="card empty-state"><p>Aucune consultation.</p></div>` : `
      <div class="records-list">
        ${list.map(c => `
          <div class="record-card">
            <div class="record-header">
              <span class="record-date">${esc(c.date||'—')}</span>
              <span class="record-doctor">${esc(c.doctor||'—')}</span>
            </div>
            <p><strong>Motif :</strong> ${esc(c.reason||'—')}</p>
            <p><strong>Diagnostic :</strong> ${esc(c.diagnosis||'—')}</p>
            <p><strong>Traitement :</strong> ${esc(c.treatment||'—')}</p>
            ${c.notes ? `<p><strong>Observations :</strong> ${esc(c.notes)}</p>` : ''}
            <p class="muted" style="font-size:.78rem">${esc(c.establishmentName||'')}</p>
          </div>`).join('')}
      </div>`}`;
  }

  /* ── Ordonnances ────────────────────────────────── */
  function renderPrescriptions(list) {
    return !list.length ? `<div class="card empty-state"><p>Aucune ordonnance.</p></div>` : `
      <div class="records-list">
        ${list.map(rx => `
          <div class="record-card">
            <div class="record-header">
              <span class="record-date">${esc(rx.date||'—')}</span>
              <span class="record-doctor">${esc(rx.doctor||'—')}</span>
            </div>
            <ul style="margin:.3rem 0 .3rem 1.1rem;padding:0">
              ${(rx.medicines||[]).map(m => `<li>${esc(m.name||'—')}${m.dosage?' — '+esc(m.dosage):''}${m.duration?' — '+esc(m.duration):''}</li>`).join('') || '<li>—</li>'}
            </ul>
            <p class="muted" style="font-size:.8rem">
              Pharmacie : ${esc(rx.pharmacyName||rx.pharmacy||'—')} ·
              Statut : ${esc(rx.status||'—')}
            </p>
          </div>`).join('')}
      </div>`;
  }

  /* ── Laboratoire ────────────────────────────────── */
  function renderLab(list) {
    return !list.length ? `<div class="card empty-state"><p>Aucune analyse.</p></div>` : `
      <div class="records-list">
        ${list.map(l => `
          <div class="record-card">
            <div class="record-header">
              <span class="record-date">${esc(l.date||'—')}</span>
              <span class="record-doctor">${esc(l.doctor||'—')}</span>
            </div>
            <p><strong>Type :</strong> ${esc(l.type||'—')} ${l.value?'— '+esc(l.value):''}</p>
            ${(l.results||[]).length ? `
              <table class="info-table">
                ${l.results.map(r => `<tr><td>${esc(r.param||'—')}</td><td>${esc(r.value||'—')}</td><td class="muted">Réf. ${esc(r.ref||'—')}</td></tr>`).join('')}
              </table>` : ''}
            ${l.notes ? `<p><strong>Interprétation :</strong> ${esc(l.notes)}</p>` : ''}
            <p class="muted" style="font-size:.78rem">${esc(l.establishmentName||'')}</p>
          </div>`).join('')}
      </div>`;
  }

  /* ── Imagerie (prévue même sans document) ───────── */
  function renderImaging(list) {
    const TYPES = ['Radiographie','Scanner','IRM','Échographie'];
    return `
      <div class="card" style="margin-bottom:.8rem">
        <p class="muted" style="font-size:.85rem">Types prévus : ${TYPES.join(' · ')}.</p>
      </div>
      ${!list.length ? `<div class="card empty-state"><p>Aucun document d'imagerie pour le moment.</p></div>` : `
      <div class="records-list">
        ${list.map(d => `
          <div class="record-card">
            <p><strong>${esc(d.documentTitle||'Document')}</strong></p>
            <p class="muted" style="font-size:.8rem">${esc((d.createdAt||'').slice(0,10))} · ${esc(d.doctorName||'—')}</p>
            ${d.url ? `<a class="btn btn-ghost btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener">👁️ Aperçu / Télécharger</a>` : ''}
          </div>`).join('')}
      </div>`}`;
  }

  /* ── Documents ──────────────────────────────────── */
  function renderDocuments(list) {
    return !list.length ? `<div class="card empty-state"><p>Aucun document.</p></div>` : `
      <div class="records-list">
        ${list.map(d => `
          <div class="record-card">
            <p><strong>${esc(d.documentTitle||d.documentType||'Document')}</strong>
               <span class="chip">${esc(d.documentType||'')}</span></p>
            <p class="muted" style="font-size:.8rem">${esc((d.createdAt||'').slice(0,10))} · ${esc(d.doctorName||'—')}</p>
            ${d.url ? `<a class="btn btn-ghost btn-sm" href="${esc(d.url)}" target="_blank" rel="noopener">👁️ Aperçu / Télécharger</a>` : ''}
          </div>`).join('')}
      </div>`;
  }

  /* ── Historique médical (chronologique, tous types) ── */
  function renderHistoryShell(record) {
    return `
      ${renderFilterBar(record.consultations)}
      <div class="records-list" id="mrd-history-list">${historyEntriesHtml(record, [])}</div>`;
  }

  function historyEntriesHtml(record, admissions) {
    const entries = [
      ...record.consultations.filter(matchesFilters).map(c => ({ date:c.date, type:'🩺 Consultation', title:c.reason||c.diagnosis||'—', sub:c.doctor })),
      ...record.labs.map(l => ({ date:l.date, type:'🧪 Analyse', title:l.type||'—', sub:l.doctor })),
      ...record.vaccinations.map(v => ({ date:v.date, type:'💉 Vaccination', title:v.vaccine||'—', sub:v.doctor })),
      ...record.appointments.map(a => ({ date:a.date, type:'📅 Rendez-vous', title:a.reason||'—', sub:a.status })),
      ...admissions.map(a => ({ date:(a.admittedAt||'').slice(0,10), type:'🏥 Hospitalisation', title:a.reason||'—', sub:a.status })),
    ].sort((a,b) => (b.date||'').localeCompare(a.date||''));

    return !entries.length ? `<div class="card empty-state"><p>Aucun événement.</p></div>` : entries.map(e => `
      <div class="record-card">
        <div class="record-header"><span class="record-date">${esc(e.date||'—')}</span><span class="chip">${e.type}</span></div>
        <p><strong>${esc(e.title||'—')}</strong></p>
        ${e.sub ? `<p class="muted" style="font-size:.8rem">${esc(e.sub)}</p>` : ''}
      </div>`).join('');
  }

  async function loadHistoryAdmissions() {
    const record = _recordCache[_activeId];
    const hospital = currentHospital();
    if (!record || !hospital) return;
    try {
      const all = await CloudDB.listByHospital('admissions', hospital.establishmentId);
      record.admissions = all.filter(a => a.patientMc === record.patient.id);
    } catch (_) {
      record.admissions = [];
    }
    // Toujours affiché : ne réécrit que si l'onglet Historique est
    // toujours actif au retour de la requête (l'utilisateur a pu
    // changer d'onglet entre-temps).
    if (_activeTab === 'history') {
      const list = document.getElementById('mrd-history-list');
      if (list) list.innerHTML = historyEntriesHtml(record, record.admissions || []);
    }
  }

  /* ── Historique des accès (journal d'audit) ─────── */
  async function loadAccessLog() {
    const record = _recordCache[_activeId];
    const hospital = currentHospital();
    const container = document.getElementById('mrd-tab-content');
    if (!record || !hospital || !container) return;
    if (!record.accessLog) {
      try {
        record.accessLog = await CloudDB.listAuditLogForTarget('patient', record.patient.id, hospital.establishmentId);
      } catch (_) {
        record.accessLog = [];
      }
    }
    if (_activeTab !== 'access_log') return; // l'utilisateur a changé d'onglet entre-temps
    container.innerHTML = !record.accessLog.length ? `<div class="card empty-state"><p>Aucun accès enregistré.</p></div>` : `
      <div class="records-list">
        ${record.accessLog.map(l => `
          <div class="record-card">
            <div class="record-header">
              <span class="record-date">${esc((l.createdAt||'').replace('T',' ').slice(0,16))}</span>
              <span class="chip">${esc(l.role||'—')}</span>
            </div>
            <p>${esc(l.action||'—')} — ${esc(l.userId||'—')}</p>
          </div>`).join('')}
      </div>`;
  }

  return { render, filter, open, switchTab, setFilter };
})();

window.MedicalRecordDesktop = MedicalRecordDesktop;
