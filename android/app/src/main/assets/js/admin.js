/* =====================================================
   MedConnect 2.0 — Admin Module
   Statistiques · Validation comptes · Diffusion · Registres
   ===================================================== */
const AdminModule = (() => {
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const now = () => new Date().toISOString();
  const PRO_ROLES = ['doctor', 'nurse', 'pharmacist'];

  function safeList(fn) {
    try {
      const value = fn?.();
      return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch (e) {
      console.warn('[MedConnect] Admin list read failed:', e);
      return [];
    }
  }

  function safeStats() {
    try { return DB?.getStats?.() || {}; }
    catch (e) { console.warn('[MedConnect] Admin stats failed:', e); return {}; }
  }

  function safeRole(role) {
    const r = String(role || '').toLowerCase();
    return PRO_ROLES.includes(r) || r === 'admin' || r === 'patient' ? r : 'unknown';
  }

  function roleIcon(role) {
    try { return Auth?.getRoleIcon?.(safeRole(role)) || '👤'; }
    catch (_) { return '👤'; }
  }

  function roleLabel(role) {
    try { return Auth?.getRoleLabel?.(safeRole(role)) || safeRole(role); }
    catch (_) { return safeRole(role); }
  }

  function currentAdminUid() {
    try { return Auth?.getUser?.()?.uid || 'admin_root'; }
    catch (_) { return 'admin_root'; }
  }

  function roleProfessionalNumber(a = {}) {
    return a.professionalNumber || a.order_num || a.matricule || a.username || '';
  }

  function accountLabel(a = {}) {
    return a.name || a.fullName || a.requesterName || a.email || a.uid || 'Demande inconnue';
  }

  function getAccountsSafe() {
    return safeList(() => DB.getAccounts()).map(a => ({ ...a, role: safeRole(a.role), status: String(a.status || 'pending').toLowerCase() }));
  }

  function getRequestsSafe() {
    return safeList(() => DB.getRegistrationRequests?.()).map(r => ({ ...r, status: String(r.status || 'pending').toLowerCase() }));
  }

  function getRegistrationRows() {
    const accounts = getAccountsSafe();
    const requests = getRequestsSafe();
    const map = new Map();

    accounts
      .filter(a => PRO_ROLES.includes(a.role))
      .forEach(a => {
        const number = roleProfessionalNumber(a);
        const key = a.uid || `${a.role}_${number || a.email || Date.now()}`;
        map.set(key, {
          ...a,
          requestId: a.requestId || '',
          requesterUid: a.uid || '',
          requesterRole: a.role,
          requesterName: accountLabel(a),
          professionalNumber: number,
          source: 'account',
        });
      });

    requests.forEach(r => {
      const role = safeRole(r.role || r.requesterRole);
      if (!PRO_ROLES.includes(role)) return;
      const number = r.professionalNumber || r.order_num || r.matricule || r.username || '';
      const key = r.requesterUid || `${role}_${number || r.email || r.requestId || Date.now()}`;
      const existing = map.get(key) || {};
      map.set(key, {
        ...existing,
        ...r,
        uid: existing.uid || r.requesterUid || '',
        role: existing.role || role,
        name: existing.name || r.fullName || r.requesterName || '',
        email: existing.email || r.email || '',
        professionalNumber: existing.professionalNumber || number,
        status: r.status || existing.status || 'pending',
        requestId: r.requestId || existing.requestId || '',
        requesterUid: r.requesterUid || existing.uid || '',
        requesterRole: r.requesterRole || r.role || existing.role || role,
        requesterName: r.requesterName || r.fullName || existing.name || '',
        source: existing.uid ? 'account+request' : 'request',
      });
    });

    return [...map.values()].filter(r => PRO_ROLES.includes(safeRole(r.role || r.requesterRole)));
  }

  function updateRegistrationRequests(uid, status) {
    const requests = getRequestsSafe();
    const reviewedAt = now();
    const reviewedBy = currentAdminUid();
    let changed = false;

    const next = requests.map(r => {
      if (r.requesterUid === uid && r.status === 'pending') {
        changed = true;
        return {
          ...r,
          status,
          updatedAt: reviewedAt,
          reviewedAt,
          reviewedBy,
          rejectedAt: status === 'rejected' ? reviewedAt : r.rejectedAt || null,
          approvedAt: status === 'approved' ? reviewedAt : r.approvedAt || null,
        };
      }
      return r;
    });

    if (changed) DB.saveRegistrationRequests?.(next);
  }

  /** Écrit users/mc_accounts/registration_requests via DB.pushAndReport()
      (confirme le succès, ne masque plus l'échec — Étape 2). */
  async function pushRegistrationCloud(uid, account, status) {
    if (!uid) return false;
    const reviewedAt = now();
    const reviewedBy = currentAdminUid();
    const writes = [
      ['users', uid, { ...account, status, updatedAt: reviewedAt }],
      ['mc_accounts', uid, { ...account, status, updatedAt: reviewedAt }],
    ];
    getRequestsSafe()
      .filter(r => r.requesterUid === uid && r.requestId)
      .forEach(r => writes.push(['registration_requests', r.requestId, {
        ...r, status, updatedAt: reviewedAt, reviewedAt, reviewedBy,
        approvedAt: status === 'approved' ? reviewedAt : r.approvedAt || null,
        rejectedAt: status === 'rejected' ? reviewedAt : r.rejectedAt || null,
      }]));
    return DB.pushAndReport ? DB.pushAndReport(writes) : false;
  }

  function statusText(status) {
    const s = String(status || '').toLowerCase();
    return s === 'pending' ? '⏳ En attente' :
      ['approved','active'].includes(s) ? '✅ Approuvé' :
      s === 'suspended' ? '🚫 Suspendu' : '❌ Rejeté';
  }

  function renderPendingRow(a) {
    const uid = a.uid || a.requesterUid || '';
    const role = safeRole(a.role || a.requesterRole);
    const numberLabel = role === 'doctor' ? 'N° Ordre' : 'Matricule';
    return `
      <div class="record-card">
        <div class="record-header">
          <span style="font-size:1.2rem">${roleIcon(role)}</span>
          <div style="flex:1;min-width:0">
            <strong>${esc(accountLabel(a))}</strong>
            <span class="role-badge role-${esc(role)}" style="margin-left:.4rem">${esc(roleLabel(role))}</span>
            <br>
            <small style="color:var(--text-muted);font-family:monospace">
              ${numberLabel} : ${esc(roleProfessionalNumber(a) || '—')}
            </small>
            ${a.email ? `<br><small style="color:var(--text-dim)">✉️ ${esc(a.email)}</small>` : ''}
          </div>
          <span class="record-date">📅 ${String(a.createdAt || a.created_at || a.submittedAt || '').slice(0,10) || '—'}</span>
        </div>
        <div style="display:flex;gap:.5rem;margin-top:.65rem;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="AdminModule.openDetail('${esc(uid)}')">
            🔍 Vérifier la demande
          </button>
        </div>
      </div>`;
  }

  /* ══ DASHBOARD ══════════════════════════════════════ */
  function renderDashboard(main) {
    try {
      main = main || document.getElementById('main-content');
      if (!main) return;

      // Cloud-first, mais jamais bloquant : l'écran s'affiche
      // immédiatement avec le cache disponible, puis se rafraîchit
      // discrètement dès que la sync réseau aboutit (ou abandonne
      // après timeout). Un réseau lent/absent ne doit plus jamais
      // figer l'admin sur un sablier vide.
      if (DB.syncFromFirebaseInBackground) {
        DB.syncFromFirebaseInBackground(ok => {
          const stillOnDashboard = document.querySelector('.nav-item.active')?.dataset?.section === 'dashboard';
          const stillAdmin = Auth.getUser?.()?.role === 'admin';
          if (ok && stillOnDashboard && stillAdmin) {
            renderDashboard(document.getElementById('main-content'));
          }
        });
      }

      const accounts  = getAccountsSafe();
      const rows      = getRegistrationRows();
      const pending   = rows.filter(a => String(a.status || '').toLowerCase() === 'pending');
      const approved  = accounts.filter(a => ['approved','active'].includes(String(a.status || '').toLowerCase()));
      const byRole    = r => approved.filter(a => a.role === r);
      const stats     = safeStats();
      const doctors   = safeList(() => ACL.getVerifiedDoctors());
      const pharms    = safeList(() => ACL.getVerifiedPharmacists());
      const nurses    = safeList(() => ACL.getVerifiedNurses());

      main.innerHTML = `
        <div class="page-header">
          <h2>⚙️ Administration</h2>
          <button class="btn btn-primary btn-sm" onclick="AdminModule.openBroadcast()">
            📢 Informer les utilisateurs
          </button>
        </div>

        <div class="stats-grid">
          <div class="stat-card" style="border-top:3px solid var(--secondary)">
            <div class="stat-icon">👨‍⚕️</div><div class="stat-value">${byRole('doctor').length}</div><div class="stat-label">Médecins actifs</div>
          </div>
          <div class="stat-card" style="border-top:3px solid var(--purple)">
            <div class="stat-icon">💊</div><div class="stat-value">${byRole('pharmacist').length}</div><div class="stat-label">Pharmaciens actifs</div>
          </div>
          <div class="stat-card" style="border-top:3px solid #06B6D4">
            <div class="stat-icon">🩹</div><div class="stat-value">${byRole('nurse').length}</div><div class="stat-label">Infirmiers actifs</div>
          </div>
          <div class="stat-card" style="border-top:3px solid var(--primary)">
            <div class="stat-icon">🩺</div><div class="stat-value">${stats.totalPatients || 0}</div><div class="stat-label">Patients enregistrés</div>
          </div>
          <div class="stat-card" style="border-top:3px solid var(--accent)">
            <div class="stat-icon">📋</div><div class="stat-value">${stats.totalConsults || 0}</div><div class="stat-label">Consultations</div>
          </div>
          <div class="stat-card" style="border-top:3px solid var(--danger)">
            <div class="stat-icon">⏳</div><div class="stat-value" style="color:${pending.length>0?'var(--accent)':'inherit'}">${pending.length}</div><div class="stat-label">Demandes inscription</div>
          </div>
        </div>

        ${pending.length ? `
          <div class="page-header" style="margin-top:1.5rem">
            <h3 style="color:var(--accent)">⏳ Demandes d’inscription à vérifier (${pending.length})</h3>
          </div>
          <div class="auth-register-info" style="margin-bottom:1rem">
            Chaque demande doit être vérifiée séparément avant approbation : identité, rôle, numéro officiel, email et registre professionnel.
          </div>
          <div class="records-list">${pending.map(renderPendingRow).join('')}</div>
        ` : `
          <div class="card" style="text-align:center;padding:1.25rem;color:var(--text-muted);margin-top:1rem">
            ✅ Aucune demande d'inscription en attente
          </div>`}

        <div class="page-header" style="margin-top:1.5rem"><h3>👥 Utilisateurs actifs (${approved.length})</h3></div>
        ${approved.length ? `
          <div class="records-list">
            ${approved.map(a => `
              <div class="record-card" style="display:flex;align-items:center;gap:.75rem">
                <span style="font-size:1.5rem">${roleIcon(a.role)}</span>
                <div style="flex:1;min-width:0">
                  <strong style="font-size:.88rem">${esc(a.name || a.fullName || a.email || 'Utilisateur')}</strong>
                  <span class="role-badge role-${esc(a.role)}" style="margin-left:.4rem">${esc(roleLabel(a.role))}</span><br>
                  <small style="color:var(--text-muted);font-family:monospace;font-size:.72rem">${esc(a.username || roleProfessionalNumber(a) || '—')}</small>
                </div>
                <button class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="AdminModule.suspend('${esc(a.uid || '')}')">🚫</button>
              </div>`).join('')}
          </div>` : `<div class="card empty-state"><p>Aucun utilisateur actif</p></div>`}

        <div class="page-header" style="margin-top:1.5rem">
          <h3>📋 Registres officiels</h3>
          <button class="btn btn-ghost btn-sm" onclick="AdminModule.openRegistryManager()">⚙️ Gérer</button>
        </div>
        <div style="display:flex;gap:.65rem;flex-wrap:wrap">
          <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid var(--secondary)"><div class="stat-icon">👨‍⚕️</div><div class="stat-value">${doctors.length}</div><div class="stat-label">Médecins vérifiés</div></div>
          <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid var(--purple)"><div class="stat-icon">💊</div><div class="stat-value">${pharms.length}</div><div class="stat-label">Pharmaciens vérifiés</div></div>
          <div class="stat-card" style="flex:1;min-width:140px;border-top:3px solid #06B6D4"><div class="stat-icon">🩹</div><div class="stat-value">${nurses.length}</div><div class="stat-label">Infirmiers vérifiés</div></div>
        </div>`;
    } catch (e) {
      console.error('[MedConnect] Admin dashboard failed:', e);
      if (main) main.innerHTML = `
        <div class="page-header"><h2>⚙️ Administration</h2></div>
        <div class="card empty-state">
          <p>Impossible de charger le tableau administrateur.</p>
          <p style="font-size:.8rem;color:var(--text-muted)">${esc(e.message || e)}</p>
          <button class="btn btn-primary" onclick="App.navigateTo('dashboard')">🔄 Réessayer</button>
        </div>`;
    }
  }

  /* ══ VALIDATION COMPTES ══════════════════════════════ */
  async function approve(uid) {
    const accounts = getAccountsSafe();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) { App.toast('❌ Compte introuvable pour cette demande.', 'error'); return; }
    if (!confirm('Approuver cette demande après vérification des informations ?')) return;

    accounts[idx].status      = 'approved';
    accounts[idx].approved_at = now();
    accounts[idx].reviewedAt  = accounts[idx].approved_at;
    accounts[idx].reviewedBy  = currentAdminUid();
    DB.saveAccounts(accounts);
    updateRegistrationRequests(uid, 'approved');
    const ok = await pushRegistrationCloud(uid, accounts[idx], 'approved');
    if (!ok) App.toast('⚠️ Enregistré localement, mais Firestore n\'a pas confirmé l\'écriture. Vérifiez la connexion et réessayez.', 'error');

    Network?.notify?.({
      to_role: accounts[idx].role, to_id: accounts[idx].uid, type:'info',
      subject: '✅ Compte approuvé — MedConnect',
      body: `Votre compte a été validé par l'administrateur.\nVous pouvez maintenant vous connecter.\n\n📞 +243 856 373 707`,
    });
    App.toast(`✅ Compte approuvé — ${accounts[idx].name || accounts[idx].fullName || accounts[idx].email || accounts[idx].uid}`);
    App.closeModal?.();
    App.navigateTo('dashboard');
  }

  async function reject(uid) {
    if (!confirm('Refuser cette demande après vérification ?')) return;
    const accounts = getAccountsSafe();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) { App.toast('❌ Compte introuvable pour cette demande.', 'error'); return; }
    accounts[idx].status      = 'rejected';
    accounts[idx].rejected_at = now();
    accounts[idx].reviewedAt  = accounts[idx].rejected_at;
    accounts[idx].reviewedBy  = currentAdminUid();
    DB.saveAccounts(accounts);
    updateRegistrationRequests(uid, 'rejected');
    const ok = await pushRegistrationCloud(uid, accounts[idx], 'rejected');
    if (!ok) App.toast('⚠️ Enregistré localement, mais Firestore n\'a pas confirmé l\'écriture. Vérifiez la connexion et réessayez.', 'error');

    Network?.notify?.({
      to_role: accounts[idx].role, to_id: accounts[idx].uid, type:'info',
      subject: '❌ Demande rejetée — MedConnect',
      body: `Votre demande d'inscription a été rejetée.\nContactez l'administrateur : +243 856 373 707`,
    });
    App.toast('❌ Demande rejetée');
    App.closeModal?.();
    App.navigateTo('dashboard');
  }

  function suspend(uid) {
    if (!uid || !confirm('Suspendre cet utilisateur ?')) return;
    const accounts = getAccountsSafe();
    const idx = accounts.findIndex(a => a.uid === uid);
    if (idx === -1) return;
    accounts[idx].status = 'suspended';
    accounts[idx].suspended_at = now();
    DB.saveAccounts(accounts);
    pushRegistrationCloud(uid, accounts[idx], 'suspended');
    App.toast('🚫 Utilisateur suspendu');
    App.navigateTo('dashboard');
  }

  function openDetail(uid) {
    const rows = getRegistrationRows();
    const a = rows.find(x => x.uid === uid || x.requesterUid === uid);
    if (!a) { App.toast('❌ Demande introuvable.', 'error'); return; }
    const role = safeRole(a.role || a.requesterRole);
    const number = roleProfessionalNumber(a);
    const date = String(a.createdAt || a.created_at || a.submittedAt || '');

    App.openModal(`🔍 Vérification — ${accountLabel(a)}`, `
      <div class="auth-register-info" style="margin-bottom:1rem">
        Vérifiez ces informations avant de prendre une décision. L’approbation active le compte professionnel.
      </div>
      <table class="info-table">
        <tr><td>Nom</td><td><strong>${esc(accountLabel(a))}</strong></td></tr>
        <tr><td>Rôle demandé</td><td><span class="role-badge role-${esc(role)}">${esc(roleLabel(role))}</span></td></tr>
        <tr><td>Email</td><td>${esc(a.email || '—')}</td></tr>
        <tr><td>Identifiant</td><td style="font-family:monospace">${esc(a.username || number || '—')}</td></tr>
        <tr><td>${role === 'doctor' ? 'N° Ordre' : 'Matricule'}</td><td style="font-family:monospace;color:var(--secondary)">${esc(number || '—')}</td></tr>
        ${a.specialty ? `<tr><td>Spécialité</td><td>${esc(a.specialty)}</td></tr>` : ''}
        ${a.pharmacy  ? `<tr><td>Pharmacie</td><td>${esc(a.pharmacy)}</td></tr>` : ''}
        <tr><td>Date demande</td><td>${date.slice(0,10) || '—'}</td></tr>
        <tr><td>Source</td><td>${esc(a.source || 'compte')}</td></tr>
        <tr><td>Statut</td><td style="color:${a.status==='pending'?'var(--accent)':a.status==='approved'?'var(--secondary)':'var(--danger)'}">${statusText(a.status)}</td></tr>
      </table>
      <div class="card" style="margin-top:1rem;padding:1rem">
        <h4 style="margin-bottom:.5rem">Checklist de validation</h4>
        <p style="font-size:.82rem;color:var(--text-muted)">☐ Numéro professionnel correct</p>
        <p style="font-size:.82rem;color:var(--text-muted)">☐ Nom cohérent avec le registre ou la pièce fournie</p>
        <p style="font-size:.82rem;color:var(--text-muted)">☐ Email utilisable pour la connexion</p>
        <p style="font-size:.82rem;color:var(--text-muted)">☐ Rôle demandé cohérent</p>
      </div>
      <div class="form-actions" style="margin-top:1rem">
        ${a.status==='pending' ? `
          <button class="btn btn-ghost btn-sm" style="color:var(--secondary);border-color:rgba(16,185,129,.3)" onclick="AdminModule.approve('${esc(a.uid || a.requesterUid)}')">✅ Approuver cette demande</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3)" onclick="AdminModule.reject('${esc(a.uid || a.requesterUid)}')">❌ Refuser cette demande</button>` : ''}
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
          <input type="text" id="bc-sub" required placeholder="Ex: Maintenance prévue, Mise à jour disponible…">
        </div>
        <div class="form-group">
          <label>Message *</label>
          <textarea id="bc-body" rows="5" required placeholder="Contenu de votre message…"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">📤 Envoyer</button>
        </div>
      </form>`);
  }

  function sendBroadcast(e) {
    e.preventDefault();
    const role    = document.getElementById('bc-role')?.value || 'all';
    const subject = document.getElementById('bc-sub')?.value || '';
    const body    = document.getElementById('bc-body')?.value || '';
    const targets = getAccountsSafe().filter(a =>
      ['approved','active'].includes(a.status) && (role === 'all' || a.role === role)
    );
    targets.forEach(a => Network?.notify?.({ to_role:a.role, to_id:a.uid, type:'info', subject, body }));
    App.closeModal();
    App.toast(`📢 Message envoyé à ${targets.length} utilisateur(s)`);
  }

  /* ══ GESTION REGISTRES ═══════════════════════════════ */
  function openRegistryManager() {
    const doctors = safeList(() => ACL.getVerifiedDoctors());
    const pharms  = safeList(() => ACL.getVerifiedPharmacists());
    const nurses  = safeList(() => ACL.getVerifiedNurses());

    App.openModal('📋 Gestion des registres officiels', `
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem"><strong style="font-size:.88rem">👨‍⚕️ Médecins (${doctors.length})</strong><button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('doctor')">+ Ajouter</button></div>
        ${doctors.map(d => `<div class="admin-row"><div><span style="font-family:monospace;font-size:.73rem;color:var(--secondary)">${esc(d.order_num)}</span><strong style="font-size:.82rem;display:block">${esc(d.name)}</strong><small style="color:var(--text-muted)">${esc(d.specialty||'')} · ${esc(d.country||'')}</small></div><button class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="ACL.removeVerifiedDoctor('${esc(d.order_num)}');AdminModule.openRegistryManager()">🗑️</button></div>`).join('')}
      </div>
      <div style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem"><strong style="font-size:.88rem">💊 Pharmaciens (${pharms.length})</strong><button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('pharmacist')">+ Ajouter</button></div>
        ${pharms.map(p => `<div class="admin-row"><div><span style="font-family:monospace;font-size:.73rem;color:var(--purple)">${esc(p.matricule)}</span><strong style="font-size:.82rem;display:block">${esc(p.name)}</strong><small style="color:var(--text-muted)">${esc(p.pharmacy||'')} · ${esc(p.country||'')}</small></div><button class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="ACL.removeVerifiedPharmacist('${esc(p.matricule)}');AdminModule.openRegistryManager()">🗑️</button></div>`).join('')}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem"><strong style="font-size:.88rem">🩹 Infirmiers (${nurses.length})</strong><button class="btn btn-ghost btn-xs" onclick="AdminModule.openAddToRegistry('nurse')">+ Ajouter</button></div>
        ${nurses.map(n => `<div class="admin-row"><div><span style="font-family:monospace;font-size:.73rem;color:#06B6D4">${esc(n.matricule)}</span><strong style="font-size:.82rem;display:block">${esc(n.name)}</strong><small style="color:var(--text-muted)">${esc(n.country||'')}</small></div></div>`).join('')}
      </div>
      <div class="form-actions" style="margin-top:1rem"><button class="btn btn-ghost" onclick="App.closeModal()">Fermer</button></div>`);
  }

  function openAddToRegistry(role) {
    const countries = safeList(() => PatientPortal?.getCountriesList?.());
    const isDoc  = role === 'doctor';
    const isPh   = role === 'pharmacist';
    App.openModal(`➕ Ajouter au registre — ${isDoc?'Médecin':isPh?'Pharmacien':'Infirmier'}`, `
      <form onsubmit="AdminModule.saveToRegistry(event,'${role}')">
        <div class="form-group"><label>${isDoc?'N° Ordre Médical':'N° Matricule'} * (tout format)</label><input type="text" id="reg-num" required placeholder="Numéro officiel — format libre" style="text-transform:uppercase;font-family:monospace" oninput="this.value=this.value.toUpperCase()"></div>
        <div class="form-group"><label>Nom complet *</label><input type="text" id="reg-name" required></div>
        ${isDoc ? `<div class="form-group"><label>Spécialité</label><input type="text" id="reg-spec" placeholder="Médecine générale…"></div><div class="form-group"><label>Hôpital / Clinique</label><input type="text" id="reg-hosp"></div>` : ''}
        ${isPh ? `<div class="form-group"><label>Nom de la pharmacie</label><input type="text" id="reg-pharm"></div>` : ''}
        <div class="form-group"><label>Pays *</label><select id="reg-country" required><option value="">— Pays —</option>${countries.map(c=>`<option value="${esc(c.code)}">${esc(c.flag)} ${esc(c.name)}</option>`).join('')}</select></div>
        <div class="form-actions"><button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button><button type="submit" class="btn btn-primary">✅ Ajouter</button></div>
      </form>`);
  }

  function saveToRegistry(e, role) {
    e.preventDefault();
    const num     = (document.getElementById('reg-num')?.value || '').trim().toUpperCase();
    const name    = (document.getElementById('reg-name')?.value || '').trim();
    const country = document.getElementById('reg-country')?.value || '';
    let ok = false;
    if (role === 'doctor') ok = ACL.addVerifiedDoctor({ order_num: num, name, country, specialty: document.getElementById('reg-spec')?.value||'', hospital: document.getElementById('reg-hosp')?.value||'' });
    else if (role === 'pharmacist') ok = ACL.addVerifiedPharmacist({ matricule: num, name, country, pharmacy: document.getElementById('reg-pharm')?.value||'' });
    else ok = ACL.addVerifiedNurse({ matricule: num, name, country });
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
