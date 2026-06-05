// ========== MedConnect — Hospital / Doctor Portal Module ==========

window.HospitalModule = (() => {

  function getHTML() {
    return `
      <div id="hosp-dashboard" class="section active">
        <div class="page-header">
          <div>
            <h1>📊 Tableau de Bord</h1>
            <p>Vue d'ensemble de l'activité médicale</p>
          </div>
        </div>
        <div class="stats-grid" id="hosp-stats"></div>
        <div class="glass section-card">
          <h3 style="margin-bottom:1rem;">📅 Rendez-vous à venir</h3>
          <div class="table-container">
            <table>
              <thead><tr><th>Patient</th><th>Date</th><th>Heure</th><th>Docteur</th><th>Motif</th><th>Statut</th></tr></thead>
              <tbody id="hosp-upcoming-apt"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="hosp-patients" class="section">
        <div class="page-header">
          <div>
            <h1>👥 Gestion des Patients</h1>
            <p>Base de données complète des patients</p>
          </div>
          <div style="display:flex;gap:0.75rem;">
            <div class="search-bar">
              <input class="form-control" placeholder="Rechercher un patient..." id="hosp-search-input" oninput="HospitalModule.filterPatients()">
            </div>
            <button class="btn btn-primary" onclick="HospitalModule.showPatientModal()">➕ Nouveau Patient</button>
          </div>
        </div>
        <div class="glass section-card">
          <div class="table-container">
            <table>
              <thead><tr>    <th>Nom</th>
    <th>Prénom</th>
    <th>Âge</th>
    <th>Sexe</th>
    <th>Téléphone</th>
    <th>Groupe Sanguin</th>
    <th>ID Document</th>
    <th>Actions</th></tr></thead>
              <tbody id="hosp-patients-list"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="hosp-dossier" class="section">
        <div class="page-header">
          <div>
            <h1>📁 Dossier Médical</h1>
            <p id="dossier-patient-name">Sélectionnez un patient</p>
          </div>
          <button class="btn btn-primary" onclick="HospitalModule.showConsultationModal()" id="btn-add-consultation" style="display:none">➕ Nouvelle Consultation</button>
        </div>
        <div id="dossier-content">
          <div class="empty-state"><div class="empty-icon">📁</div><h3>Aucun patient sélectionné</h3><p>Cliquez sur "Voir dossier" dans la liste des patients</p></div>
        </div>
      </div>

      <div id="hosp-appointments" class="section">
        <div class="page-header">
          <div>
            <h1>📅 Rendez-vous</h1>
            <p>Gestion des rendez-vous médicaux</p>
          </div>
          <button class="btn btn-primary" onclick="HospitalModule.showAppointmentModal()">➕ Nouveau RDV</button>
        </div>
        <div class="glass section-card">
          <div class="table-container">
            <table>
              <thead><tr><th>Patient</th><th>Date</th><th>Heure</th><th>Docteur</th><th>Motif</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody id="hosp-appointments-list"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function getSidebarNav() {
    return `
      <li><button class="active" onclick="HospitalModule.showSection('hosp-dashboard', this)"><span class="nav-icon">📊</span> Tableau de bord</button></li>
      <li><button onclick="HospitalModule.showSection('hosp-patients', this)"><span class="nav-icon">👥</span> Patients</button></li>
      <li><button onclick="HospitalModule.showSection('hosp-dossier', this)"><span class="nav-icon">📁</span> Dossier Médical</button></li>
      <li><button onclick="HospitalModule.showSection('hosp-appointments', this)"><span class="nav-icon">📅</span> Rendez-vous</button></li>
    `;
  }

  function showSection(sectionId, btn) {
    document.querySelectorAll('.main-content .section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  async function init() {
    await loadDashboard();
    await loadPatients();
    await loadAppointments();
  }

  // ===== Dashboard =====
  async function loadDashboard() {
    const pCount = await MedDB.dbCount('patients');
    const cCount = await MedDB.dbCount('consultations');
    const apts = await MedDB.dbGetAll('appointments');
    const todayStr = new Date().toISOString().split('T')[0];
    const todayApts = apts.filter(a => a.date === todayStr);

    document.getElementById('hosp-stats').innerHTML = `
      <div class="stat-card glass"><div class="stat-icon blue">👥</div><div class="stat-info"><h3>${pCount}</h3><p>Patients enregistrés</p></div></div>
      <div class="stat-card glass"><div class="stat-icon green">🩺</div><div class="stat-info"><h3>${cCount}</h3><p>Consultations totales</p></div></div>
      <div class="stat-card glass"><div class="stat-icon purple">📅</div><div class="stat-info"><h3>${todayApts.length}</h3><p>RDV aujourd'hui</p></div></div>
      <div class="stat-card glass"><div class="stat-icon orange">📋</div><div class="stat-info"><h3>${apts.filter(a => a.statut === 'en attente').length}</h3><p>RDV en attente</p></div></div>
    `;

    const upcoming = apts.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    document.getElementById('hosp-upcoming-apt').innerHTML = upcoming.length ? upcoming.map(a => `
      <tr>
        <td><strong>${a.patientNom}</strong></td>
        <td>${formatDate(a.date)}</td>
        <td>${a.heure}</td>
        <td>${a.docteur}</td>
        <td>${a.motif}</td>
        <td><span class="badge ${a.statut === 'confirmé' ? 'badge-green' : 'badge-orange'}">${a.statut}</span></td>
      </tr>
    `).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:2rem;">Aucun rendez-vous à venir</td></tr>';
  }

  // ===== Patients =====
  let allPatients = [];
  async function loadPatients() {
    allPatients = await MedDB.dbGetAll('patients');
    renderPatients(allPatients);
  }

  function renderPatients(patients) {
    const tbody = document.getElementById('hosp-patients-list');
    if (!patients.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="empty-icon">👥</div><h3>Aucun patient</h3></td></tr>';
      return;
    }
    tbody.innerHTML = patients.map(p => `
      <tr>
        <td><strong>${p.nom}</strong></td>
        <td>${p.prenom}</td>
        <td>${calculateAge(p.dateNaissance)}</td>
        <td>${p.sexe === 'F' ? '♀️ F' : '♂️ M'}</td>
        <td>${p.telephone || '—'}</td>
        <td><span class="badge badge-red">${p.groupeSanguin || '—'}</span></td>
        <td>${p.identiteNumero || '—'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="HospitalModule.viewDossier(${p.id})">📁 Dossier</button>
          <button class="btn btn-sm btn-ghost" onclick="HospitalModule.showPatientModal(${p.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="HospitalModule.deletePatient(${p.id})">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  function filterPatients() {
    const q = document.getElementById('hosp-search-input').value.toLowerCase();
    const filtered = allPatients.filter(p =>
      (p.nom + ' ' + p.prenom + ' ' + (p.telephone || '')).toLowerCase().includes(q)
    );
    renderPatients(filtered);
  }

  function showPatientModal(patientId) {
    const modal = document.getElementById('global-modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    modalTitle.textContent = patientId ? 'Modifier le patient' : 'Nouveau patient';

    const loadData = async () => {
      let p = {};
      if (patientId) p = await MedDB.dbGet('patients', patientId) || {};

      modalBody.innerHTML = `
        <form id="hosp-patient-form">
          <div class="form-row">
            <div class="form-group">
            <label>ID Document (passeport, carte d'identité, etc.)</label>
            <input class="form-control" id="hp-id" value="${p.identiteNumero || ''}">
          </div> <div class="form-group"><label>Prénom</label><input class="form-control" id="hp-prenom" value="${p.prenom || ''}" required></div>
            <div class="form-group"><label>Nom</label><input class="form-control" id="hp-nom" value="${p.nom || ''}" required></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Date de naissance</label><input type="date" class="form-control" id="hp-dob" value="${p.dateNaissance || ''}"></div>
            <div class="form-group"><label>Sexe</label>
              <select class="form-control" id="hp-sexe"><option value="M" ${p.sexe==='M'?'selected':''}>Homme</option><option value="F" ${p.sexe==='F'?'selected':''}>Femme</option></select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Téléphone</label><input class="form-control" id="hp-phone" value="${p.telephone || ''}"></div>
            <div class="form-group"><label>Groupe Sanguin</label>
              <select class="form-control" id="hp-blood">${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g=>`<option ${p.groupeSanguin===g?'selected':''}>${g}</option>`).join('')}</select>
            </div>
          </div>
          <div class="form-group"><label>Email</label><input type="email" class="form-control" id="hp-email" value="${p.email || ''}"></div>
          <div class="form-group"><label>Adresse</label><input class="form-control" id="hp-address" value="${p.adresse || ''}"></div>
          <div class="form-group"><label>Allergies</label><textarea class="form-control" id="hp-allergies" rows="2">${p.allergies || ''}</textarea></div>
          <div class="form-group"><label>Maladies chroniques</label><textarea class="form-control" id="hp-chronic" rows="2">${p.maladiesChroniques || ''}</textarea></div>
          <div class="form-group"><label>Contact d'urgence</label><input class="form-control" id="hp-emergency" value="${p.contactUrgence || ''}"></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
            <button type="submit" class="btn btn-primary">💾 Sauvegarder</button>
          </div>
        </form>
      `;
      document.getElementById('hosp-patient-form').onsubmit = async (e) => {
        e.preventDefault();
          const data = {
            prenom: document.getElementById('hp-prenom').value,
            nom: document.getElementById('hp-nom').value,
            dateNaissance: document.getElementById('hp-dob').value,
            sexe: document.getElementById('hp-sexe').value,
            telephone: document.getElementById('hp-phone').value,
            email: document.getElementById('hp-email').value,
            adresse: document.getElementById('hp-address').value,
            groupeSanguin: document.getElementById('hp-blood').value,
            allergies: document.getElementById('hp-allergies').value,
            maladiesChroniques: document.getElementById('hp-chronic').value,
            contactUrgence: document.getElementById('hp-emergency').value,
            identiteNumero: document.getElementById('hp-id').value,
          };
          if (patientId) {
            // Check for duplicate ID Document
            const existing = await MedDB.dbGetAll('patients');
            const dup = existing.find(p => p.identiteNumero && p.identiteNumero === data.identiteNumero && p.id !== patientId);
            if (dup) {
              alert('Un autre patient possède déjà ce numéro d\'identité. Enregistrement annulé.');
              return;
            }
            data.id = patientId;
            await MedDB.dbUpdate('patients', data);
          } else {
            // Prevent duplicate on create
            if (data.identiteNumero) {
              const existing = await MedDB.dbGetAll('patients');
              const dup = existing.find(p => p.identiteNumero === data.identiteNumero);
              if (dup) {
                alert('Un patient avec ce numéro d\'identité existe déjà. Utilisez le formulaire de modification.');
                return;
              }
            }
            await MedDB.dbAdd('patients', data);
          } App.closeModal();
        await loadPatients();
        await loadDashboard();
        App.showToast('Patient sauvegardé', 'success');
      };
    };
    loadData();
    modal.classList.add('active');
  }

  async function deletePatient(id) {
    if (!confirm('Supprimer ce patient ?')) return;
    await MedDB.dbDelete('patients', id);
    await loadPatients();
    await loadDashboard();
    App.showToast('Patient supprimé', 'info');
  }

  // ===== Dossier =====
  let currentDossierPatientId = null;

  async function viewDossier(patientId) {
    currentDossierPatientId = patientId;
    showSection('hosp-dossier', document.querySelectorAll('.sidebar-nav button')[2]);

    const p = await MedDB.dbGet('patients', patientId);
    const consultations = await MedDB.dbGetByIndex('consultations', 'patientId', patientId);

    document.getElementById('dossier-patient-name').textContent = `Dossier de ${p.prenom} ${p.nom}`;
    document.getElementById('btn-add-consultation').style.display = 'inline-flex';

    document.getElementById('dossier-content').innerHTML = `
      <div class="glass section-card">
        <h3 style="margin-bottom:1rem;">🔬 Informations du patient</h3>
        <div class="info-grid">
          <div class="info-item"><label>Nom complet</label><p>${p.prenom} ${p.nom}</p></div>
          <div class="info-item"><label>Âge</label><p>${calculateAge(p.dateNaissance)} ans</p></div>
          <div class="info-item"><label>Sexe</label><p>${p.sexe==='F'?'Femme':'Homme'}</p></div>
          <div class="info-item"><label>Groupe sanguin</label><p>${p.groupeSanguin||'—'}</p></div>
          <div class="info-item"><label>Allergies</label><p style="color:var(--danger)">${p.allergies||'Aucune'}</p></div>
          <div class="info-item"><label>Maladies chroniques</label><p style="color:var(--warning)">${p.maladiesChroniques||'Aucune'}</p></div>
        </div>
      </div>
      <div class="glass section-card">
        <h3 style="margin-bottom:1rem;">📋 Historique des consultations (${consultations.length})</h3>
        ${consultations.length ? `<div class="table-container"><table>
          <thead><tr><th>Date</th><th>Docteur</th><th>Diagnostic</th><th>Traitement</th><th>Notes</th><th>Statut</th></tr></thead>
          <tbody>${consultations.sort((a,b)=>b.date.localeCompare(a.date)).map(c=>`
            <tr>
              <td>${formatDate(c.date)}</td>
              <td>${c.docteur}</td>
              <td>${c.diagnostic}</td>
              <td style="max-width:180px">${c.traitement}</td>
              <td style="max-width:150px;color:var(--text-muted)">${c.notes||'—'}</td>
              <td><span class="badge ${c.statut==='terminé'?'badge-green':'badge-orange'}">${c.statut}</span></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Aucune consultation enregistrée</p>'}
      </div>
    `;
  }

  function showConsultationModal() {
    if (!currentDossierPatientId) return;
    const modal = document.getElementById('global-modal');
    const modalBody = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = 'Nouvelle Consultation';

    modalBody.innerHTML = `
      <form id="consultation-form">
        <div class="form-row">
          <div class="form-group"><label>Date</label><input type="date" class="form-control" id="c-date" value="${new Date().toISOString().split('T')[0]}" required></div>
          <div class="form-group"><label>Docteur</label><input class="form-control" id="c-doctor" placeholder="Dr." required></div>
        </div>
        <div class="form-group"><label>Diagnostic</label><textarea class="form-control" id="c-diagnostic" rows="2" required></textarea></div>
        <div class="form-group"><label>Traitement prescrit</label><textarea class="form-control" id="c-treatment" rows="2"></textarea></div>
        <div class="form-group"><label>Notes</label><textarea class="form-control" id="c-notes" rows="2"></textarea></div>
        <div class="form-group"><label>Statut</label>
          <select class="form-control" id="c-status"><option value="en cours">En cours</option><option value="terminé">Terminé</option></select>
        </div>
        <div style="background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.2);border-radius:var(--radius-sm);padding:1rem;margin-bottom:1rem;">
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.9rem;">
            <input type="checkbox" id="c-share" checked style="width:18px;height:18px;accent-color:var(--primary);">
            <span>📤 <strong>Partager l'ordonnance</strong> — Génère un code unique que le patient peut donner au pharmacien</span>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">💾 Enregistrer</button>
        </div>
      </form>
    `;
    document.getElementById('consultation-form').onsubmit = async (e) => {
      e.preventDefault();
      const consultationData = {
        patientId: currentDossierPatientId,
        date: document.getElementById('c-date').value,
        docteur: document.getElementById('c-doctor').value,
        diagnostic: document.getElementById('c-diagnostic').value,
        traitement: document.getElementById('c-treatment').value,
        notes: document.getElementById('c-notes').value,
        statut: document.getElementById('c-status').value,
      };

      // Create shared prescription if checked
      const shareChecked = document.getElementById('c-share').checked;
      let rxCode = null;
      if (shareChecked && consultationData.traitement) {
        const rx = await ShareModule.createPrescription(currentDossierPatientId, consultationData);
        if (rx) rxCode = rx.code;
        consultationData.prescriptionCode = rxCode;
      }

      await MedDB.dbAdd('consultations', consultationData);
      App.closeModal();
      await viewDossier(currentDossierPatientId);
      await loadDashboard();

      if (rxCode) {
        App.showToast(`Ordonnance partagée ! Code: ${rxCode}`, 'success');
      } else {
        App.showToast('Consultation enregistrée', 'success');
      }
    };
    modal.classList.add('active');
  }

  // ===== Appointments =====
  async function loadAppointments() {
    const apts = await MedDB.dbGetAll('appointments');
    const tbody = document.getElementById('hosp-appointments-list');
    if (!apts.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:2rem;">Aucun rendez-vous</td></tr>';
      return;
    }
    tbody.innerHTML = apts.sort((a,b) => a.date.localeCompare(b.date)).map(a => `
      <tr>
        <td><strong>${a.patientNom}</strong></td>
        <td>${formatDate(a.date)}</td>
        <td>${a.heure}</td>
        <td>${a.docteur}</td>
        <td>${a.motif}</td>
        <td><span class="badge ${a.statut==='confirmé'?'badge-green':'badge-orange'}">${a.statut}</span></td>
        <td>
          <button class="btn btn-sm btn-success" onclick="HospitalModule.toggleAptStatus(${a.id})">${a.statut==='confirmé'?'✅':'🔄'}</button>
          <button class="btn btn-sm btn-danger" onclick="HospitalModule.deleteAppointment(${a.id})">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  async function toggleAptStatus(id) {
    const apt = await MedDB.dbGet('appointments', id);
    apt.statut = apt.statut === 'confirmé' ? 'en attente' : 'confirmé';
    await MedDB.dbUpdate('appointments', apt);
    await loadAppointments();
    await loadDashboard();
  }

  async function deleteAppointment(id) {
    if (!confirm('Supprimer ce rendez-vous ?')) return;
    await MedDB.dbDelete('appointments', id);
    await loadAppointments();
    await loadDashboard();
    App.showToast('Rendez-vous supprimé', 'info');
  }

  function showAppointmentModal() {
    const modal = document.getElementById('global-modal');
    const modalBody = document.getElementById('modal-body');
    document.getElementById('modal-title').textContent = 'Nouveau Rendez-vous';

    const loadData = async () => {
      const patients = await MedDB.dbGetAll('patients');
      modalBody.innerHTML = `
        <form id="apt-form">
          <div class="form-group"><label>Patient</label>
            <select class="form-control" id="a-patient" required>
              <option value="">-- Sélectionner --</option>
              ${patients.map(p => `<option value="${p.id}" data-name="${p.prenom} ${p.nom}">${p.prenom} ${p.nom}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Date</label><input type="date" class="form-control" id="a-date" required></div>
            <div class="form-group"><label>Heure</label><input type="time" class="form-control" id="a-time" required></div>
          </div>
          <div class="form-group"><label>Docteur</label><input class="form-control" id="a-doctor" placeholder="Dr." required></div>
          <div class="form-group"><label>Motif</label><input class="form-control" id="a-motif" required></div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
            <button type="submit" class="btn btn-primary">💾 Enregistrer</button>
          </div>
        </form>
      `;
      document.getElementById('apt-form').onsubmit = async (e) => {
        e.preventDefault();
        const sel = document.getElementById('a-patient');
        await MedDB.dbAdd('appointments', {
          patientId: parseInt(sel.value),
          patientNom: sel.options[sel.selectedIndex].dataset.name,
          date: document.getElementById('a-date').value,
          heure: document.getElementById('a-time').value,
          docteur: document.getElementById('a-doctor').value,
          motif: document.getElementById('a-motif').value,
          statut: 'en attente',
        });
        App.closeModal();
        await loadAppointments();
        await loadDashboard();
        App.showToast('Rendez-vous créé', 'success');
      };
    };
    loadData();
    modal.classList.add('active');
  }

  function calculateAge(dateStr) {
    if (!dateStr) return '—';
    const b = new Date(dateStr), t = new Date();
    let age = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
    return age;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
  }

  return { getHTML, getSidebarNav, init, showSection, showPatientModal, deletePatient, viewDossier, showConsultationModal, loadAppointments, showAppointmentModal, toggleAptStatus, deleteAppointment, filterPatients };
})();
