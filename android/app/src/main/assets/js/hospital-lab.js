/* =====================================================
   MedConnect 2.0 — HospitalLabModule (bundle desktop, recréé)
   Laboratoire côté hôpital : demandes d'analyses + résultats.

   CONTRAT D'ÉCHANGE mobile ↔ desktop :
   - Collections du contrat existant : labRequests (demande,
     statuts requested → sample_pending → in_progress → completed)
     et labResults (résultat émis vers le médecin/infirmier
     demandeur) — PAS de collection parallèle (labOrders
     supprimée, dérive de schéma évitée) ;
   - Les statuts sont ceux écoutés par les listeners
     ExchangeBridge (lab/nurse/doctor) ;
   - À la saisie du résultat : le résumé est stocké sur la
     demande (affichage desktop en une lecture), un document
     labResults est émis (resultRecipientUids = médecin/infirmier
     demandeur + médecin responsable), ET un miroir mc_lab_results
     est émis pour le patient — les TROIS dans un seul batch
     Firestore atomique (voir saveResult) ;
   - Écritures gatées par l'abonnement desktop (request_lab /
     add_lab_result) côté client ET côté règles, ET par le rôle
     réel (HospitalCapabilities) côté client ET côté règles.

   Correctif (chantier "modales laboratoire") : le bouton
   "+ Nouvelle demande" était affiché à TOUS les rôles sans
   vérifier HospitalCapabilities.can(role,'request_lab') — un
   laborantin pouvait donc voir (et, avant durcissement des
   règles serveur, utiliser) un bouton créant une prescription
   d'analyse, ce qui n'est pas son rôle. Toutes les actions
   sensibles de ce module vérifient désormais la capacité RÉELLE
   au moment de l'affichage ET au moment de l'action (jamais un
   seul des deux).
   ===================================================== */
const HospitalLabModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Aligné sur LAB_TYPES de js/lab.js (liste privée là-bas, non exportée).
  const LAB_TYPES = [
    'Numération Formule Sanguine (NFS)',
    'Glycémie à jeun',
    'Cholestérol total / LDL / HDL',
    'Triglycérides',
    'Créatinine / Urée',
    'Transaminases (ASAT/ALAT)',
    'Bilan thyroïdien (TSH)',
    'Test de grossesse (βhCG)',
    'CRP (Protéine C-réactive)',
    'Groupe sanguin + RAI',
    'Sérologie VIH',
    'Sérologie Hépatite B/C',
    'Paludisme / Goutte épaisse',
    'ECBU (Examen cytobactériologique urinaire)',
    'Autre',
  ];

  const NORMAL_RANGES = {
    'Glycémie à jeun':            { min: 0.7, max: 1.1, unit: 'g/L' },
    'CRP (Protéine C-réactive)':  { min: 0,   max: 5,   unit: 'mg/L' },
  };

  const STATUS = {
    requested:      { label: 'Demandée',             icon: '📨' },
    sample_pending: { label: 'Prélèvement en cours', icon: '🩸' },
    in_progress:    { label: 'En cours d\'analyse',  icon: '⏳' },
    completed:      { label: 'Résultat disponible',  icon: '✅' },
  };

  // Transitions de statut autorisées — vérifiées dans setStatus()/
  // saveResult() eux-mêmes, pas seulement à l'affichage des boutons
  // (un appel direct à setStatus() depuis la console ne doit pas
  // pouvoir remettre une demande completed à requested).
  const ALLOWED_TRANSITIONS = {
    requested:      ['sample_pending', 'in_progress'],
    sample_pending: ['in_progress'],
    in_progress:    ['completed'],
    completed:      [],
  };
  function _transitionAllowed(from, to) {
    return Array.isArray(ALLOWED_TRANSITIONS[from]) && ALLOWED_TRANSITIONS[from].includes(to);
  }

  function _lockButton(btn, label) {
    if (!btn) return;
    btn.disabled = true;
    if (btn.dataset) btn.dataset.processing = 'true';
    btn.textContent = label;
  }
  function _unlockButton(btn, label) {
    if (!btn) return;
    btn.disabled = false;
    if (btn.dataset) delete btn.dataset.processing;
    btn.textContent = label;
  }

  function _role() { return window.HospitalPermissions?.getCurrentRole?.() || ''; }
  function _canRequestLab(role = _role())    { return !!window.HospitalCapabilities?.can?.(role, 'request_lab'); }
  function _canEnterResult(role = _role())   { return !!window.HospitalCapabilities?.can?.(role, 'enter_lab_result'); }

  let _requests = [];

  async function render(container) {
    HospitalPermissions.requireRoute('lab');
    const role = _role();
    const canRequestLab = _canRequestLab(role);
    const canEnterResult = _canEnterResult(role);
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement du laboratoire…</p></div>`;

    try {
      _requests = await CloudDB.listByHospital('labRequests', hospitalId);
    } catch (e) {
      console.error('[HospitalLab] Chargement :', e);
      container.innerHTML = `<div class="card empty-state"><p>Erreur de chargement : ${esc(e.message)}</p></div>`;
      return;
    }

    const pending = _requests.filter(o => o.status !== 'completed').length;
    const done = _requests.filter(o => o.status === 'completed').length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Laboratoire</h1><p>Demandes d'analyses et résultats de l'établissement</p></div>
        ${canRequestLab ? `
          <button type="button" class="btn btn-primary btn-sm" id="lab-new-btn"
            onclick="HospitalLabModule.openNew(event)">+ Nouvelle demande</button>` : ''}
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${_requests.length}</h3><p>Analyses au total</p></div>
        <div class="hospital-stat-card"><h3>${pending}</h3><p>⏳ En attente</p></div>
        <div class="hospital-stat-card"><h3>${done}</h3><p>✅ Terminées</p></div>
      </div>

      ${!_requests.length ? `<div class="card empty-state"><p>Aucune analyse enregistrée.</p></div>` : `
      <div class="records-list">
        ${_requests.sort((a,b) => String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
          .map(o => requestCard(o, canEnterResult)).join('')}
      </div>`}
    `;
  }

  function requestCard(o, canEnterResult) {
    const st = STATUS[o.status] || STATUS.requested;
    let flag = '';
    const norm = NORMAL_RANGES[o.type];
    const val = parseFloat(o.value);
    if (o.status === 'completed' && norm && !isNaN(val)) {
      flag = val < norm.min ? ' 🔵 Bas' : val > norm.max ? ' 🔴 Élevé' : ' 🟢 Normal';
    }
    return `
      <div class="card record-card">
        <p><strong>${esc(o.type || '—')}</strong> ${st.icon} ${st.label}${o.priority === 'urgente' ? ' · 🔴 Urgent' : ''}</p>
        <p>👤 ${esc(o.patientName || '—')} · ${esc(o.patientMc || '')}</p>
        ${o.status === 'completed'
          ? `<p>Résultat : <strong>${esc(o.value || '—')} ${esc(o.unit || norm?.unit || '')}</strong>${flag}</p>
             ${o.comment ? `<p class="muted">${esc(o.comment)}</p>` : ''}`
          : `<p class="muted">Demandée le ${esc(String(o.createdAt || '').slice(0,10))}${o.requestedByName ? ' · par ' + esc(o.requestedByName) : ''}</p>`}
        <div style="display:flex;gap:.4rem;margin-top:.4rem;flex-wrap:wrap">
          ${(o.status === 'requested' && canEnterResult) ? `
            <button type="button" class="btn btn-ghost btn-sm" data-lab-status-btn="${esc(o.id)}"
              onclick="HospitalLabModule.setStatus('${esc(o.id)}','in_progress')">▶️ Prise en charge</button>` : ''}
          ${(o.status !== 'completed' && canEnterResult) ? `
            <button type="button" class="btn btn-ghost btn-sm" style="color:var(--secondary)" data-lab-result-btn="${esc(o.id)}"
              onclick="HospitalLabModule.openResult('${esc(o.id)}')">🧪 Saisir le résultat</button>` : ''}
        </div>
      </div>`;
  }

  /* ── Nouvelle demande ───────────────────────────── */

  // Correctif (chantier "modales laboratoire") : openNew() ouvrait la
  // modale inconditionnellement (aucune vérification de rôle avant
  // l'ouverture — seul saveOrder() vérifiait, trop tard, une fois le
  // formulaire rempli). Fonction contrôlée : vérifie la capacité AVANT
  // d'ouvrir, ne fait AUCUN appel Firestore pendant l'ouverture (la
  // liste des médecins vient du cache local HospitalsRegistry), et
  // retourne true/false pour que l'appelant (et les tests) sachent si
  // la modale a réellement été ouverte.
  function openNew(event) {
    event?.preventDefault?.();
    const role = _role();
    if (!_canRequestLab(role)) {
      window.App?.toast?.("Votre rôle ne permet pas de créer une demande d'analyse.", 'error');
      return false;
    }
    if (!window.App?.openModal) {
      console.error('[HospitalLab] App.openModal indisponible.');
      return false;
    }

    const hospital = window.HospitalsRegistry?.getCurrentHospital?.();
    const doctors = (hospital?.staff || []).filter(s =>
      s.role === 'doctor' && (s.status === 'active' || s.status === 'approved'));
    const currentUid = window.Auth?.getUser?.()?.uid || window.HospitalAuth?.getSession?.()?.agentUid || '';

    return App.openModal('🧪 Nouvelle demande d\'analyse', `
      <div class="form-group"><label>Numéro MC, nom ou téléphone du patient *</label>
        <input id="lab-mc" placeholder="MC-2026-CD-XXXXXXXX, nom ou téléphone" oninput="HospitalLabModule._searchPatient()"></div>
      <p class="muted" id="lab-mc-status" style="min-height:1.2em"></p>
      <div id="lab-mc-results" style="margin-bottom:.5rem"></div>
      <div class="form-group" id="lab-mc-confirm-wrap" style="display:none">
        <label><input type="checkbox" id="lab-mc-confirm"> Créer quand même la demande pour ce numéro MC introuvable</label>
      </div>
      <div class="form-group"><label>Nom du patient</label>
        <input id="lab-name" placeholder="Rempli automatiquement si le patient est connu"></div>
      <div class="form-group"><label>Type d'analyse *</label>
        <select id="lab-type">
          ${LAB_TYPES.map(lt => `<option value="${esc(lt)}">${esc(lt)}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Médecin responsable / demandeur</label>
        <select id="lab-doctor">
          <option value="">—</option>
          ${doctors.map(d => `<option value="${esc(d.uid)}" ${d.uid === currentUid ? 'selected' : ''}>${esc(d.name || d.uid)}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Priorité</label>
        <select id="lab-priority">
          <option value="normale">Normale</option>
          <option value="urgente">Urgente</option>
        </select></div>
      <div class="form-group"><label>Note clinique</label>
        <textarea id="lab-note" rows="2" placeholder="Facultatif"></textarea></div>
      <div style="display:flex;gap:.5rem">
        <button type="button" class="btn btn-ghost btn-full" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary btn-full" id="lab-save-order-btn"
          onclick="HospitalLabModule.saveOrder()">Envoyer la demande</button>
      </div>
    `);
  }

  /* ── Recherche patient (cache local, puis Firestore ciblé) ──
     Ne télécharge jamais toute la collection : lecture directe du
     document mc_patients/{mc} (id = numéro MC) si absent du cache
     local. L'isolation par établissement est appliquée côté serveur
     (firestore.rules belongsToSameEstablishment) — un refus
     permission-denied est traité comme "introuvable" pour ce poste,
     jamais comme une erreur réseau. */
  let _mcSearchToken = 0;
  async function _lookupPatient(mc) {
    if (!mc) return null;
    const local = window.DB?.getPatients?.()?.find(p => String(p.id || '').toUpperCase() === mc);
    if (local) return local;
    if (!window.firebaseReady || !window.firebaseDB) return null;
    try {
      const snap = await firebaseDB.collection('mc_patients').doc(mc).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
      if (e?.code === 'permission-denied') return null;
      throw e;
    }
  }

  // Chantier v2.9.34 (P1) : sélection d'un patient trouvé par recherche
  // annuaire (nom/téléphone) — remplit le champ MC puis relance la
  // résolution ciblée.
  function _selectDirectoryPatient(mc) {
    const input = document.getElementById('lab-mc');
    if (input) input.value = String(mc || '').toUpperCase();
    const results = document.getElementById('lab-mc-results');
    if (results) results.innerHTML = '';
    _searchPatient();
  }

  async function _searchPatient() {
    const mcInput = document.getElementById('lab-mc');
    const statusEl = document.getElementById('lab-mc-status');
    const confirmWrap = document.getElementById('lab-mc-confirm-wrap');
    const resultsEl = document.getElementById('lab-mc-results');
    const nameEl = document.getElementById('lab-name');
    if (!mcInput || !statusEl) return;
    const raw = mcInput.value.trim();
    const mc = raw.toUpperCase();
    if (resultsEl) resultsEl.innerHTML = '';
    if (!mc) { statusEl.textContent = ''; if (confirmWrap) confirmWrap.style.display = 'none'; return; }

    // Chantier v2.9.34 (P1) : saisie qui n'est pas un numéro MC → recherche
    // annuaire (patient_directory) par nom/téléphone, bornée à
    // l'établissement actif. L'ancienne recherche ne résolvait qu'un
    // numéro MC exact — le laboratoire ne pouvait pas retrouver un patient
    // par son nom.
    if (!/^MC-/.test(mc)) {
      if (confirmWrap) confirmWrap.style.display = 'none';
      if (raw.length < 2) { statusEl.textContent = ''; return; }
      const token = ++_mcSearchToken;
      statusEl.textContent = "Recherche dans l'annuaire…";
      try {
        const estId = await CloudDB.getActiveHospitalId();
        const results = await (window.DB?.searchPatientDirectory?.(raw, estId) || Promise.resolve([]));
        if (token !== _mcSearchToken) return;
        if (!results.length) { statusEl.textContent = '⚠️ Aucun patient trouvé'; return; }
        statusEl.textContent = `${results.length} résultat(s) :`;
        if (resultsEl) {
          resultsEl.innerHTML = results.slice(0, 12).map(p =>
            `<button type="button" class="btn btn-ghost btn-xs" style="display:block;width:100%;text-align:left;margin-top:.2rem"
               onclick="HospitalLabModule._selectDirectoryPatient('${esc(p.id)}')">
               👤 ${esc(p.firstname || '')} ${esc(p.lastname || '')} — <span class="muted">${esc(p.id)}${p.phone ? ' · ' + esc(p.phone) : ''}</span>
             </button>`).join('');
        }
      } catch (e) {
        if (token !== _mcSearchToken) return;
        statusEl.textContent = '❌ Recherche impossible — vérifiez la connexion.';
      }
      return;
    }

    const token = ++_mcSearchToken;
    statusEl.textContent = 'Recherche…';
    try {
      const patient = await _lookupPatient(mc);
      if (token !== _mcSearchToken) return; // saisie modifiée entre-temps : réponse obsolète
      if (patient) {
        statusEl.textContent = '✅ Patient trouvé';
        if (nameEl && !nameEl.value.trim()) nameEl.value = `${patient.firstname || ''} ${patient.lastname || ''}`.trim();
        if (confirmWrap) confirmWrap.style.display = 'none';
      } else {
        statusEl.textContent = '⚠️ Patient introuvable';
        if (confirmWrap) confirmWrap.style.display = 'block';
      }
    } catch (e) {
      if (token !== _mcSearchToken) return;
      statusEl.textContent = '❌ Recherche impossible — vérifiez la connexion.';
    }
  }

  // Anti double-appui : écritures cloud awaitées — un second clic
  // pendant ce temps créait la demande / le résultat en double.
  let _savingOrder = false;
  async function saveOrder() {
    if (_savingOrder) return false;
    const role = _role();
    if (!_canRequestLab(role)) {
      App.toast("Votre rôle ne permet pas de créer une demande d'analyse.", 'error');
      return false;
    }

    const btn = document.getElementById('lab-save-order-btn');
    _savingOrder = true;
    _lockButton(btn, '⏳ Envoi en cours…');
    try {
      await CloudDB.requireWritableSubscription('request_lab');

      const mc = document.getElementById('lab-mc').value.trim().toUpperCase();
      if (!mc) { App.toast('Numéro MC requis.', 'error'); return false; }
      const type = document.getElementById('lab-type').value;
      if (!type) { App.toast('Type d\'analyse requis.', 'error'); return false; }
      let name = document.getElementById('lab-name').value.trim();
      const priority = document.getElementById('lab-priority')?.value === 'urgente' ? 'urgente' : 'normale';
      const clinicalNote = document.getElementById('lab-note')?.value.trim() || '';
      const selectedDoctorUid = document.getElementById('lab-doctor')?.value || '';

      const patient = await _lookupPatient(mc);
      if (!patient && !document.getElementById('lab-mc-confirm')?.checked) {
        App.toast('Patient introuvable — cochez la confirmation pour créer quand même la demande.', 'error');
        return false;
      }
      if (patient && !name) name = `${patient.firstname || ''} ${patient.lastname || ''}`.trim();

      const hospitalId = await CloudDB.getActiveHospitalId();
      const user = await CloudDB.getCurrentUserProfile();
      const requestId = DB.makeId('LAB');

      // doctorUid réservé au VRAI médecin responsable — jamais l'uid
      // d'un infirmier demandeur (corrige la confusion des deux rôles).
      const doctorUid = selectedDoctorUid || (role === 'doctor' ? user.uid : '');
      // resultRecipientUids : quiconque doit recevoir le résultat —
      // le demandeur (médecin OU infirmier) et le médecin responsable.
      const resultRecipientUids = Array.from(new Set([user.uid, doctorUid].filter(Boolean)));

      await CloudDB.createDoc('labRequests', {
        establishmentId: hospitalId,
        hospitalId, // alias — les listeners mobile filtrent sur ce nom
        patientMc: mc,
        patientName: name,
        type,
        priority,
        clinicalNote,
        status: 'requested', // statut du contrat, écouté côté mobile
        requestedByUid: user.uid,
        requestedByName: user.name || user.uid,
        requestedByRole: role,
        doctorUid,
        assignedDoctorUid: doctorUid,
        resultRecipientUids,
        createdByUid: user.uid,
        value: '', unit: '', comment: '',
      }, requestId);

      await CloudDB.createAuditLog('lab_requested', 'labRequests', requestId, { patientMc: mc, type });
      App.closeModal();
      App.toast('Demande d\'analyse envoyée.');
      HospitalDesktopUI.navigate('lab');
      return true;
    } catch (e) {
      console.error('[HospitalLab] saveOrder :', e);
      App.toast(e.message || 'Erreur lors de la demande.', 'error');
      return false;
    } finally {
      _savingOrder = false;
      _unlockButton(btn, 'Envoyer la demande');
    }
  }

  /* ── Statut & résultat ──────────────────────────── */

  let _settingStatus = false;
  async function setStatus(requestId, status) {
    if (_settingStatus) return false;
    const role = _role();
    if (!_canEnterResult(role)) {
      App.toast("Votre rôle ne permet pas cette action.", 'error');
      return false;
    }
    const req = _requests.find(x => x.id === requestId);
    if (!req) return false;
    if (!_transitionAllowed(req.status, status)) {
      App.toast('Transition de statut non autorisée.', 'error');
      return false;
    }

    const btn = document.querySelector(`[data-lab-status-btn="${requestId}"]`);
    _settingStatus = true;
    _lockButton(btn, '⏳ Mise à jour…');
    try {
      const user = await CloudDB.getCurrentUserProfile();
      const patch = { status };
      if (status === 'sample_pending' || status === 'in_progress') {
        patch.assignedLabUid = user.uid;
        patch.assignedLabName = user.name || user.uid;
      }
      if (status === 'sample_pending') patch.sampleCollectedAt = new Date().toISOString();
      if (status === 'in_progress') patch.startedAt = new Date().toISOString();

      await CloudDB.updateDoc('labRequests', requestId, patch);
      HospitalDesktopUI.navigate('lab');
      return true;
    } catch (e) {
      console.error('[HospitalLab] setStatus :', e);
      App.toast(e.message || 'Erreur.', 'error');
      return false;
    } finally {
      _settingStatus = false;
      _unlockButton(btn, '▶️ Prise en charge');
    }
  }

  function openResult(requestId) {
    const role = _role();
    if (!_canEnterResult(role)) {
      App.toast("Votre rôle ne permet pas de saisir un résultat.", 'error');
      return false;
    }
    const o = _requests.find(x => x.id === requestId);
    if (!o) return false;
    if (!_transitionAllowed(o.status, 'completed')) {
      App.toast('Ce résultat ne peut pas être saisi depuis ce statut.', 'error');
      return false;
    }
    if (!window.App?.openModal) {
      console.error('[HospitalLab] App.openModal indisponible.');
      return false;
    }
    const norm = NORMAL_RANGES[o.type];
    return App.openModal('🧪 Saisir le résultat', `
      <p><strong>${esc(o.type)}</strong> — ${esc(o.patientName || o.patientMc || '')}</p>
      <div class="form-group"><label>Valeur *</label>
        <input id="lab-value" placeholder="${norm ? `Plage normale : ${norm.min}–${norm.max} ${norm.unit}` : 'Valeur ou conclusion'}"></div>
      <div class="form-group"><label>Unité</label>
        <input id="lab-unit" value="${esc(norm?.unit || '')}"></div>
      <div class="form-group"><label>Commentaire</label>
        <textarea id="lab-comment" rows="3"></textarea></div>
      <div style="display:flex;gap:.5rem">
        <button type="button" class="btn btn-ghost btn-full" onclick="App.closeModal()">Annuler</button>
        <button type="button" class="btn btn-primary btn-full" id="lab-save-result-btn"
          onclick="HospitalLabModule.saveResult('${esc(requestId)}')">Enregistrer le résultat</button>
      </div>
    `);
  }

  // Correctif (chantier "modales laboratoire") : les 3 écritures
  // (labRequests, labResults, mc_lab_results) se faisaient auparavant
  // en 3 appels indépendants — un échec après le premier pouvait
  // laisser une demande "completed" SANS labResults/mc_lab_results
  // (résultat invisible pour le médecin/patient, mais statut déjà
  // fermé). DB.pushBatchAndReportDetailed() écrit les trois dans un
  // seul batch Firestore atomique : soit les trois existent, soit
  // aucune des trois n'est modifiée — jamais d'état intermédiaire.
  let _savingResult = false;
  async function saveResult(requestId) {
    if (_savingResult) return false;
    const role = _role();
    if (!_canEnterResult(role)) {
      App.toast("Votre rôle ne permet pas de saisir un résultat.", 'error');
      return false;
    }
    const req = _requests.find(x => x.id === requestId);
    if (!req) return false;
    if (!_transitionAllowed(req.status, 'completed')) {
      App.toast('Ce résultat ne peut pas être enregistré depuis ce statut.', 'error');
      return false;
    }

    const btn = document.getElementById('lab-save-result-btn');
    const value = document.getElementById('lab-value')?.value.trim();
    if (!value) { App.toast('Valeur requise.', 'error'); return false; }
    const unit = document.getElementById('lab-unit')?.value.trim() || '';
    const comment = document.getElementById('lab-comment')?.value.trim() || '';

    _savingResult = true;
    _lockButton(btn, '⏳ Enregistrement…');
    try {
      await CloudDB.requireWritableSubscription('add_lab_result');

      const hospitalId = await CloudDB.getActiveHospitalId();
      const user = await CloudDB.getCurrentUserProfile();
      const now = new Date().toISOString();
      const resultId = DB.makeId('LABR');
      const sourceDevice = window.ExchangeBridge?.currentSourceDevice?.() || 'desktop';

      // req.id vient de CloudDB.listByHospital ({id, ...data}) — jamais
      // écrit tel quel dans labRequests (ce n'est pas un champ du
      // document), sous peine de créer un champ "id" imprévu qui ferait
      // échouer la restriction de champs des règles Firestore (diff
      // affectedKeys hasOnly).
      const { id: _drop, ...reqData } = req;

      const resultRecipientUids = Array.from(new Set([
        ...(Array.isArray(req.resultRecipientUids) ? req.resultRecipientUids : []),
        req.requestedByUid,
        req.doctorUid,
      ].filter(Boolean)));

      const report = await DB.pushBatchAndReportDetailed([
        ['labRequests', requestId, {
          ...reqData,
          value, unit, comment,
          status: 'completed',
          completedAt: now,
          completedByUid: user.uid,
          completedByName: user.name || user.uid,
          completedByRole: role,
          updatedAt: now,
        }],
        ['labResults', resultId, {
          labRequestId: requestId,
          establishmentId: hospitalId,
          hospitalId,
          patientMc: req.patientMc || '',
          patientName: req.patientName || '',
          type: req.type || '',
          value, unit, comment,
          requestedByUid: req.requestedByUid || '',
          assignedDoctorUid: req.doctorUid || req.assignedDoctorUid || '',
          doctorUid: req.doctorUid || req.requestedByUid || '',
          resultRecipientUids,
          completedByUid: user.uid,
          completedByRole: role,
          sourceDevice,
          createdAt: now,
          updatedAt: now,
        }],
        ['mc_lab_results', resultId, {
          patient_id: req.patientMc || '',
          patient_uid: window.DB?.getPatients?.()?.find(p => p.id === req.patientMc)?.patient_uid ||
            window.DB?.getPatients?.()?.find(p => p.id === req.patientMc)?.patientAuthUid || '',
          establishmentId: hospitalId,
          hospital_id: hospitalId,
          labRequestId: requestId,
          type: req.type || '',
          value, unit, notes: comment,
          created_by: user.uid,
          sourceDevice,
          createdAt: now,
        }],
      ], { timeoutMs: 15000, label: 'Résultat labo' });

      if (!report.ok) {
        // Ne jamais afficher "Résultat enregistré" ni fermer la modale :
        // le batch a échoué en bloc, la demande reste dans son ancien
        // statut, les données saisies restent visibles pour réessayer.
        const reason = report.timedOut
          ? 'La confirmation a expiré. Vérifiez la connexion et réessayez.'
          : 'Firestore a refusé l\'enregistrement. Réessayez.';
        App.toast(`Résultat NON enregistré — ${reason}`, 'error');
        return false;
      }

      await CloudDB.createAuditLog('lab_result_added', 'labRequests', requestId, {});
      App.closeModal();
      App.toast('Résultat enregistré.');
      HospitalDesktopUI.navigate('lab');
      return true;
    } catch (e) {
      console.error('[HospitalLab] saveResult :', e);
      App.toast(e.message || 'Erreur lors de l\'enregistrement.', 'error');
      return false;
    } finally {
      _savingResult = false;
      _unlockButton(btn, 'Enregistrer le résultat');
    }
  }

  return { render, openNew, saveOrder, setStatus, openResult, saveResult, _searchPatient, _selectDirectoryPatient };
})();

window.HospitalLabModule = HospitalLabModule;
