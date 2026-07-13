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

  async function render(container) {
    HospitalPermissions.requireRoute('beds');
    const hospitalId = await CloudDB.getActiveHospitalId();

    container.innerHTML = `<div class="card empty-state"><p>Chargement des lits…</p></div>`;

    try {
      [_beds, _admissions] = await Promise.all([
        CloudDB.listByHospital('beds', hospitalId),
        CloudDB.listByHospital('admissions', hospitalId),
      ]);
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

  async function saveAdmission() {
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
      const bed = _beds.find(b => b.id === bedId);
      if (!bed || bed.status !== 'free') { App.toast('Ce lit n\'est plus disponible.', 'error'); return; }

      const admissionId = DB.makeId('ADM');
      await CloudDB.createDoc('admissions', {
        establishmentId: hospitalId,
        hospitalId,
        patientMc: mc,
        patientName: name,
        bedId,
        ward: bed.ward || '',
        reason,
        status: 'admitted',
        admittedAt: new Date().toISOString(),
        dischargedAt: '',
      }, admissionId);

      await CloudDB.updateDoc('beds', bedId, { status: 'occupied' });
      await CloudDB.createAuditLog('patient_admitted', 'admissions', admissionId, { patientMc: mc, bedId });

      // Miroir vers mc_admissions — correctif (audit) : sans lui, le
      // filtre "🏥 Hospitalisation" du dossier patient (js/timeline.js)
      // n'est jamais alimenté (admissions n'est lu que côté desktop).
      if (window.DB?.addAdmissionRecord) {
        const patient = window.DB.getPatients?.().find(p => p.id === mc);
        DB.addAdmissionRecord({
          patient_id: mc,
          patient_uid: patient?.patient_uid || patient?.patientAuthUid || '',
          bedId, ward: bed.ward || '', reason,
          status: 'admitted',
          admittedAt: new Date().toISOString(),
          hospital_id: hospitalId, establishmentId: hospitalId,
        });
      }

      App.closeModal();
      App.toast('Patient admis.');
      HospitalDesktopUI.navigate('beds');
    } catch (e) {
      console.error('[Beds] saveAdmission :', e);
      App.toast(e.message || 'Erreur lors de l\'admission.', 'error');
    }
  }

  async function discharge(admissionId) {
    try {
      if (!window.HospitalCapabilities?.guardHospitalAction?.('discharge_patient')) return;
      const adm = _admissions.find(a => a.id === admissionId);
      if (!adm) return;
      if (!confirm(`Confirmer la sortie de ${adm.patientName || adm.patientMc} ?`)) return;

      await CloudDB.updateDoc('admissions', admissionId, {
        status: 'discharged',
        dischargedAt: new Date().toISOString(),
      });
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

  return { render, openAddBed, saveBed, toggleMaintenance, openAdmit, saveAdmission, discharge };
})();

window.HospitalBedsModule = HospitalBedsModule;
