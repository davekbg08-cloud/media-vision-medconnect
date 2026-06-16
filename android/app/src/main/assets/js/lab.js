/* =====================================================
   MedConnect 2.0 — Module Laboratoire
   Analyses sanguines, résultats, historique
   ===================================================== */
const LabModule = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

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
    'Glycémie à jeun':   { min:0.7, max:1.1, unit:'g/L' },
    'CRP (Protéine C-réactive)': { min:0, max:5, unit:'mg/L' },
  };

  function patientName(p) {
    if (!p) return '';
    return `${p.firstname || p.prenom || ''} ${p.lastname || p.nom || ''}`.trim();
  }

  function currentEstablishmentFields() {
    const user = Auth.getUser() || {};
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return {
      created_by: user.uid || '',
      hospital_id: h?.establishmentId || h?.hid || '',
      establishmentId: h?.establishmentId || h?.hid || '',
      establishmentName: h?.name || '',
    };
  }

  function patientsForContext() {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return DB.getPatients();
    return window.HospitalsRegistry?.getPatientsForContext?.(user.uid) ||
      DB.getPatients().filter(p => !p.created_by || p.created_by === user.uid);
  }

  function labResultsForContext() {
    const user = Auth.getUser() || {};
    if (user.role === 'admin') return DB.getAllLabResults();
    const patientIds = new Set(patientsForContext().map(p => p.id));
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return DB.getAllLabResults().filter(l =>
      patientIds.has(l.patient_id) ||
      l.created_by === user.uid ||
      (h && (l.establishmentId === h.establishmentId || l.hospital_id === h.establishmentId)));
  }

  function canUseLabResult(result) {
    if (!result) return false;
    if (Auth.getUser()?.role === 'admin') return true;
    return labResultsForContext().some(l => l.lid === result.lid);
  }

  /* ── RENDER (hospital side) ─────────────────────── */
  function renderForHospital(main) {
    const results = labResultsForContext().sort((a,b)=>b.date.localeCompare(a.date));
    main.innerHTML = `
      <div class="page-header">
        <h2>🧪 Laboratoire</h2>
        <button class="btn btn-primary btn-sm" onclick="LabModule.openNew()">+ Nouveau résultat</button>
      </div>
      ${!results.length ? `<div class="card empty-state"><p>Aucune analyse</p></div>` : ''}
      <div class="records-list">
        ${results.map(l => labCard(l)).join('')}
      </div>`;
  }

  /* ── RENDER (patient side) ─────────────────────── */
  function renderForPatient(main, patientId) {
    const results = DB.getPatientLabResults(patientId).sort((a,b)=>b.date.localeCompare(a.date));
    main.innerHTML = `
      <div class="page-header"><h2>🧪 Mes Analyses</h2></div>
      ${!results.length ? `<div class="card empty-state"><p>Aucune analyse disponible</p></div>` : ''}
      <div class="records-list">
        ${results.map(l => labCard(l)).join('')}
      </div>`;
  }

  function labCard(l) {
    const p   = DB.getPatientById(l.patient_id);
    const norm = NORMAL_RANGES[l.type];
    const val  = parseFloat(l.value);
    let   flag = '';
    if (norm && !isNaN(val)) {
      flag = val < norm.min ? ' 🔵 Bas' : val > norm.max ? ' 🔴 Élevé' : ' ✅ Normal';
    }
    return `
      <div class="record-card lab-card">
        <div class="record-header">
          <span>🧪</span>
          <strong>${esc(l.type)}</strong>
          <span class="record-date">📅 ${l.date}</span>
          ${p ? `<span class="id-tag">${p.id}</span>` : ''}
          <span class="record-doctor">👨‍⚕️ ${esc(l.doctor)||'—'}</span>
        </div>
        ${l.value ? `<p style="font-size:.9rem;font-weight:600">
          Valeur : ${l.value} ${norm?norm.unit:''}<span style="color:${flag.includes('Élevé')?'var(--danger)':flag.includes('Bas')?'var(--primary)':'var(--secondary)'}">${flag}</span>
        </p>` : ''}
        ${l.results?.length ? `
          <table class="lab-table">
            <thead><tr><th>Paramètre</th><th>Valeur</th><th>Référence</th></tr></thead>
            <tbody>
              ${l.results.map(r=>`<tr>
                <td>${esc(r.param)}</td>
                <td style="font-weight:600">${esc(r.value)}</td>
                <td style="color:var(--text-muted)">${esc(r.ref)||'—'}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : ''}
        ${l.notes ? `<p style="font-size:.82rem;color:var(--text-muted);margin-top:.4rem"><em>${esc(l.notes)}</em></p>` : ''}
        <div style="display:flex;gap:.4rem;margin-top:.5rem">
          <button class="btn btn-ghost btn-xs" onclick="LabModule.printResult('${l.lid}')">🖨️ Imprimer</button>
          <button class="btn btn-ghost btn-xs" onclick="LabModule.deleteResult('${l.lid}')">🗑️</button>
        </div>
      </div>`;
  }

  /* ── NEW RESULT FORM ────────────────────────────── */
  function openNew(prefillPatientId) {
    const patients = patientsForContext();
    App.openModal('🧪 Nouveau Résultat d\'Analyse', `
      <form onsubmit="LabModule.save(event)">
        <div class="form-group">
          <label>Patient *</label>
          <select id="l-pid" required>
            <option value="">— Patient —</option>
            ${patients.map(p=>`<option value="${p.id}" ${p.id===prefillPatientId?'selected':''}>${esc(patientName(p))} — ${p.id}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Type d'analyse *</label>
          <select id="l-type" required>
            <option value="">—</option>
            ${LAB_TYPES.map(lt=>`<option value="${lt}">${lt}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Médecin prescripteur</label><input type="text" id="l-doc" value="${Auth.getUser()?.role==='doctor'?esc(Auth.getUser().name):''}"></div>
        <div class="form-group"><label>Date *</label><input type="date" id="l-date" value="${new Date().toISOString().slice(0,10)}" required></div>
        <div class="form-group"><label>Valeur principale</label><input type="text" id="l-val" placeholder="ex: 0.95 g/L"></div>
        <div class="form-group full-width"><label>Notes / Interprétation</label><textarea id="l-notes" rows="3"></textarea></div>

        <div style="border-top:1px solid var(--border);padding-top:.75rem;margin-top:.25rem">
          <label style="font-size:.8rem;color:var(--text-muted)">Paramètres détaillés</label>
          <div id="lab-params"></div>
          <button type="button" class="btn btn-ghost btn-xs" style="margin-top:.4rem" onclick="LabModule.addParam()">+ Ajouter paramètre</button>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">💾 Enregistrer</button>
        </div>
      </form>`);
  }

  function addParam() {
    const div = document.createElement('div');
    div.className = 'rx-item';
    div.innerHTML = `
      <input type="text" class="l-param-name"  placeholder="Paramètre (ex: Hémoglobine)" style="flex:2">
      <input type="text" class="l-param-value" placeholder="Valeur" style="flex:1">
      <input type="text" class="l-param-ref"   placeholder="Référence" style="flex:1">
      <button type="button" class="btn btn-ghost btn-xs" onclick="this.parentElement.remove()">✕</button>`;
    document.getElementById('lab-params').appendChild(div);
  }

  function save(e) {
    e.preventDefault();
    const results = [...document.querySelectorAll('.rx-item')].map(el => ({
      param: el.querySelector('.l-param-name')?.value,
      value: el.querySelector('.l-param-value')?.value,
      ref:   el.querySelector('.l-param-ref')?.value,
    })).filter(r => r.param?.trim());

    DB.addLabResult({
      patient_id: document.getElementById('l-pid').value,
      type:       document.getElementById('l-type').value,
      doctor:     document.getElementById('l-doc').value,
      date:       document.getElementById('l-date').value,
      value:      document.getElementById('l-val').value,
      notes:      document.getElementById('l-notes').value,
      results,
      ...currentEstablishmentFields(),
    });

    // Notify patient
    const pid = document.getElementById('l-pid').value;
    if (window.Network?.notify) {
      Network.notify({
        to_role:'patient', to_id:pid, type:'info',
        subject:`🧪 Résultats d'analyse disponibles`,
        body:`Vos résultats pour "${document.getElementById('l-type').value}" sont disponibles.`,
      });
    }

    App.closeModal();
    App.toast('✅ Résultat enregistré');
    if (window.App?.navigateTo) App.navigateTo('lab');
  }

  function printResult(lid) {
    const l = DB.getAllLabResults().find(x => x.lid === lid); if (!l) return;
    if (!canUseLabResult(l)) { App.toast('Accès analyse non autorisé.', 'error'); return; }
    const p = DB.getPatientById(l.patient_id);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Analyse</title>
      <style>body{font-family:Arial,sans-serif;max-width:700px;margin:auto;padding:20px}h1{color:#0EA5E9}
      table{width:100%;border-collapse:collapse;margin:1rem 0}td,th{border:1px solid #ccc;padding:8px;font-size:.88em}th{background:#f0f9ff}</style></head><body>
      <h1>🧪 MedConnect — Résultat d'Analyse</h1>
      ${p?`<p><strong>Patient :</strong> ${esc(patientName(p))} <code>${p.id}</code></p>`:''}
      <p><strong>Analyse :</strong> ${esc(l.type)} | <strong>Date :</strong> ${l.date} | <strong>Dr :</strong> ${esc(l.doctor)||'—'}</p>
      ${l.value?`<p><strong>Valeur :</strong> ${esc(l.value)}</p>`:''}
      ${l.results?.length?`<table><thead><tr><th>Paramètre</th><th>Valeur</th><th>Référence</th></tr></thead>
      <tbody>${l.results.map(r=>`<tr><td>${esc(r.param)}</td><td>${esc(r.value)}</td><td>${esc(r.ref)||'—'}</td></tr>`).join('')}</tbody></table>`:''}
      ${l.notes?`<p><em>${esc(l.notes)}</em></p>`:''}
      <p style="color:#94a3b8;font-size:.8em;margin-top:2rem">MedConnect v2.0</p>
      </body></html>`);
    w.print();
  }

  function deleteResult(lid) {
    const l = DB.getAllLabResults().find(x => x.lid === lid);
    if (!canUseLabResult(l)) { App.toast('Accès analyse non autorisé.', 'error'); return; }
    if (!confirm('Supprimer ce résultat ?')) return;
    DB.deleteLabResult(lid);
    App.toast('🗑️ Supprimé');
    if (window.App?.navigateTo) App.navigateTo('lab');
  }

  return { renderForHospital, renderForPatient, openNew, addParam, save, printResult, deleteResult };
})();

window.LabModule = LabModule;
