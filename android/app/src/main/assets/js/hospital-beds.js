/* =====================================================
   MedConnect 2.0 — HospitalBedsModule (bundle desktop, recréé)
   Hospitalisation : lits, admissions, sorties, occupation.

   Recréé selon la logique du projet (l'original du bundle
   n'a pas pu être récupéré) :
   - Collections : beds, admissions (champ canonique
     establishmentId + alias hospitalId, sourceDevice injecté
     par CloudDB — règles Firestore ajoutées en conséquence) ;
   - Patients identifiés par leur numéro MC (MC-YYYY-CC-XXXXXXXX),
     jamais par un identifiant parallèle ;
   - Gating abonnement via ExchangeBridge : l'admission réutilise
     l'action 'create_consultation' (acte de soin — bloqué en
     desktop expiré, jamais coupé côté mobile, contrat à deux
     vitesses existant) ;
   - Modale/toast : App.openModal / App.toast existants.
   ===================================================== */
const HospitalBedsModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const BED_STATUS = {
    free:        { label: 'Libre',       icon: '🟢' },
    occupied:    { label: 'Occupé',      icon: '🔴' },
    maintenance: { label: 'Maintenance', icon: '🟡' },
  };

  let _beds = [];
  let _admissions = [];
  let _preAdmissions = [];

  async function render(container) {
    HospitalPermissions.requireRoute('beds');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement des lits…</p></div>`;

    try {
      let receptionVisits = [];
      [_beds, _admissions, receptionVisits] = await Promise.all([
        CloudDB.listByHospital('beds', hospitalId),
        CloudDB.listByHospital('admissions', hospitalId),
        // Chantier sécurité (section 6) : la réception ne crée plus
        // qu'une PRÉ-ADMISSION (receptionVisit) — cet écran (déjà
        // réservé à doctor/nurse/admin_hospital/admin, voir
        // js/hospital-permissions.js ROUTES.beds) est le seul endroit
        // où confirmer réellement une admission.
        CloudDB.listByHospital('receptionVisits', hospitalId),
      ]);
      _preAdmissions = receptionVisits.filter(v => v.status === 'pre_admission');
    } catch (e) {
      console.error('[Beds] Chargement :', e);
      container.innerHTML = `<div class="card empty-state"><p>Erreur de chargement : ${esc(e.message)}</p></div>`;
      return;
    }

    const active = _admissions.filter(a => a.status === 'admitted');
    const total = _beds.length;
    const occupied = _beds.filter(b => b.status === 'occupied').length;
    const free = _beds.filter(b => b.status === 'free').length;

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Hospitalisation / Lits</h1><p>Occupation et admissions en cours</p></div>
        <div>
          <button class="btn btn-ghost btn-sm" onclick="HospitalBedsModule.openAddBed()">+ Lit</button>
          <button class="btn btn-primary btn-sm" onclick="HospitalBedsModule.openAdmit()">+ Admission</button>
        </div>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${total}</h3><p>Lits au total</p></div>
        <div class="hospital-stat-card"><h3>${free}</h3><p>🟢 Libres</p></div>
        <div class="hospital-stat-card"><h3>${occupied}</h3><p>🔴 Occupés</p></div>
        <div class="hospital-stat-card"><h3>${active.length}</h3><p>Patients hospitalisés</p></div>
      </div>

      ${_preAdmissions.length ? `
      <div class="card">
        <h3>🕓 Pré-admissions en attente (${_preAdmissions.length})</h3>
        <div class="records-list">
          ${_preAdmissions.sort((a,b) => String(a.admissionRequestedAt||'').localeCompare(String(b.admissionRequestedAt||'')))
            .map(v => preAdmissionCard(v)).join('')}
        </div>
      </div>` : ''}

      <div class="card">
        <h3>Lits</h3>
        ${!total ? `<p class="muted">Aucun lit enregistré. Ajoutez les lits de l'établissement pour commencer.</p>` : `
        <div class="beds-grid">
          ${_beds.sort((a,b) => String(a.ward||'').localeCompare(String(b.ward||'')) || String(a.number||'').localeCompare(String(b.number||''), undefined, {numeric:true}))
            .map(b => bedCard(b)).join('')}
        </div>`}
      </div>

      <div class="card">
        <h3>Admissions en cours</h3>
        ${!active.length ? `<p class="muted">Aucun patient hospitalisé actuellement.</p>` : `
        <div class="records-list">
          ${active.sort((a,b) => String(b.admittedAt||'').localeCompare(String(a.admittedAt||'')))
            .map(a => admissionCard(a)).join('')}
        </div>`}
      </div>
    `;
  }

  function preAdmissionCard(v) {
    return `
      <div class="card record-card">
        <p><strong>${esc(v.patientName || '—')}</strong> · ${esc(v.patientMc || '')}</p>
        <p class="muted">Lit demandé : ${esc(v.requestedBedLabel || '—')} · Motif : ${esc(v.reason || '—')}</p>
        <button class="btn btn-primary btn-sm" onclick="HospitalBedsModule.confirmAdmission('${esc(v.id)}')">✅ Confirmer l'admission</button>
      </div>`;
  }

  function bedCard(b) {
    const st = BED_STATUS[b.status] || BED_STATUS.free;
    const adm = b.status === 'occupied'
      ? _admissions.find(a => a.bedId === b.id && a.status === 'admitted') : null;
    return `
      <div class="bed-card bed-${esc(b.status || 'free')}">
        <div class="bed-card-head">${st.icon} <strong>Lit ${esc(b.number || '—')}</strong></div>
        <p>${esc(b.ward || 'Service non précisé')}</p>
        <p class="muted">${st.label}${adm ? ' · ' + esc(adm.patientName || adm.patientMc || '') : ''}</p>
        ${b.status !== 'occupied' ? `
          <button class="btn btn-ghost btn-sm"
            onclick="HospitalBedsModule.toggleMaintenance('${esc(b.id)}')">
            ${b.status === 'maintenance' ? 'Remettre en service' : 'Maintenance'}
          </button>` : ''}
      </div>`;
  }

  function admissionCard(a) {
    const bed = _beds.find(b => b.id === a.bedId);
    return `
      <div class="card record-card">
        <p><strong>${esc(a.patientName || '—')}</strong> · ${esc(a.patientMc || '')}</p>
        <p>🛏️ Lit ${esc(bed?.number || '—')} — ${esc(bed?.ward || a.ward || '')}</p>
        <p class="muted">Admis le ${esc(String(a.admittedAt || '').slice(0,10))} · Motif : ${esc(a.reason || '—')}</p>
        <button class="btn btn-ghost btn-sm" style="color:var(--secondary)"
          onclick="HospitalBedsModule.discharge('${esc(a.id)}')">✅ Sortie du patient</button>
      </div>`;
  }

  /* ── Lits ───────────────────────────────────────── */

  function openAddBed() {
    App.openModal('➕ Ajouter un lit', `
      <div class="form-group"><label>Numéro du lit *</label>
        <input id="bed-number" placeholder="Ex : A-12"></div>
      <div class="form-group"><label>Service</label>
        <input id="bed-ward" placeholder="Ex : Pédiatrie, Maternité, Urgences…"></div>
      <button class="btn btn-primary btn-full" onclick="HospitalBedsModule.saveBed()">Enregistrer</button>
    `);
  }

  async function saveBed() {
    try {
      // Correctif (audit) : ni saveBed() ni toggleMaintenance() ne
      // vérifiaient la capacité 'manage_beds' (réservée à admin_hospital
      // et nurse — PAS doctor, voir MATRIX), contrairement à
      // saveAdmission()/discharge() ci-dessous qui suivent déjà ce
      // principe. Un médecin pouvait ainsi ajouter un lit ou le
      // basculer en maintenance alors que la matrice de capacités
      // l'exclut.
      if (!window.HospitalCapabilities?.guardHospitalAction?.('manage_beds')) return;
      // Pré-contrôle client : le serveur (hospitalCanWriteFromDevice)
      // bloquera de toute façon en desktop expiré — ceci donne un
      // message clair au lieu de l'erreur Firestore brute.
      await CloudDB.requireWritableSubscription('create_consultation');

      const number = document.getElementById('bed-number').value.trim();
      if (!number) { App.toast('Numéro du lit requis.', 'error'); return; }
      const ward = document.getElementById('bed-ward').value.trim();
      const hospitalId = await CloudDB.getActiveHospitalId();

      await CloudDB.createDoc('beds', {
        establishmentId: hospitalId,
        hospitalId,
        number, ward,
        status: 'free',
      }, DB.makeId('BED'));

      await CloudDB.createAuditLog('bed_created', 'beds', number, { ward });
      App.closeModal();
      App.toast('Lit ajouté.');
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] saveBed :', e);
      App.toast(e.message || 'Erreur lors de l\'ajout du lit.', 'error');
    }
  }

  async function toggleMaintenance(bedId) {
    try {
      // Correctif (audit) : même garde que saveBed() ci-dessus.
      if (!window.HospitalCapabilities?.guardHospitalAction?.('manage_beds')) return;
      const bed = _beds.find(b => b.id === bedId);
      if (!bed) return;
      const next = bed.status === 'maintenance' ? 'free' : 'maintenance';
      await CloudDB.updateDoc('beds', bedId, { status: next });
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] toggleMaintenance :', e);
      App.toast(e.message || 'Erreur.', 'error');
    }
  }

  /* ── Admissions ─────────────────────────────────── */

  function openAdmit() {
    const freeBeds = _beds.filter(b => b.status === 'free');
    if (!freeBeds.length) {
      App.toast('Aucun lit libre disponible.', 'error');
      return;
    }
    App.openModal('🛏️ Nouvelle admission', `
      <div class="form-group"><label>Numéro MC du patient *</label>
        <input id="adm-mc" placeholder="MC-2026-CD-XXXXXXXX"></div>
      <div class="form-group"><label>Nom du patient</label>
        <input id="adm-name" placeholder="Rempli automatiquement si le patient est connu"></div>
      <div class="form-group"><label>Lit *</label>
        <select id="adm-bed">
          ${freeBeds.map(b => `<option value="${esc(b.id)}">Lit ${esc(b.number)} — ${esc(b.ward || '')}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Motif d'admission</label>
        <input id="adm-reason"></div>
      <button class="btn btn-primary btn-full" onclick="HospitalBedsModule.saveAdmission()">Admettre</button>
    `);
  }

  // Anti double-appui : plusieurs écritures cloud awaitées — un second
  // clic pendant ce temps créait l'admission en double.
  let _savingAdmission = false;
  async function saveAdmission() {
    if (_savingAdmission) return;
    _savingAdmission = true;
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('admit_patient')) return;
      // Admission = acte desktop sous abonnement (même gating que
      // la consultation : bloqué si expiré côté desktop uniquement).
      await CloudDB.requireWritableSubscription('create_consultation');

      const mc = document.getElementById('adm-mc').value.trim().toUpperCase();
      if (!mc) { App.toast('Numéro MC requis.', 'error'); return; }
      let name = document.getElementById('adm-name').value.trim();
      const bedId = document.getElementById('adm-bed').value;
      const reason = document.getElementById('adm-reason').value.trim();

      // Complète le nom depuis le dossier local si le patient est connu.
      if (!name && window.DB?.getPatients) {
        const p = DB.getPatients().find(x => String(x.id || '').toUpperCase() === mc);
        if (p) name = `${p.firstname || ''} ${p.lastname || ''}`.trim();
      }

      const hospitalId = await CloudDB.getActiveHospitalId();
      const admissionId = DB.makeId('ADM');
      const admittedAt = new Date().toISOString();

      // Correctif (audit "workflows mobile/desktop", section 12) : bug
      // confirmé — le lit était vérifié via le CACHE LOCAL (_beds),
      // potentiellement périmé, puis écrit en deux appels séparés
      // (createDoc puis updateDoc, non atomiques) : deux admissions
      // concurrentes pouvaient double-réserver le même lit. Même
      // correctif que confirmAdmission() ci-dessus — assignBedTransaction()
      // relit le lit dans une vraie transaction Firestore.
      let txResult;
      try {
        txResult = await CloudDB.assignBedTransaction({
          bedId,
          admissionId,
          admissionData: {
            establishmentId: hospitalId, hospitalId,
            patientMc: mc, patientName: name, bedId,
            reason, status: 'admitted', admittedAt, dischargedAt: '',
          },
        });
      } catch (txErr) {
        if (txErr?.code === 'bed_not_free' || txErr?.code === 'bed_not_found') {
          App.toast('Ce lit n\'est plus disponible.', 'error');
          return;
        }
        console.error('[Beds] saveAdmission — transaction :', txErr);
        App.toast("L'admission n'a pas pu être confirmée par Firestore. Vérifiez la connexion puis réessayez.", 'error');
        return;
      }
      const bed = txResult.bed;
      try {
        await CloudDB.updateDoc('admissions', admissionId, { ward: bed.ward || '' });
      } catch (wardErr) {
        console.warn('[Beds] saveAdmission — complément ward :', wardErr);
      }
      await CloudDB.createAuditLog('patient_admitted', 'admissions', admissionId, { patientMc: mc, bedId });

      // Miroir vers mc_admissions — correctif (audit) : sans lui, le
      // filtre "🏥 Hospitalisation" du dossier patient (js/timeline.js)
      // n'est jamais alimenté (admissions n'est lu que côté desktop).
      if (window.DB?.addAdmissionRecord) {
        const patient = window.DB.getPatients?.().find(p => p.id === mc);
        DB.addAdmissionRecord({
          // sourceAdmissionId : lien vers l'admission desktop, pour que
          // la sortie (discharge) puisse retrouver et mettre à jour ce
          // miroir (sinon le patient voit l'hospitalisation "en cours").
          sourceAdmissionId: admissionId,
          patient_id: mc,
          patient_uid: patient?.patient_uid || patient?.patientAuthUid || '',
          bedId, ward: bed.ward || '', reason,
          status: 'admitted',
          admittedAt,
          hospital_id: hospitalId, establishmentId: hospitalId,
        });
      }

      App.closeModal();
      App.toast('Patient admis.');
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] saveAdmission :', e);
      App.toast(e.message || 'Erreur lors de l\'admission.', 'error');
    } finally { _savingAdmission = false; }
  }

  /* ── Confirmer une pré-admission (chantier sécurité, section 6) ──
     Seul endroit qui crée réellement une admission/occupe un lit à
     partir d'une prise en charge réception — jamais réception
     elle-même (rôle sans admit_patient/manage_beds). Écriture en UN
     SEUL batch atomique (admissions + beds + receptionVisits) : soit
     les 3 documents changent ensemble, soit aucun. Le mirroir
     mc_admissions reste best-effort (comme respondAffiliation) — un
     échec n'annule jamais l'admission déjà confirmée.
     Limite connue (documentée, pas de transaction Firestore
     introduite pour ce chantier — aucun précédent dans ce fichier) :
     la vérification "lit encore libre" est une lecture PUIS un batch,
     pas une transaction ; une fenêtre de course résiduelle existe si
     deux soignants confirment la même pré-admission en même temps sur
     le même lit dans la même seconde — accepté comme limite connue,
     cf. rapport final. */
  let _confirmingAdmission = false;
  async function confirmAdmission(visitId, overrideBedId) {
    if (_confirmingAdmission) return;
    _confirmingAdmission = true;
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('admit_patient')) return;
      const visit = _preAdmissions.find(v => v.id === visitId);
      if (!visit) { App.toast('Pré-admission introuvable — rechargez la page.', 'error'); return; }

      const bedId = overrideBedId || visit.requestedBedId;
      if (!bedId) { App.toast('Aucun lit associé à cette pré-admission.', 'error'); return; }

      // Admission = acte desktop sous abonnement (même gating que
      // hospital-beds.js saveAdmission()).
      await CloudDB.requireWritableSubscription('create_consultation');

      const hospitalId = await CloudDB.getActiveHospitalId();
      const admissionId = DB.makeId('ADM');
      const admittedAt = new Date().toISOString();

      // Correctif (audit "workflows mobile/desktop", section 12) : bug
      // confirmé — le lit était lu ICI puis écrit séparément dans le
      // batch plus bas ; deux confirmations concurrentes pouvaient
      // toutes deux lire "libre" avant que l'une ou l'autre n'écrive,
      // double-réservant le même lit. assignBedTransaction() relit le
      // lit DANS une vraie transaction Firestore et échoue entièrement
      // si son statut n'est plus 'free' au moment de l'écriture.
      let txResult;
      try {
        txResult = await CloudDB.assignBedTransaction({
          bedId,
          admissionId,
          admissionData: {
            establishmentId: hospitalId, hospitalId,
            patientMc: visit.patientMc,
            patientName: visit.patientName || '',
            bedId, reason: visit.reason || '',
            doctorUid: visit.doctorUid || '', doctorName: visit.doctorName || '',
            status: 'admitted', admittedAt, dischargedAt: '',
            sourceReceptionVisitId: visitId,
          },
          visitId,
          visitUpdate: {
            status: 'hospitalized', admissionStatus: 'approved',
            bedId,
            admissionConfirmedAt: admittedAt,
            admissionConfirmedByUid: window.Auth?.getUser?.()?.uid || '',
          },
        });
      } catch (txErr) {
        if (txErr?.code === 'bed_not_free' || txErr?.code === 'bed_not_found') {
          App.toast("Ce lit n'est plus disponible — choisissez-en un autre.", 'error');
          openPickAnotherBed(visitId);
          return;
        }
        console.error('[Beds] confirmAdmission — transaction :', txErr);
        App.toast("L'admission n'a pas pu être confirmée par Firestore. Vérifiez la connexion puis réessayez.", 'error');
        return;
      }
      const bed = txResult.bed;
      // ward/bedLabel dépendent de `bed` (résolu par la transaction) —
      // complétés après coup, pas dans les données de la transaction
      // elle-même (admissionData.ward et receptionVisits.bedLabel
      // avaient besoin de bed.ward, connu seulement après lecture).
      try {
        await CloudDB.updateDoc('admissions', admissionId, { ward: bed.ward || visit.requestedBedLabel || '' });
        await CloudDB.updateDoc('receptionVisits', visitId, {
          bedLabel: bed.ward ? `Lit ${bed.number || ''} — ${bed.ward}` : (visit.requestedBedLabel || ''),
        });
      } catch (wardErr) {
        console.warn('[Beds] confirmAdmission — complément ward/bedLabel :', wardErr);
      }

      // Miroir vers mc_admissions (best-effort, comme saveAdmission()) —
      // sans lui, le patient ne voit jamais cette hospitalisation.
      if (window.DB?.addAdmissionRecord) {
        try {
          DB.addAdmissionRecord({
            sourceAdmissionId: admissionId,
            patient_id: visit.patientMc,
            patient_uid: '',
            bedId, ward: bed.ward || '', reason: visit.reason || '',
            status: 'admitted', admittedAt,
            hospital_id: hospitalId, establishmentId: hospitalId,
          });
        } catch (mirrorErr) {
          console.warn('[Beds] confirmAdmission — miroir mc_admissions :', mirrorErr);
        }
      }

      await CloudDB.createAuditLog('reception_admission_confirmed', 'admissions', admissionId, { patientMc: visit.patientMc, bedId, visitId });
      App.toast('✅ Admission confirmée.');
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] confirmAdmission :', e);
      App.toast(e.message || "Erreur lors de la confirmation de l'admission.", 'error');
    } finally { _confirmingAdmission = false; }
  }

  // Lit demandé indisponible entre-temps : la pré-admission reste en
  // l'état (jamais perdue) — on propose simplement d'en choisir un
  // autre parmi les lits actuellement libres.
  function openPickAnotherBed(visitId) {
    const freeBeds = _beds.filter(b => b.status === 'free');
    if (!freeBeds.length) {
      App.toast('Aucun autre lit libre disponible pour le moment.', 'error');
      return;
    }
    App.openModal('🛏️ Choisir un autre lit', `
      <div class="form-group"><label>Lit *</label>
        <select id="pab-bed">
          ${freeBeds.map(b => `<option value="${esc(b.id)}">Lit ${esc(b.number)} — ${esc(b.ward || '')}</option>`).join('')}
        </select></div>
      <button class="btn btn-primary btn-full" onclick="HospitalBedsModule.confirmAdmissionWithBed('${esc(visitId)}')">Confirmer l'admission</button>
    `);
  }

  function confirmAdmissionWithBed(visitId) {
    const bedId = document.getElementById('pab-bed')?.value;
    if (!bedId) return;
    App.closeModal();
    confirmAdmission(visitId, bedId);
  }

  async function discharge(admissionId) {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('discharge_patient')) return;
      const adm = _admissions.find(a => a.id === admissionId);
      if (!adm) return;
      if (!confirm(`Confirmer la sortie de ${adm.patientName || adm.patientMc} ?`)) return;

      const dischargedAt = new Date().toISOString();
      await CloudDB.updateDoc('admissions', admissionId, {
        status: 'discharged',
        dischargedAt,
      });
      // Miroir patient : reflète la sortie dans mc_admissions pour que la
      // Timeline du patient affiche "· Sortie" au lieu d'une
      // hospitalisation perpétuellement "en cours".
      DB.updateAdmissionRecord?.(admissionId, { status: 'discharged', dischargedAt });
      if (adm.bedId) {
        await CloudDB.updateDoc('beds', adm.bedId, { status: 'free' });
      }
      await CloudDB.createAuditLog('patient_discharged', 'admissions', admissionId, { patientMc: adm.patientMc });

      App.toast('Sortie enregistrée.');
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] discharge :', e);
      App.toast(e.message || 'Erreur lors de la sortie.', 'error');
    }
  }

  return { render, openAddBed, saveBed, toggleMaintenance, openAdmit, saveAdmission, discharge, confirmAdmission, confirmAdmissionWithBed };
})();

window.HospitalBedsModule = HospitalBedsModule;
