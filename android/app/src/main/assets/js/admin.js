/* =====================================================
   MedConnect 2.0 — Admin Module
   Statistiques · Validation comptes · Diffusion · Registres
   ===================================================== */
const AdminModule = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ══ DASHBOARD ══════════════════════════════════════ */
  function renderDashboard(main) {
    const accounts  = DB.getAccounts();
    const pending   = accounts.filter(a => a.status === 'pending');
    const approved  = accounts.filter(a => a.status === 'approved');
    const byRole    = r => approved.filter(a => a.role === r);
    const stats     = DB.getStats();

    main.innerHTML = `
      <div class="page-header">
        <h2>⚙️ Administration</h2>
        <button class="btn btn-primary btn-sm" onclick="AdminModule.openBroadcast()">
          📢 Informer les utilisateurs
        </button>
      </div>

      <!-- Stats utilisateurs -->
      <div class="stats-grid">
        <div class="stat-card" style="border-top:3px solid var(--secondary)">
          <div class="stat-icon">👨‍⚕️</div>
          <div class="stat-value">${byRole('doctor').length}</div>
          <div class="stat-label">Médecins actifs</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--purple)">
          <div class="stat-icon">💊</div>
          <div class="stat-value">${byRole('pharmacist').length}</div>
          <div class="stat-label">Pharmaciens actifs</div>
        </div>
        <div class="stat-card" style="border-top:3px solid #06B6D4">
          <div class="stat-icon">🩹</div>
          <div class="stat-value">${byRole('nurse').length}</div>
          <div class="stat-label">Infirmiers actifs</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--primary)">
          <div class="stat-icon">🩺</div>
          <div class="stat-value">${stats.totalPatients}</div>
          <div class="stat-label">Patients enregistrés</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--accent)">
          <div class="stat-icon">📋</div>
          <div class="stat-value">${stats.totalConsults}</div>
          <div class="stat-label">Consultations</div>
        </div>
        <div class="stat-card" style="border-top:3px solid var(--danger)">
          <div class="stat-icon">⏳</div>
          <div class="stat-value" style="color:${pending.length>0?'var(--accent)':'inherit'}">${pending.length}</div>
          <div class="stat-label">En attente validation</div>
        </div>
      </div>

      <!-- Demandes en attente -->
      ${pending.length ? `
        <div class="page-header" style="margin-top:1.5rem">
          <h3 style="color:var(--accent)">⏳ Demandes à valider (${pending.length})</h3>
        </div>
        <div class="records-list">
          ${pending.map(a => `
            <div class="record-card">
              <div class="record-header">
                <span style="font-size:1.2rem">${Auth.getRoleIcon(a.role)}</span>
                <div style="flex:1">
                  <strong>${esc(a.name)}</strong>
                  <span class="role-badge role-${a.role}" style="margin-left:.4rem">${a.role}</span>
                  <br>
                  <small style="color:var(--text-muted);font-family:monospace">
                    ${a.role==='doctor' ? 'N° Ordre : '+esc(a.order_num) : 'Matricule : '+esc(a.matricule||a.order_num)}
                  </small>
                </div>
                <span class="record-date">📅 ${a.created_at?.slice(0,10)||'—'}</span>
              </div>
              <div style="display:flex;gap:.5rem;margin-top:.65rem;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" style="color:var(--secondary);border-color:rgba(16,185,129,.3)"
                  onclick="AdminModule.approve('${esc(a.uid)}')">
                  ✅ Approuver
                </button>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3)"
                  onclick="AdminModule.reject('${esc(a.uid)}')">
                  ❌ Rejeter
                </button>
                <button class="btn btn-ghost btn-xs"
                  onclick="AdminModule.openDetail('${esc(a.uid)}')">
                  🔍 Détails
                </button>
              </div>
            </div>`).join('')}
        </div>
      ` : `
        <div class="card" style="text-align:center;padding:1.25rem;color:var(--text-muted);margin-top:1rem">
          ✅ Aucune demande en attente
        </div>`}

      <!-- Utilisateurs approuvés -->
      <div class="page-header" style="margin-top:1.5rem">
        <h3>👥 Utilisateurs actifs (${approved.length})</h3>
      </div>
      ${approved.length ? `
        <div class="records-list">
          ${approved.map(a => `
            <div class="record-card" style="display:flex;align-items:center;gap:.75rem">
              <span style="font-size:1.5rem">${Auth.getRoleIcon(a.role)}</span>
              <div style="flex:1;min-width:0">
                <strong style="font-size:.88rem">${esc(a.name)}</strong>
                <span class="role-badge role-${a.role}" style="margin-left:.4rem">${a.role}</span>
                <br>
                <small style="color:var(--text-muted);font-family:monospace;font-size:.72rem">
                  ${esc(a.username)}
                </small>
              </div>
              <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
                onclick="AdminModule.suspend('${esc(a.uid)}')">🚫</button>
            </div>`).join('')}
        </div>
      ` : `<div class="card empty-state"><p>Aucun utilisateur actif</p></div>`}

      <!-- Gestion des registres -->
      <div class="page-header" style="margin-top:1.5rem">
        <h3>📋 Registres officiels</h3>
        <button class="btn btn-ghost btn-sm" onclick="AdminModule.openRegistryManager()">
          ⚙️ Gérer
        </button>
      </div>
      <div style="display:flex;gap:.65rem;flex-wrap:wrap">
        <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid var(--secondary)">
          <div class="stat-icon">👨‍⚕️</div>
          <div class="stat-value">${ACL.getVerifiedDoctors().length}</div>
          <div class="stat-label">Médecins vérifiés</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid var(--purple)">
          <div class="stat-icon">💊</div>
          <div class="stat-value">${ACL.getVerifiedPharmacists().length}</div>
          <div class="stat-label">Pharmaciens vérifiés</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid #06B6D4">
          <div class="stat-icon">🩹</div>
          <div class="stat-value">${ACL.getVerifiedNurses().length}</div>
          <div class="stat-label">Infirmiers vérifiés</div>
        </div>
      </div>`;
  }

  /* ══ VALIDATION COMPTES ══════════════════════════════ */
  function approve(uid) {
    const accounts = DB.getAccounts();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) return;
    accounts[idx].status      = 'approved';
    accounts[idx].approved_at = new Date().toISOString();
    DB.saveAccounts(accounts);
    Network.notify({
      to_role: accounts[idx].role, to_id: accounts[idx].uid, type:'info',
      subject: '✅ Compte approuvé — MedConnect',
      body: `Votre compte a été validé par l'administrateur.\nVous pouvez maintenant vous connecter.\n\n📞 +243 856 373 707`,
    });
    App.toast(`✅ Compte approuvé — ${accounts[idx].name}`);
    App.navigateTo('dashboard');
  }

  function reject(uid) {
    if (!confirm('Rejeter cette demande ?')) return;
    const accounts = DB.getAccounts();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) return;
    accounts[idx].status      = 'rejected';
    accounts[idx].rejected_at = new Date().toISOString();
    DB.saveAccounts(accounts);
    Network.notify({
      to_role: accounts[idx].role, to_id: accounts[idx].uid, type:'info',
      subject: '❌ Demande rejetée — MedConnect',
      body: `Votre demande d'inscription a été rejetée.\nContactez l'administrateur : +243 856 373 707`,
    });
    App.toast('❌ Demande rejetée');
    App.navigateTo('dashboard');
  }

  function suspend(uid) {
    if (!confirm('Suspendre cet utilisateur ?')) return;
    const accounts = DB.getAccounts();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) return;
    accounts[idx].status = 'suspended';
    DB.saveAccounts(accounts);
    App.toast('🚫 Utilisateur suspendu');
    App.navigateTo('dashboard');
  }

  function openDetail(uid) {
    const a = DB.getAccounts().find(x => x.uid === uid);
    if (!a) return;
    App.openModal(`🔍 Détails — ${a.name}`, `
      <table class="info-table">
        <tr><td>Nom</td><td><strong>${esc(a.name)}</strong></td></tr>
        <tr><td>Rôle</td><td><span class="role-badge role-${a.role}">${a.role}</span></td></tr>
        <tr><td>Identifiant</td><td style="font-family:monospace">${esc(a.username)}</td></tr>
        ${a.order_num ? `<tr><td>N° Ordre</td><td style="font-family:monospace;color:var(--secondary)">${esc(a.order_num)}</td></tr>` : ''}
        ${a.matricule ? `<tr><td>Matricule</td><td style="font-family:monospace;color:var(--purple)">${esc(a.matricule)}</td></tr>` : ''}
        ${a.specialty ? `<tr><td>Spécialité</td><td>${esc(a.specialty)}</td></tr>` : ''}
        ${a.pharmacy  ? `<tr><td>Pharmacie</td><td>${esc(a.pharmacy)}</td></tr>` : ''}
        <tr><td>Date demande</td><td>${a.created_at?.slice(0,10)||'—'}</td></tr>
        <tr><td>Statut</td><td style="color:${a.status==='pending'?'var(--accent)':a.status==='approved'?'var(--secondary)':'var(--danger)'}">
          ${a.status==='pending'?'⏳ En attente':a.status==='approved'?'✅ Approuvé':'❌ Rejeté'}
        </td></tr>
      </table>
      <div class="form-actions" style="margin-top:1rem">
        ${a.status==='pending' ? `
          <button class="btn btn-ghost btn-sm" style="color:var(--secondary)"
            onclick="App.closeModal();AdminModule.approve('${esc(a.uid)}')">✅ Approuver</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
            onclick="App.closeModal();AdminModule.reject('${esc(a.uid)}')">❌ Rejeter</button>` : ''}
        <button class="btn btn-ghost" onclick="App.closeModal()">Fermer</button>
      </div>`);
  }

  /* ══ DIFFUSION ═══════════════════════════════════════ */
  function openBroadcast() {
    App.openModal('📢 Informer les utilisateurs', `
      <form onsubmit="AdminModule.sendBroadcast(event)">
        <div class="form-group">
          <label>Destinataires *</label>
          <select id="bc-role">
            <option value="all">Tous les utilisateurs</option>
            <option value="doctor">Médecins uniquement</option>
            <option value="pharmacist">Pharmaciens uniquement</option>
            <option value="nurse">Infirmiers uniquement</option>
            <option value="patient">Patients uniquement</option>
          </select>
        </div>
        <div class="form-group">
          <label>Sujet *</label>
          <input type="text" id="bc-sub" required
            placeholder="Ex: Maintenance prévue, Mise à jour disponible…">
        </div>
        <div class="form-group">
          <label>Message *</label>
          <textarea id="bc-body" rows="5" required
            placeholder="Contenu de votre message…"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">📤 Envoyer</button>
        </div>
      </form>`);
  }

  function sendBroadcast(e) {
    e.preventDefault();
    const role    = document.getElementById('bc-role').value;
    const subject = document.getElementById('bc-sub').value;
    const body    = document.getElementById('bc-body').value;
    const targets = DB.getAccounts().filter(a =>
      a.status === 'approved' && (role === 'all' || a.role === role)
    );
    targets.forEach(a => {
      Network.notify({ to_role:a.role, to_id:a.uid, type:'info', subject, body });
    });
    App.closeModal();
    App.toast(`📢 Message envoyé à ${targets.length} utilisateur(s)`);
  }

  /* ══ GESTION REGISTRES ═══════════════════════════════ */
  function openRegistryManager() {
    const doctors = ACL.getVerifiedDoctors();
    const pharms  = ACL.getVerifiedPharmacists();
    const nurses  = ACL.getVerifiedNurses();

    App.openModal('📋 Gestion des registres officiels', `
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
          <strong style="font-size:.88rem">👨‍⚕️ Médecins (${doctors.length})</strong>
          <button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('doctor')">+ Ajouter</button>
        </div>
        ${doctors.map(d => `
          <div class="admin-row">
            <div>
              <span style="font-family:monospace;font-size:.73rem;color:var(--secondary)">${esc(d.order_num)}</span>
              <strong style="font-size:.82rem;display:block">${esc(d.name)}</strong>
              <small style="color:var(--text-muted)">${esc(d.specialty||'')} · ${d.country||''}</small>
            </div>
            <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
              onclick="ACL.removeVerifiedDoctor('${esc(d.order_num)}');AdminModule.openRegistryManager()">🗑️</button>
          </div>`).join('')}
      </div>

      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
          <strong style="font-size:.88rem">💊 Pharmaciens (${pharms.length})</strong>
          <button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('pharmacist')">+ Ajouter</button>
        </div>
        ${pharms.map(p => `
          <div class="admin-row">
            <div>
              <span style="font-family:monospace;font-size:.73rem;color:var(--purple)">${esc(p.matricule)}</span>
              <strong style="font-size:.82rem;display:block">${esc(p.name)}</strong>
              <small style="color:var(--text-muted)">${esc(p.pharmacy||'')} · ${p.country||''}</small>
            </div>
            <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
              onclick="ACL.removeVerifiedPharmacist('${esc(p.matricule)}');AdminModule.openRegistryManager()">🗑️</button>
          </div>`).join('')}
      </div>

      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
          <strong style="font-size:.88rem">🩹 Infirmiers (${nurses.length})</strong>
          <button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('nurse')">+ Ajouter</button>
        </div>
        ${nurses.map(n => `
          <div class="admin-row">
            <div>
              <span style="font-family:monospace;font-size:.73rem;color:#06B6D4">${esc(n.matricule)}</span>
              <strong style="font-size:.82rem;display:block">${esc(n.name)}</strong>
              <small style="color:var(--text-muted)">${n.country||''}</small>
            </div>
          </div>`).join('')}
      </div>

      <div class="form-actions" style="margin-top:1rem">
        <button class="btn btn-ghost" onclick="App.closeModal()">Fermer</button>
      </div>`);
  }

  function openAddToRegistry(role) {
    const countries = PatientPortal.getCountriesList();
    const isDoc  = role === 'doctor';
    const isPh   = role === 'pharmacist';
    App.openModal(`➕ Ajouter au registre — ${isDoc?'Médecin':isPh?'Pharmacien':'Infirmier'}`, `
      <form onsubmit="AdminModule.saveToRegistry(event,'${role}')">
        <div class="form-group">
          <label>${isDoc?'N° Ordre Médical':'N° Matricule'} * (tout format)</label>
          <input type="text" id="reg-num" required
            placeholder="Numéro officiel — format libre"
            style="text-transform:uppercase;font-family:monospace"
            oninput="this.value=this.value.toUpperCase()">
        </div>
        <div class="form-group">
          <label>Nom complet *</label>
          <input type="text" id="reg-name" required>
        </div>
        ${isDoc ? `
          <div class="form-group"><label>Spécialité</label><input type="text" id="reg-spec" placeholder="Médecine générale…"></div>
          <div class="form-group"><label>Hôpital / Clinique</label><input type="text" id="reg-hosp"></div>
        ` : ''}
        ${isPh ? `
          <div class="form-group"><label>Nom de la pharmacie</label><input type="text" id="reg-pharm"></div>
        ` : ''}
        <div class="form-group">
          <label>Pays *</label>
          <select id="reg-country" required>
            <option value="">— Pays —</option>
            ${countries.map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">✅ Ajouter</button>
        </div>
      </form>`);
  }

  function saveToRegistry(e, role) {
    e.preventDefault();
    const num     = document.getElementById('reg-num').value.trim().toUpperCase();
    const name    = document.getElementById('reg-name').value.trim();
    const country = document.getElementById('reg-country').value;
    let ok = false;
    if (role === 'doctor') {
      ok = ACL.addVerifiedDoctor({
        order_num: num, name, country,
        specialty: document.getElementById('reg-spec')?.value||'',
        hospital:  document.getElementById('reg-hosp')?.value||'',
      });
    } else if (role === 'pharmacist') {
      ok = ACL.addVerifiedPharmacist({
        matricule: num, name, country,
        pharmacy: document.getElementById('reg-pharm')?.value||'',
      });
    } else {
      ok = ACL.addVerifiedNurse({ matricule: num, name, country });
    }
    App.closeModal();
    App.toast(ok ? `✅ Ajouté au registre — ${num}` : '⚠️ Ce numéro existe déjà', ok?'success':'error');
    App.navigateTo('dashboard');
  }

  return {
    renderDashboard, approve, reject, suspend, openDetail,
    openBroadcast, sendBroadcast,
    openRegistryManager, openAddToRegistry, saveToRegistry,
  };
})();

window.AdminModule = AdminModule;
