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

    // Correctif (audit "workflows mobile/desktop", section 11) : bug
    // confirmé — la page Réception affichait les arrivées/pré-admissions
    // mais jamais les statistiques de lits, alors que
    // js/hospital-reception.js lit déjà 'beds' pour l'écran d'arrivée
    // (openIntake). En cas d'échec de chargement, on affiche
    // explicitement une indisponibilité — jamais un faux zéro qui
    // laisserait croire que l'hôpital n'a aucun lit.
    let beds = null;
    try {
      beds = await CloudDB.listByHospital('beds', hospitalId);
    } catch (e) {
      console.error('[Reception] Chargement des lits :', e);
      beds = null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayVisits = _visits.filter(v => String(v.arrivedAt || '').slice(0, 10) === today);
    const waiting = todayVisits.filter(v => v.status === 'waiting');
    const preAdmissions = todayVisits.filter(v => v.status === 'pre_admission').length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>🛎️ Réception / Accueil</h1><p>Enregistrement et orientation des patients</p></div>
        <button class="btn btn-primary btn-sm" onclick="HospitalReceptionModule.openIntake()">+ Enregistrer une arrivée</button>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${todayVisits.length}</h3><p>Arrivées aujourd'hui</p></div>
        <div class="hospital-stat-card"><h3>${waiting.length}</h3><p>⏳ En attente</p></div>
        <div class="hospital-stat-card"><h3>${todayVisits.filter(v=>v.status==='oriented').length}</h3><p>➡️ Orientés</p></div>
        <div class="hospital-stat-card"><h3>${preAdmissions}</h3><p>🕓 Pré-admissions</p></div>
        <div class="hospital-stat-card"><h3>${todayVisits.filter(v=>v.status==='hospitalized').length}</h3><p>🛏️ Hospitalisés</p></div>
      </div>

      <div class="card">
        <h3>🛏️ Lits de l'établissement</h3>
        ${bedsRow(beds)}
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

  // Correctif (audit "workflows mobile/desktop", section 11) : lits
  // totaux/libres/occupés/hors service + taux d'occupation (occupés /
  // lits UTILISABLES, hors service exclu du dénominateur). `beds ===
  // null` signale un échec de chargement — affiché explicitement,
  // jamais confondu avec "zéro lit".
  function bedsRow(beds) {
    if (beds === null) {
      return `<p class="muted">⚠️ Données des lits indisponibles.</p>`;
    }
    const total = beds.length;
    const free = beds.filter(b => b.status === 'free').length;
    const occupied = beds.filter(b => b.status === 'occupied').length;
    const outOfService = beds.filter(b => b.status === 'maintenance').length;
    const usable = total - outOfService;
    const occupancyRate = usable > 0 ? Math.round((occupied / usable) * 100) : 0;
    const lastUpdated = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${total}</h3><p>Lits totaux</p></div>
        <div class="hospital-stat-card"><h3>${free}</h3><p>🟢 Libres</p></div>
        <div class="hospital-stat-card"><h3>${occupied}</h3><p>🔴 Occupés</p></div>
        <div class="hospital-stat-card"><h3>${outOfService}</h3><p>🟡 Hors service</p></div>
        <div class="hospital-stat-card"><h3>${occupancyRate}%</h3><p>Taux d'occupation</p></div>
      </div>
      <p class="muted" style="margin-top:.4rem;font-size:.75rem">Dernière mise à jour : ${esc(lastUpdated)}</p>
    `;
  }

  function statusLabel(s) {
    return ({
      waiting:'⏳ En attente', oriented:'➡️ Orienté',
      // 'pre_admission' (chantier sécurité, section 6) : la réception a
      // demandé un lit, mais aucune admission n'existe encore — reste
      // "hospitalized" pour les entrées déjà créées AVANT ce correctif
      // (jamais migrées, voir HospitalBedsModule.confirmAdmission).
      pre_admission:'🕓 Pré-admission en attente',
      hospitalized:'🛏️ Hospitalisé', done:'✅ Clôturé',
    })[s] || s;
  }

  function visitCard(v) {
    return `
      <div class="record-card">
        <p><strong>${esc(v.patientName || '—')}</strong> <span class="id-tag">${esc(v.patientMc || '')}</span></p>
        <p class="muted">${statusLabel(v.status)} · ${esc(v.reason || '')} · arrivé à ${esc(String(v.arrivedAt||'').slice(11,16))}</p>
        ${v.doctorName ? `<p>👨‍⚕️ Orienté vers ${esc(v.doctorName)}</p>` : ''}
        ${v.bedLabel ? `<p>🛏️ ${esc(v.bedLabel)}</p>` : ''}
        ${v.status === 'pre_admission' && v.requestedBedLabel ? `<p>🕓 Lit demandé : ${esc(v.requestedBedLabel)} (en attente de confirmation par un soignant)</p>` : ''}
        ${v.status === 'waiting' ? `
          <button class="btn btn-ghost btn-sm" onclick="HospitalReceptionModule.closeVisit('${esc(v.id)}')">Clôturer</button>` : ''}
      </div>`;
  }

  /* ── ENREGISTREMENT D'UNE ARRIVÉE ──────────────────── */

  // Correctif (audit "workflows mobile/desktop", section 4) : bug confirmé
  // par test réel — le champ "Numéro MC du patient" acceptait n'importe
  // quel texte (ex. "DK"), et la section "Nouveau patient" était repliée
  // sous un <details>/<summary> peu visible : un agent tapant un
  // identifiant invalide se heurtait à un message d'erreur final
  // ("renseignez prénom et nom") sans jamais voir où saisir ces champs.
  // Remplacé par un choix explicite et toujours visible — Patient
  // existant / Nouveau patient — avec bascule automatique vers "Nouveau
  // patient" quand la recherche ne trouve rien.
  const MC_FORMAT_RE = /^MC-/;
  let _rcMode = 'existing';

  function setMode(mode) {
    _rcMode = mode === 'new' ? 'new' : 'existing';
    const existingPanel = document.getElementById('rc-panel-existing');
    const newPanel = document.getElementById('rc-panel-new');
    const btnExisting = document.getElementById('rc-mode-existing');
    const btnNew = document.getElementById('rc-mode-new');
    if (existingPanel) existingPanel.style.display = _rcMode === 'existing' ? '' : 'none';
    if (newPanel) newPanel.style.display = _rcMode === 'new' ? '' : 'none';
    if (btnExisting) btnExisting.className = `btn btn-sm ${_rcMode === 'existing' ? 'btn-primary' : 'btn-ghost'}`;
    if (btnNew) btnNew.className = `btn btn-sm ${_rcMode === 'new' ? 'btn-primary' : 'btn-ghost'}`;
  }

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

    _rcMode = 'existing';
    App.openModal('🛎️ Enregistrer une arrivée', `
      <div class="form-group">
        <label>Identification du patient *</label>
        <div style="display:flex;gap:.4rem">
          <button type="button" class="btn btn-sm btn-primary" id="rc-mode-existing" onclick="HospitalReceptionModule.setMode('existing')">🔎 Patient existant</button>
          <button type="button" class="btn btn-sm btn-ghost" id="rc-mode-new" onclick="HospitalReceptionModule.setMode('new')">🆕 Nouveau patient</button>
        </div>
      </div>

      <div id="rc-panel-existing">
        <div class="form-group">
          <label>Numéro MC du patient</label>
          <input id="rc-mc" placeholder="MC-2026-CD-XXXXXXXX">
          <button class="btn btn-ghost btn-xs" style="margin-top:.3rem" onclick="HospitalReceptionModule.lookupPatient()">🔍 Rechercher</button>
          <div id="rc-found" style="margin-top:.3rem"></div>
        </div>
      </div>

      <div id="rc-panel-new" style="display:none">
        <div class="form-group"><label>Prénom *</label><input id="rc-fn"></div>
        <div class="form-group"><label>Nom *</label><input id="rc-ln"></div>
        <div class="form-group"><label>Date de naissance</label><input id="rc-dob" type="date"></div>
        <div class="form-group"><label>Sexe</label>
          <select id="rc-gender"><option value="">—</option><option value="M">Masculin</option><option value="F">Féminin</option></select>
        </div>
        <div class="form-group"><label>Téléphone</label><input id="rc-phone"></div>
      </div>

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

      <button class="btn btn-primary btn-full" id="rc-save-btn" onclick="HospitalReceptionModule.saveIntake()">Enregistrer l'arrivée</button>
    `);
  }

  /* ── Recherche patient cloud-first (chantier sécurité, section 5) ──
     Correctif (bug confirmé) : lookupPatient() ne cherchait QUE dans
     window.DB.getPatients() (cache local) — un patient déjà enregistré
     ailleurs (autre poste, jamais synchronisé sur CE poste) était donc
     déclaré "introuvable" à tort par la réception, menant à la création
     d'un doublon. Miroir exact du pattern déjà en production dans
     js/hospital-lab.js (_lookupPatient/_searchPatient) : cache local
     d'abord, puis lecture Firestore CIBLÉE d'un seul document
     (mc_patients/{mc}) — jamais toute la collection. L'isolation par
     établissement (firestore.rules belongsToSameEstablishment) reste
     la seule vraie barrière ; ici on distingue explicitement ce refus
     ("Non autorisé") d'une absence réelle ("introuvable"), utile à la
     réception pour éviter de recréer par erreur la fiche de quelqu'un
     affilié à un autre établissement. */
  let _rcSearchToken = 0;
  async function _lookupPatientCloud(mc) {
    const local = (window.DB?.getPatients?.() || []).find(x => String(x.id||'').toUpperCase() === mc);
    if (local) return { patient: local, denied: false };
    if (!window.firebaseReady || !window.firebaseDB) return { patient: null, denied: false };
    try {
      const snap = await window.firebaseDB.collection('mc_patients').doc(mc).get();
      if (!snap.exists) return { patient: null, denied: false };
      const patient = { id: snap.id, ...snap.data() };
      // Fusionne dans le cache local SANS écraser une entrée locale
      // plus fraîche déjà présente (vérifié juste au-dessus — ce
      // chemin n'est atteint que si `local` était absent).
      try {
        const list = window.DB?.getPatients?.() || [];
        if (!list.some(x => x.id === patient.id)) {
          window.DB?.savePatients?.([...list, patient]);
        }
      } catch (mergeErr) { console.warn('[Reception] Fusion cache patient :', mergeErr); }
      return { patient, denied: false };
    } catch (e) {
      if (e?.code === 'permission-denied') return { patient: null, denied: true };
      throw e;
    }
  }

  async function lookupPatient() {
    const raw = document.getElementById('rc-mc').value.trim();
    const mc = raw.toUpperCase();
    const box = document.getElementById('rc-found');
    if (!mc) { box.innerHTML = ''; return; }
    // Correctif (section 4, point 9-10) : un texte qui n'a jamais la
    // forme d'un numéro MC (ex. "DK") ne doit jamais être envoyé en
    // recherche silencieuse — message immédiat et explicite, jamais un
    // échec générique découvert seulement à l'enregistrement.
    if (!MC_FORMAT_RE.test(mc)) {
      box.innerHTML = `<small style="color:var(--accent)">⚠️ Ce champ attend un numéro patient MedConnect (ex. MC-2026-CD-XXXXXXXX). Pour enregistrer un nouveau patient, choisissez « 🆕 Nouveau patient » ci-dessus.</small>`;
      return;
    }
    const token = ++_rcSearchToken;
    box.innerHTML = `<small class="muted">⏳ Recherche en cours…</small>`;
    try {
      const { patient: p, denied } = await _lookupPatientCloud(mc);
      if (token !== _rcSearchToken) return; // saisie modifiée entre-temps : réponse obsolète
      if (p) {
        box.innerHTML = `<small style="color:var(--secondary)">✅ Patient trouvé — ${esc(p.firstname||'')} ${esc(p.lastname||'')}</small>`;
      } else if (denied) {
        box.innerHTML = `<small style="color:var(--danger)">🚫 Non autorisé — ce numéro appartient à un autre établissement.</small>`;
      } else {
        // Correctif (section 4, point 3) : proposer explicitement de
        // créer une nouvelle fiche au lieu d'une simple erreur sur des
        // champs cachés — bascule directement vers le panneau visible.
        box.innerHTML = `<small style="color:var(--accent)">⚠️ Patient introuvable.</small>
          <button type="button" class="btn btn-ghost btn-xs" style="margin-top:.3rem" onclick="HospitalReceptionModule.setMode('new')">➕ Créer un nouveau patient</button>`;
      }
    } catch (e) {
      if (token !== _rcSearchToken) return;
      console.error('[Reception] lookupPatient :', e);
      box.innerHTML = `<small style="color:var(--danger)">❌ Recherche impossible — vérifiez la connexion.</small>`;
    }
  }

  // Anti double-appui : la fonction enchaîne plusieurs écritures cloud
  // awaitées — un second clic pendant ce temps créait patient/visite en
  // double.
  let _savingIntake = false;
  async function saveIntake() {
    if (_savingIntake) return;
    _savingIntake = true;
    const saveBtn = document.getElementById('rc-save-btn');
    const saveLabel = saveBtn?.textContent || "Enregistrer l'arrivée";
    const setBtn = (label, disabled) => { if (saveBtn) { saveBtn.textContent = label; saveBtn.disabled = !!disabled; } };
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('view_patient')) return;

      const hospitalId = await CloudDB.getActiveHospitalId();
      const est = window.HospitalPortal?.currentEstablishmentFields?.() || {};
      let mc = '';
      let patient = null;

      // Correctif (audit "workflows mobile/desktop", section 4) : le mode
      // (existant/nouveau) est désormais un choix EXPLICITE de l'agent
      // (_rcMode), plus une déduction implicite de "le champ MC est-il
      // vide" — un texte qui n'a pas la forme d'un numéro MC ne doit
      // jamais silencieusement finir traité comme "nouveau patient".
      if (_rcMode === 'existing') {
        mc = document.getElementById('rc-mc').value.trim().toUpperCase();
        if (!mc || !MC_FORMAT_RE.test(mc)) {
          App.toast('Ce champ attend un numéro patient MedConnect valide (ex. MC-2026-CD-XXXXXXXX), ou choisissez « Nouveau patient ».', 'error');
          return;
        }
        setBtn('⏳ Recherche…', true);
        // Correctif (section 5) : même recherche cloud-first que
        // lookupPatient() — l'agent peut saisir directement le numéro MC
        // et enregistrer sans avoir cliqué "Rechercher" au préalable ; un
        // lookup purement local aurait alors raté un patient déjà créé
        // ailleurs et jamais synchronisé sur ce poste.
        patient = (await _lookupPatientCloud(mc)).patient;
        if (!patient) {
          App.toast('Patient introuvable pour ce numéro. Choisissez « 🆕 Nouveau patient » pour créer sa fiche.', 'error');
          setBtn(saveLabel, false);
          return;
        }
      } else {
        const fn = document.getElementById('rc-fn').value.trim();
        const ln = document.getElementById('rc-ln').value.trim();
        if (!fn || !ln) { App.toast('Prénom et nom sont obligatoires pour créer un nouveau patient.', 'error'); return; }
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
        setBtn('⏳ Création de la fiche…', true);
        // Correctif (chantier sécurité, section 4) : bug confirmé — la
        // réception n'avait aucune clause Firestore create sur
        // mc_patients/patients/medical_records ; la fiche restait
        // provisoire en cache local, jamais confirmée, et la prise en
        // charge (receptionVisits/admissions) se créait quand même
        // dessus. addPatientAndConfirmAtomic() (js/db.js) attend un
        // batch atomique réellement confirmé (les 3 documents ensemble,
        // ou aucun) avant qu'on continue — jamais de fire-and-forget ici.
        const { patient: createdPatient, confirmed } = await window.DB.addPatientAndConfirmAtomic({
          firstname: fn, lastname: ln,
          dob: document.getElementById('rc-dob').value,
          gender: document.getElementById('rc-gender').value,
          phone: document.getElementById('rc-phone').value.trim(),
          ...est,
        });
        if (!confirmed) {
          // addPatientAndConfirmAtomic() a déjà retiré la fiche
          // provisoire du cache local en cas d'échec — on n'crée ni
          // receptionVisits ni admission, et on laisse la modale ouverte
          // pour que l'agent puisse réessayer sans ressaisir le
          // formulaire.
          App.toast("La fiche patient n'a pas été confirmée par Firestore. Vérifiez la connexion puis réessayez.", 'error');
          setBtn(saveLabel, false);
          return;
        }
        patient = createdPatient;
        mc = patient.id;
      }
      setBtn("⏳ Enregistrement de l'arrivée…", true);

      const reason = document.getElementById('rc-reason').value;
      const docSel = document.getElementById('rc-doctor');
      const doctorUid = docSel.value;
      const doctorName = docSel.selectedOptions[0]?.dataset?.name || '';
      const bedSel = document.getElementById('rc-bed');
      const bedId = bedSel.value;
      const bedLabel = bedSel.selectedOptions[0]?.dataset?.label || '';

      // Correctif (chantier sécurité, section 6) : bug confirmé — la
      // réception (rôle sans admit_patient/manage_beds, voir
      // js/hospital-capabilities.js MATRIX) créait pourtant directement
      // une admission ET occupait le lit, sans aucune vérification de
      // capacité ni décision d'un soignant. La sélection d'un lit par la
      // réception ne crée plus qu'une PRÉ-ADMISSION (receptionVisit) —
      // jamais d'admissions ni d'occupation de lit ici. Seul un
      // doctor/nurse/admin_hospital/admin peut la confirmer (voir
      // HospitalBedsModule.confirmAdmission, écran "Lits").
      let status = 'waiting';
      if (bedId) status = 'pre_admission';
      else if (doctorUid) status = 'oriented';

      const visitId = DB.makeId('RCV');
      await CloudDB.createDoc('receptionVisits', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: `${patient.firstname||''} ${patient.lastname||''}`.trim(),
        reason,
        doctorUid, doctorName,
        status,
        arrivedAt: new Date().toISOString(),
        ...(bedId ? {
          requestedBedId: bedId,
          requestedBedLabel: bedLabel,
          admissionRequestedAt: new Date().toISOString(),
          admissionRequestedByUid: window.Auth?.getUser?.()?.uid || '',
          admissionStatus: 'pending',
        } : {}),
        ...est,
      }, visitId);

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
      setBtn(saveLabel, false);
    } finally { _savingIntake = false; }
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

  return { render, openIntake, setMode, lookupPatient, saveIntake, closeVisit };
})();

window.HospitalReceptionModule = HospitalReceptionModule;
