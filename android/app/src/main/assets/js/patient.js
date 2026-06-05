// ========== MedConnect — Patient Portal Module ==========

window.PatientModule = (() => {
  let currentPatientId = null;

  function getHTML() {
    return `
      <div id="patient-fiche" class="section active">
        <div class="page-header">
          <div>
            <h1>📋 Ma Fiche Médicale</h1>
            <p>Gérez vos informations de santé personnelles</p>
          </div>
          <button class="btn btn-primary" onclick="PatientModule.showEditModal()">✏️ Modifier</button>
        </div>

        <div id="patient-profile-card" class="glass section-card">
          <div class="patient-header">
            <div class="patient-avatar" id="patient-avatar">?</div>
            <div>
              <h2 id="patient-full-name">Aucun profil</h2>
              <p style="color:var(--text-secondary)" id="patient-age-info">Créez votre fiche médicale</p>
            </div>
          </div>
          <div class="info-grid" id="patient-info-grid">
            <div class="info-item"><label>ID Document</label><p id="p-id">—</p></div>
            <div class="info-item"><label>Téléphone</label><p id="p-phone">—</p></div>
            <div class="info-item"><label>Email</label><p id="p-email">—</p></div>
            <div class="info-item"><label>Adresse</label><p id="p-address">—</p></div>
            <div class="info-item"><label>Allergies</label><p id="p-allergies">—</p></div>
            <div class="info-item"><label>Maladies Chroniques</label><p id="p-chronic">—</p></div>
            <div class="info-item"><label>Contact d'Urgence</label><p id="p-emergency">—</p></div>
          </div>
        </div>
      </div>

      <div id="patient-history" class="section">
        <div class="page-header">
          <div>
            <h1>🩺 Historique des Consultations</h1>
            <p>Vos visites médicales passées</p>
          </div>
        </div>
        <div class="glass section-card">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Docteur</th>
                  <th>Diagnostic</th>
                  <th>Traitement</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody id="patient-consultations-list">
                <tr><td colspan="5" class="empty-state"><div class="empty-icon">📋</div><h3>Aucune consultation</h3></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="patient-prescriptions" class="section">
        <div class="page-header">
          <div>
            <h1>💊 Mes Ordonnances</h1>
            <p>Vos prescriptions médicales</p>
          </div>
        </div>
        <div id="prescriptions-container">
          <div class="empty-state"><div class="empty-icon">📝</div><h3>Aucune ordonnance</h3><p>Vos prescriptions apparaîtront ici</p></div>
        </div>
      </div>

      <div id="patient-shared" class="section">
        <div class="page-header">
          <div>
            <h1>📤 Ordonnances Partagées</h1>
            <p>Codes de vos ordonnances à communiquer au pharmacien</p>
          </div>
        </div>
        <div id="shared-prescriptions-container">
          <div class="empty-state"><div class="empty-icon">📤</div><h3>Aucune ordonnance partagée</h3><p>Les ordonnances créées par votre docteur apparaîtront ici</p></div>
        </div>
      </div>

      <div id="patient-locate" class="section">
        <div class="page-header">
          <div>
            <h1>📍 Localiser</h1>
            <p>Trouvez la pharmacie ou l'hôpital le plus proche</p>
          </div>
        </div>
        <div class="glass section-card">
          <div style="display:flex;gap:0.75rem;margin-bottom:1rem;">
            <button class="btn btn-primary" onclick="MapModule.searchNearby('pharmacy')">🏪 Pharmacies proches</button>
            <button class="btn btn-success" onclick="MapModule.searchNearby('hospital')">🏥 Hôpitaux proches</button>
          </div>
          <div id="map-container"></div>
          <div id="map-results" style="margin-top:1rem;"></div>
        </div>
      </div>
    `;
  }

  function getSidebarNav() {
    return `
      <li><button class="btn btn-primary" onclick="PatientModule.searchBySerial()">🔎 Recherche par N° Série</button></li>
      <li><button onclick="PatientModule.showSection('patient-fiche', this)"><span class="nav-icon">📋</span> Ma Fiche</button></li>
      <li><button onclick="PatientModule.showSection('patient-history', this)"><span class="nav-icon">🩺</span> Consultations</button></li>
      <li><button onclick="PatientModule.showSection('patient-prescriptions', this)"><span class="nav-icon">💊</span> Ordonnances</button></li>
      <li><button onclick="PatientModule.showSection('patient-shared', this)"><span class="nav-icon">📤</span> Partages</button></li>
      <li><button onclick="PatientModule.showSection('patient-locate', this)"><span class="nav-icon">📍</span> Localiser</button></li>
    `;
  }

  function searchBySerial() {
    const serial = prompt('Entrez le numéro de série du patient:');
    if (serial) {
      getPatientBySerial(serial.trim());
    }
  }

  function showSection(sectionId, btn) {
    document.querySelectorAll('.main-content .section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.sidebar-nav button').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (sectionId === 'patient-locate') {
      setTimeout(() => MapModule.initMap(), 100);
    }
  }

  async function init() {
    await loadPatientProfile();
    await loadConsultations();
    await loadPrescriptions();
    loadSharedPrescriptions();
  }

  async function loadPatientProfile(patientId = currentPatientId) {
    const patients = await MedDB.dbGetAll('patients');
    if (patients.length === 0) return;

    // Use selected patient when available; otherwise use first patient as "my profile" for demo.
    let p = patientId ? await MedDB.dbGet('patients', patientId) : null;
    if (!p) p = patients[0];
    currentPatientId = p.id;

    const initials = ((p.prenom || '')[0] || '') + ((p.nom || '')[0] || '');
    document.getElementById('patient-avatar').textContent = initials.toUpperCase();
    document.getElementById('patient-full-name').textContent = `${p.prenom} ${p.nom}`;

    const age = calculateAge(p.dateNaissance);
    document.getElementById('patient-age-info').textContent = `${age} ans · ${p.sexe === 'F' ? 'Femme' : 'Homme'} · Né(e) le ${formatDate(p.dateNaissance)}`;

    document.getElementById('p-id').textContent = p.identiteNumero || '—';
    document.getElementById('p-phone').textContent = p.telephone || '—';
    document.getElementById('p-email').textContent = p.email || '—';
    document.getElementById('p-address').textContent = p.adresse || '—';
    document.getElementById('p-allergies').textContent = p.allergies || 'Aucune';
    document.getElementById('p-chronic').textContent = p.maladiesChroniques || 'Aucune';
    document.getElementById('p-emergency').textContent = p.contactUrgence || '—';
  }

  async function loadConsultations() {
    if (!currentPatientId) return;
    const consultations = await MedDB.dbGetByIndex('consultations', 'patientId', currentPatientId);
    const tbody = document.getElementById('patient-consultations-list');

    if (consultations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="empty-icon">📋</div><h3>Aucune consultation</h3></td></tr>';
      return;
    }

    tbody.innerHTML = consultations.sort((a, b) => b.date.localeCompare(a.date)).map(c => `
      <tr>
        <td>${formatDate(c.date)}</td>
        <td>${c.docteur}</td>
        <td>${c.diagnostic}</td>
        <td style="max-width:200px">${c.traitement}</td>
        <td><span class="badge ${c.statut === 'terminé' ? 'badge-green' : 'badge-orange'}">${c.statut}</span></td>
      </tr>
    `).join('');
  }

  async function loadPrescriptions() {
    if (!currentPatientId) return;
    const consultations = await MedDB.dbGetByIndex('consultations', 'patientId', currentPatientId);
    const container = document.getElementById('prescriptions-container');

    const withTreatment = consultations.filter(c => c.traitement);
    if (withTreatment.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><h3>Aucune ordonnance</h3><p>Vos prescriptions apparaîtront ici</p></div>';
      return;
    }

    container.innerHTML = withTreatment.sort((a, b) => b.date.localeCompare(a.date)).map(c => `
      <div class="glass section-card" style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
          <h3 style="font-size:1rem;">📝 Ordonnance du ${formatDate(c.date)}</h3>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            ${c.prescriptionCode ? `<span class="badge badge-purple" style="font-family:monospace;letter-spacing:1px;">🔗 ${c.prescriptionCode}</span>` : ''}
            <span class="badge badge-blue">${c.docteur}</span>
          </div>
        </div>
        <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:0.5rem;"><strong>Diagnostic :</strong> ${c.diagnostic}</p>
        <div style="background:var(--bg-input);padding:1rem;border-radius:var(--radius-sm);border-left:3px solid var(--primary);">
          <p style="font-weight:600;font-size:0.9rem;">💊 ${c.traitement}</p>
        </div>
        ${c.notes ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.5rem;font-style:italic;">📌 ${c.notes}</p>` : ''}
        ${c.prescriptionCode ? `<div style="display:flex;gap:0.5rem;margin-top:0.75rem;"><button class="btn btn-sm btn-primary" onclick="ShareModule.copyCode('${c.prescriptionCode}')">📋 Copier le code</button><button class="btn btn-sm btn-ghost" onclick="ShareModule.printPrescription(ShareModule.findByCode('${c.prescriptionCode}'))">🖨️ Imprimer</button></div>` : ''}
      </div>
    `).join('');
  }

  function loadSharedPrescriptions() {
    if (!currentPatientId) return;
    const container = document.getElementById('shared-prescriptions-container');
    if (!container) return;
    container.innerHTML = ShareModule.getPatientSharedHTML(currentPatientId);
  }

  function showEditModal() {
    const modal = document.getElementById('global-modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = currentPatientId ? 'Modifier ma fiche' : 'Créer ma fiche';

    const loadData = async () => {
      let p = {};
      if (currentPatientId) {
        p = await MedDB.dbGet('patients', currentPatientId) || {};
      }

      modalBody.innerHTML = `
  <form id="patient-form">
    <div class="form-row">
      <div class="form-group">
        <label>ID Document (passeport, carte d'identité, etc.)</label>
        <input class="form-control" id="f-id" value="${p.identiteNumero || ''}" ${currentPatientId ? 'disabled' : ''}>
      </div>
      <div class="form-group">
        <label>Prénom</label>
        <input class="form-control" id="f-prenom" value="${p.prenom || ''}" required>
      </div>
      <div class="form-group">
        <label>Nom</label>
        <input class="form-control" id="f-nom" value="${p.nom || ''}" required>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Date de naissance</label>
        <input type="date" class="form-control" id="f-dob" value="${p.dateNaissance || ''}">
      </div>
      <div class="form-group">
        <label>Sexe</label>
        <select class="form-control" id="f-sexe">
          <option value="M" ${p.sexe === 'M' ? 'selected' : ''}>Homme</option>
          <option value="F" ${p.sexe === 'F' ? 'selected' : ''}>Femme</option>
        </select>
      </div>
      <div class="form-group">
        <label>Téléphone</label>
        <input class="form-control" id="f-phone" value="${p.telephone || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-control" id="f-email" value="${p.email || ''}">
      </div>
      <div class="form-group">
        <label>Groupe Sanguin</label>
        <select class="form-control" id="f-blood">
          ${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => `<option ${p.groupeSanguin === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Adresse</label>
        <input class="form-control" id="f-address" value="${p.adresse || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Contact d'urgence</label>
        <input class="form-control" id="f-emergency" value="${p.contactUrgence || ''}">
      </div>
      <div class="form-group">
        <label>Allergies</label>
        <textarea class="form-control" id="f-allergies" rows="2">${p.allergies || ''}</textarea>
      </div>
      <div class="form-group">
        <label>Maladies chroniques</label>
        <textarea class="form-control" id="f-chronic" rows="2">${p.maladiesChroniques || ''}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
      <button type="submit" class="btn btn-primary">💾 Sauvegarder</button>
    </div>
  </form>
      `;

      document.getElementById('patient-form').onsubmit = async (e) => {
        e.preventDefault();
        await savePatient();
      };
    };

    loadData();
    modal.classList.add('active');
  }

  async function savePatient() {
    const data = {
      prenom: document.getElementById('f-prenom').value,
      nom: document.getElementById('f-nom').value,
      dateNaissance: document.getElementById('f-dob').value,
      sexe: document.getElementById('f-sexe').value,
      telephone: document.getElementById('f-phone').value,
      email: document.getElementById('f-email').value,
      adresse: document.getElementById('f-address').value,
      groupeSanguin: document.getElementById('f-blood').value,
      allergies: document.getElementById('f-allergies').value,
      maladiesChroniques: document.getElementById('f-chronic').value,
      identiteNumero: document.getElementById('f-id').value || crypto.randomUUID(),
    };

    if (data.identiteNumero) {
      const existing = await MedDB.dbGetAll('patients');
      const dup = existing.find(p => p.identiteNumero === data.identiteNumero && p.id !== currentPatientId);
      if (dup) { alert('Un autre patient possède déjà ce numéro d\'identité.'); return; }
    }

    if (currentPatientId) {
      data.id = currentPatientId;
      await MedDB.dbUpdate('patients', data);
    } else {
      currentPatientId = await MedDB.dbAdd('patients', data);
    }

    App.closeModal();
    await loadPatientProfile();
    App.showToast('Fiche sauvegardée avec succès', 'success');
  }

  function calculateAge(dateStr) {
    if (!dateStr) return '—';
    const birth = new Date(dateStr);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  async function getPatientBySerial(serial) {
    // Fetch patient by unique serial (identiteNumero)
    const patients = await MedDB.dbGetAll('patients');
    const p = patients.find(pt => pt.identiteNumero === serial);
    if (!p) {
      alert('Patient not found for serial: ' + serial);
      return null;
    }
    // set current patient context and load profile/info
    currentPatientId = p.id;
    await loadPatientProfile(p.id);
    await loadConsultations();
    await loadPrescriptions();
    loadSharedPrescriptions();
    return p;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  return { getHTML, getSidebarNav, init, showSection, showEditModal, getPatientBySerial, searchBySerial };
})();
