/* =====================================================
   MedConnect 2.0 — Registre des Établissements
   Multi-hôpitaux · Affiliations · Isolation des données
   ===================================================== */
const HospitalsRegistry = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── ÉTABLISSEMENTS ────────────────────────────────
     Chaque hôpital/clinique a un ID unique.
     Un médecin peut être affilié à plusieurs.
  ──────────────────────────────────────────────────── */
  function getHospitals()     { return JSON.parse(localStorage.getItem('mc_hospitals') || '[]'); }
  function saveHospitals(l)   { localStorage.setItem('mc_hospitals', JSON.stringify(l)); }

  function addHospital(data) {
    const list = getHospitals();
    const h = {
      ...data,
      hid:        `H${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    list.push(h);
    saveHospitals(list);
    return h;
  }

  function getHospitalById(hid) { return getHospitals().find(h => h.hid === hid) || null; }

  /* ── AFFILIATIONS MÉDECIN ↔ HÔPITAL ───────────────
     Statuts : pending · approved · rejected
  ──────────────────────────────────────────────────── */
  function getAffiliations()  { return JSON.parse(localStorage.getItem('mc_affiliations') || '[]'); }
  function saveAffiliations(l){ localStorage.setItem('mc_affiliations', JSON.stringify(l)); }

  /** Médecin demande une affiliation */
  function requestAffiliation(doctorUid, doctorName, hid) {
    const affs = getAffiliations();
    if (affs.find(a => a.doctor_uid===doctorUid && a.hid===hid)) return false;
    const a = {
      afid:       `AFF${Date.now()}`,
      doctor_uid:  doctorUid,
      doctor_name: doctorName,
      hid,
      status:      'pending',
      requested_at: new Date().toISOString(),
    };
    affs.push(a);
    saveAffiliations(affs);
    return a;
  }

  /** Admin/gestionnaire de l'hôpital valide ou rejette */
  function respondAffiliation(afid, approved) {
    const affs = getAffiliations();
    const idx  = affs.findIndex(a => a.afid === afid);
    if (idx === -1) return;
    affs[idx].status      = approved ? 'approved' : 'rejected';
    affs[idx].decided_at  = new Date().toISOString();
    saveAffiliations(affs);
    // Notifier le médecin
    const h = getHospitalById(affs[idx].hid);
    if (window.Network?.notify) {
      Network.notify({
        to_role: 'doctor',
        to_id:   affs[idx].doctor_uid,
        type:    'info',
        subject: approved
          ? `✅ Affiliation approuvée — ${h?.name||'Établissement'}`
          : `❌ Affiliation refusée — ${h?.name||'Établissement'}`,
        body: approved
          ? `Votre demande d'affiliation à ${h?.name} a été approuvée. Vous pouvez maintenant y accéder.`
          : `Votre demande d'affiliation à ${h?.name} a été refusée par l'administrateur.`,
      });
    }
  }

  /** Hôpitaux approuvés pour un médecin */
  function getDoctorHospitals(doctorUid) {
    const affs = getAffiliations().filter(a => a.doctor_uid===doctorUid && a.status==='approved');
    return affs.map(a => getHospitalById(a.hid)).filter(Boolean);
  }

  /** Affiliations en attente pour un hôpital */
  function getPendingAffiliations(hid) {
    return getAffiliations().filter(a => a.hid===hid && a.status==='pending');
  }

  /* ── CONTEXTE ACTIF (hôpital sélectionné) ─────────
     Stocké en sessionStorage → reset à la déconnexion
  ──────────────────────────────────────────────────── */
  function getCurrentHospital() {
    const hid = sessionStorage.getItem('mc_current_hospital');
    return hid ? getHospitalById(hid) : null;
  }

  function setCurrentHospital(hid) {
    sessionStorage.setItem('mc_current_hospital', hid);
    const h = getHospitalById(hid);
    App.toast(`🏥 Établissement : ${h?.name || '—'}`);
    if (window.App?.buildNav) App.buildNav(Auth.getUser());
    if (window.App?.navigateTo) App.navigateTo('dashboard');
  }

  function clearCurrentHospital() {
    sessionStorage.removeItem('mc_current_hospital');
  }

  /* ── ISOLATION DES DONNÉES ─────────────────────────
     Filtre les patients par hôpital actif du médecin
  ──────────────────────────────────────────────────── */
  function getPatientsForContext(doctorUid) {
    const h = getCurrentHospital();
    return DB.getPatients().filter(p =>
      p.created_by === doctorUid &&
      (!h || p.hospital_id === h.hid || !p.hospital_id)
    );
  }

  function getAppointmentsForContext(doctorUid) {
    const h = getCurrentHospital();
    return DB.getAppointments().filter(a =>
      a.doctor_uid === doctorUid &&
      (!h || a.hospital_id === h.hid || !a.hospital_id)
    );
  }

  /* ── SÉLECTEUR D'ÉTABLISSEMENT (UI) ─────────────── */
  function renderHospitalSwitcher(doctorUid) {
    const hospitals = getDoctorHospitals(doctorUid);
    const current   = getCurrentHospital();

    if (!hospitals.length) {
      return `
        <div class="hosp-switcher no-hosp">
          <span>🏥 Aucun établissement affilié</span>
          <button class="btn btn-ghost btn-xs"
            onclick="HospitalsRegistry.openRequestAffiliation()">+ Demander affiliation</button>
        </div>`;
    }

    return `
      <div class="hosp-switcher">
        <span class="hosp-icon">🏥</span>
        <select onchange="HospitalsRegistry.setCurrentHospital(this.value)"
                style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;
                       color:var(--text);padding:.3rem .6rem;font-family:var(--font);font-size:.8rem;flex:1">
          ${hospitals.map(h =>
            `<option value="${h.hid}" ${h.hid===current?.hid?'selected':''}>${esc(h.name)} — ${h.city||h.country}</option>`
          ).join('')}
        </select>
      </div>`;
  }

  /* ── MODAL DEMANDE D'AFFILIATION ─────────────────── */
  function openRequestAffiliation() {
    const hospitals = getHospitals();
    App.openModal('🏥 Demander une affiliation', `
      <p style="font-size:.84rem;color:var(--text-muted);margin-bottom:1rem">
        Sélectionnez l'établissement. L'admin de cet hôpital devra valider votre demande.
      </p>
      <form onsubmit="HospitalsRegistry.submitAffiliation(event)">
        <div class="form-group">
          <label>Établissement *</label>
          <select id="aff-hid" required>
            <option value="">— Choisir —</option>
            ${hospitals.map(h =>
              `<option value="${h.hid}">${esc(h.name)} — ${h.city||h.country}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Ou créer un nouvel établissement</label>
          <button type="button" class="btn btn-ghost btn-sm"
            onclick="App.closeModal();HospitalsRegistry.openCreateHospital()">+ Créer un hôpital/clinique</button>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">📤 Envoyer la demande</button>
        </div>
      </form>`);
  }

  function submitAffiliation(e) {
    e.preventDefault();
    const user = Auth.getUser();
    const hid  = document.getElementById('aff-hid').value;
    const ok   = requestAffiliation(user.uid, user.name, hid);
    App.closeModal();
    App.toast(ok ? '📤 Demande envoyée — en attente de validation' : '⚠️ Demande déjà envoyée', ok?'success':'error');
  }

  /* ── MODAL CRÉATION ÉTABLISSEMENT ───────────────── */
  function openCreateHospital() {
    const countries = window.PatientPortal?.getCountriesList?.() || [
      { code:'CD', flag:'🇨🇩', name:'République démocratique du Congo' },
      { code:'SN', flag:'🇸🇳', name:'Sénégal' },
      { code:'CI', flag:'🇨🇮', name:'Côte d’Ivoire' },
      { code:'CM', flag:'🇨🇲', name:'Cameroun' },
      { code:'FR', flag:'🇫🇷', name:'France' },
    ];
    App.openModal('🏥 Créer un établissement', `
      <form onsubmit="HospitalsRegistry.saveHospital(event)">
        <div class="form-grid">
          <div class="form-group full-width"><label>Nom de l'établissement *</label><input type="text" id="h-name" required placeholder="CHU de Kinshasa, Clinique…"></div>
          <div class="form-group"><label>Type *</label>
            <select id="h-type" required>
              <option value="">—</option>
              <option value="hospital">🏥 Hôpital public</option>
              <option value="clinic">🏨 Clinique privée</option>
              <option value="health_center">🏢 Centre de santé</option>
              <option value="pharmacy">💊 Pharmacie</option>
              <option value="lab">🧪 Laboratoire</option>
            </select>
          </div>
          <div class="form-group"><label>Pays *</label>
            <select id="h-country" required>
              <option value="">—</option>
              ${countries.map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Ville</label><input type="text" id="h-city"></div>
          <div class="form-group"><label>Adresse</label><input type="text" id="h-address"></div>
          <div class="form-group"><label>Téléphone</label><input type="tel" id="h-phone"></div>
          <div class="form-group full-width"><label>Email</label><input type="email" id="h-email"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">✅ Créer</button>
        </div>
      </form>`);
  }

  function saveHospital(e) {
    e.preventDefault();
    const user = Auth.getUser();
    const h = addHospital({
      name:     document.getElementById('h-name').value.trim(),
      type:     document.getElementById('h-type').value,
      country:  document.getElementById('h-country').value,
      city:     document.getElementById('h-city').value.trim(),
      address:  document.getElementById('h-address').value.trim(),
      phone:    document.getElementById('h-phone').value.trim(),
      email:    document.getElementById('h-email').value.trim(),
      owner_uid: user.uid,
    });
    // Affiliation automatique pour le créateur (approuvée)
    const a = requestAffiliation(user.uid, user.name, h.hid);
    if (a) respondAffiliation(a.afid, true);
    App.closeModal();
    App.toast(`✅ Établissement créé — ${h.name}`);
    setCurrentHospital(h.hid);
  }

  /* ── PAGE GESTION ÉTABLISSEMENTS (admin/médecin) ── */
  function renderManagePage(main) {
    const user     = Auth.getUser();
    const myHosps  = getDoctorHospitals(user.uid);
    const pending  = getAffiliations().filter(a => {
      const h = getHospitalById(a.hid);
      return a.status==='pending' && h?.owner_uid===user.uid;
    });

    main.innerHTML = `
      <div class="page-header">
        <h2>🏥 Mes Établissements</h2>
        <button class="btn btn-primary btn-sm" onclick="HospitalsRegistry.openCreateHospital()">+ Créer</button>
      </div>

      ${pending.length ? `
        <div style="margin-bottom:1.25rem">
          <h3 style="color:var(--accent);margin-bottom:.6rem">⏳ Demandes d'affiliation en attente (${pending.length})</h3>
          ${pending.map(a => `
            <div class="record-card">
              <div class="record-header">
                <strong>👨‍⚕️ ${esc(a.doctor_name)}</strong>
                <span class="record-date">📅 ${a.requested_at?.slice(0,10)}</span>
              </div>
              <div style="display:flex;gap:.5rem;margin-top:.5rem">
                <button class="btn btn-ghost btn-sm" style="color:var(--secondary)"
                  onclick="HospitalsRegistry.respondAffiliation('${a.afid}',true);HospitalsRegistry.renderManagePage(document.getElementById('main-content'))">
                  ✅ Approuver
                </button>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
                  onclick="HospitalsRegistry.respondAffiliation('${a.afid}',false);HospitalsRegistry.renderManagePage(document.getElementById('main-content'))">
                  ❌ Refuser
                </button>
              </div>
            </div>`).join('')}
        </div>` : ''}

      <h3 style="margin-bottom:.75rem">Mes affiliations approuvées</h3>
      ${myHosps.length ? myHosps.map(h => {
        const isCurrent = getCurrentHospital()?.hid === h.hid;
        const typeIcons = { hospital:'🏥', clinic:'🏨', health_center:'🏢', pharmacy:'💊', lab:'🧪' };
        return `
          <div class="record-card ${isCurrent?'active-hosp':''}">
            <div class="record-header">
              <span>${typeIcons[h.type]||'🏥'}</span>
              <strong>${esc(h.name)}</strong>
              ${isCurrent ? `<span class="chip" style="color:var(--secondary);border-color:var(--secondary)">✅ Actif</span>` : ''}
              <span class="record-date">${h.city||''} · ${h.country}</span>
            </div>
            ${h.phone ? `<p style="font-size:.8rem;color:var(--text-muted)">📞 ${h.phone}</p>` : ''}
            ${!isCurrent ? `
              <button class="btn btn-ghost btn-sm" style="margin-top:.5rem"
                onclick="HospitalsRegistry.setCurrentHospital('${h.hid}')">
                🔄 Basculer vers cet établissement
              </button>` : ''}
          </div>`;
      }).join('') : `
        <div class="card empty-state">
          <p>Aucun établissement affilié.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:.75rem"
            onclick="HospitalsRegistry.openRequestAffiliation()">+ Demander une affiliation</button>
        </div>`}
      <button class="btn btn-ghost btn-sm" style="margin-top:1rem;width:100%"
        onclick="HospitalsRegistry.openRequestAffiliation()">+ Demander une nouvelle affiliation</button>`;
  }

  /* ── INIT DONNÉES DÉMO ─────────────────────────── */
  function initDemoHospitals() {
    if (getHospitals().length > 0) return;
    const h1 = addHospital({ name:'CHU de Kinshasa',      type:'hospital',      country:'CD', city:'Kinshasa',  phone:'+243 999 001 001' });
    const h2 = addHospital({ name:'Clinique Ngaliema',    type:'clinic',        country:'CD', city:'Kinshasa',  phone:'+243 999 001 002' });
    const h3 = addHospital({ name:'Hôpital Fann Dakar',   type:'hospital',      country:'SN', city:'Dakar',     phone:'+221 33 839 3000' });
    const h4 = addHospital({ name:'CHU Abidjan',          type:'hospital',      country:'CI', city:'Abidjan',   phone:'+225 27 21 23 23' });
    const h5 = addHospital({ name:'Hôpital Lariboisière', type:'hospital',      country:'FR', city:'Paris',     phone:'+33 1 49 95 65 65'});
    // Affiliations démo pour docteur demo
    const demoAff = (hid) => {
      const a = requestAffiliation('u2','Dr. Amina Koné', hid);
      if (a) respondAffiliation(a.afid, true);
    };
    demoAff(h1.hid); demoAff(h2.hid);
  }

  return {
    getHospitals, addHospital, getHospitalById,
    getAffiliations, requestAffiliation, respondAffiliation,
    getDoctorHospitals, getPendingAffiliations,
    getCurrentHospital, setCurrentHospital, clearCurrentHospital,
    getPatientsForContext, getAppointmentsForContext,
    renderHospitalSwitcher, openRequestAffiliation, submitAffiliation,
    openCreateHospital, saveHospital,
    renderManagePage,
    initDemoHospitals,
  };
})();
