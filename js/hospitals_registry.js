/* =====================================================
   MedConnect 2.0 — Registre des Établissements
   Établissements · Affiliations · Personnel · Dossiers
   ===================================================== */
const HospitalsRegistry = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const now = () => new Date().toISOString();

  const EST_KEY = 'establishments';
  const REQ_KEY = 'affiliation_requests';
  const LEGACY_EST_KEY = 'mc_hospitals';
  const LEGACY_REQ_KEY = 'mc_affiliations';

  const TYPE_LABELS = {
    hospital: 'Hôpital',
    clinic: 'Clinique',
    medical_center: 'Centre médical',
    hospital_pharmacy: 'Pharmacie hospitalière',
    health_center: 'Centre médical',
    pharmacy: 'Pharmacie hospitalière',
  };
  const TYPE_ICONS = {
    hospital: '🏥',
    clinic: '🏨',
    medical_center: '🏢',
    hospital_pharmacy: '💊',
    health_center: '🏢',
    pharmacy: '💊',
  };

  function load(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function store(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function cloudReady() {
    return typeof firebaseReady !== 'undefined' && firebaseReady &&
      typeof firebaseDB !== 'undefined' && firebaseDB;
  }

  function pushCloud(collection, docId, data) {
    if (!cloudReady()) return;
    firebaseDB.collection(collection).doc(String(docId)).set(data).catch(() => {});
  }

  function normalizeType(type) {
    if (type === 'health_center') return 'medical_center';
    if (type === 'pharmacy') return 'hospital_pharmacy';
    return type || 'hospital';
  }

  function normalizeEstablishment(raw = {}) {
    const establishmentId = raw.establishmentId || raw.hid || raw.id || DB.makeId('EST');
    const createdAt = raw.createdAt || raw.created_at || now();
    const updatedAt = raw.updatedAt || raw.updated_at || createdAt;
    const latitude = raw.latitude ?? raw.lat ?? '';
    const longitude = raw.longitude ?? raw.lng ?? raw.lon ?? '';
    const staff = Array.isArray(raw.staff) ? raw.staff : [];

    return {
      ...raw,
      establishmentId,
      hid: establishmentId,
      name: raw.name || raw.establishmentName || '',
      officialId: raw.officialId || raw.matricule || raw.official_id || raw.identifier || '',
      type: normalizeType(raw.type),
      phone: raw.phone || '',
      address: raw.address || '',
      city: raw.city || '',
      country: raw.country || '',
      latitude: latitude === '' ? '' : Number(latitude),
      longitude: longitude === '' ? '' : Number(longitude),
      status: raw.status || 'active',
      staff,
      createdAt,
      updatedAt,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  function normalizeRequest(raw = {}) {
    const establishmentId = raw.establishmentId || raw.hid || '';
    const establishment = establishmentId ? getHospitalById(establishmentId) : null;
    const requesterUid = raw.requesterUid || raw.doctor_uid || raw.uid || '';
    const account = DB.getAccounts().find(a => a.uid === requesterUid) || {};
    const requesterRole = raw.requesterRole || raw.role || account.role || 'doctor';
    const professionalNumber = raw.professionalNumber || raw.order_num || raw.matricule ||
      account.order_num || account.matricule || account.username || '';
    // requestId STABLE : ne JAMAIS régénérer un ID aléatoire à la
    // lecture — sinon l'ID affiché sur le bouton diffère de l'ID
    // retrouvé au clic, et respondAffiliation ne trouve pas la
    // demande (bouton sans effet). Si l'ID manque, on le dérive de
    // façon DÉTERMINISTE de l'identité de la demande, pour que la
    // même demande produise toujours le même ID.
    const requestId = raw.requestId || raw.afid ||
      ((requesterUid && establishmentId)
        ? `AFF_${requesterUid}_${establishmentId}`
        : DB.makeId('AFF'));
    const createdAt = raw.createdAt || raw.requested_at || raw.created_at || now();
    const updatedAt = raw.updatedAt || raw.decided_at || raw.updated_at || createdAt;
    const requesterName = raw.requesterName || raw.doctor_name || account.name || '';
    const establishmentName = raw.establishmentName || establishment?.name || raw.hospital_name || '';

    return {
      ...raw,
      requestId,
      afid: requestId,
      requesterUid,
      requesterName,
      requesterRole,
      professionalNumber,
      establishmentId,
      establishmentName,
      status: raw.status || 'pending',
      createdAt,
      updatedAt,
      doctor_uid: requesterUid,
      doctor_name: requesterName,
      hid: establishmentId,
      requested_at: createdAt,
      decided_at: raw.decided_at || (raw.status && raw.status !== 'pending' ? updatedAt : ''),
    };
  }

  function mergeById(items, idKey) {
    const map = new Map();
    items.forEach(item => {
      const id = item?.[idKey] || item?.hid || item?.afid;
      if (!id) return;
      map.set(id, { ...(map.get(id) || {}), ...item });
    });
    return [...map.values()];
  }

  /* ── ÉTABLISSEMENTS ─────────────────────────────── */
  function getHospitals() {
    const modern = load(EST_KEY).map(normalizeEstablishment);
    const legacy = load(LEGACY_EST_KEY).map(normalizeEstablishment);
    return mergeById([...legacy, ...modern], 'establishmentId');
  }

  function saveHospitals(list) {
    const normalized = list.map(normalizeEstablishment);
    store(EST_KEY, normalized);
    store(LEGACY_EST_KEY, normalized);
    normalized.forEach(h => {
      pushCloud('establishments', h.establishmentId, h);
      pushCloud('hospitals', h.establishmentId, h);
      pushCloud('mc_hospitals', h.establishmentId, h);
    });
  }

  function addHospital(data) {
    const list = getHospitals();
    const h = normalizeEstablishment({
      ...data,
      establishmentId: data.establishmentId || DB.makeId('EST'),
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    });
    list.push(h);
    saveHospitals(list);
    return h;
  }

  function updateHospital(establishmentId, data) {
    const list = getHospitals();
    const idx = list.findIndex(h => h.establishmentId === establishmentId || h.hid === establishmentId);
    if (idx === -1) return null;
    list[idx] = normalizeEstablishment({ ...list[idx], ...data, establishmentId, updatedAt: now() });
    saveHospitals(list);
    return list[idx];
  }

  function getHospitalById(establishmentId) {
    return getHospitals().find(h => h.establishmentId === establishmentId || h.hid === establishmentId) || null;
  }

  /* ── DEMANDES D'AFFILIATION ─────────────────────── */
  function getAffiliations() {
    const modern = load(REQ_KEY).map(normalizeRequest);
    const legacy = load(LEGACY_REQ_KEY).map(normalizeRequest);
    return mergeById([...legacy, ...modern], 'requestId');
  }

  function saveAffiliations(list) {
    const normalized = list.map(normalizeRequest);
    store(REQ_KEY, normalized);
    store(LEGACY_REQ_KEY, normalized);
    normalized.forEach(a => {
      pushCloud('affiliation_requests', a.requestId, a);
      pushCloud('mc_affiliations', a.requestId, a);
    });
  }

  function professionalNumberFor(user) {
    return user?.order_num || user?.matricule || user?.username || '';
  }

  function requestAffiliation(requesterUid, requesterName, establishmentId, options = {}) {
    const user = Auth.getUser() || {};
    const account = DB.getAccounts().find(a => a.uid === requesterUid) || user;
    const requesterRole = options.role || options.requesterRole || account.role || user.role || 'doctor';
    // Tous les rôles hospitaliers peuvent demander une affiliation
    // (médecin, infirmier, pharmacie, laboratoire, réception).
    if (!['doctor','nurse','pharmacist','lab','reception'].includes(requesterRole)) return false;

    const h = getHospitalById(establishmentId);
    if (!h) return false;

    const affs = getAffiliations();
    const existing = affs.find(a =>
      a.requesterUid === requesterUid &&
      a.establishmentId === establishmentId &&
      ['pending','approved'].includes(a.status)
    );
    if (existing) return false;

    const a = normalizeRequest({
      // ID déterministe (cohérent avec normalizeRequest) : évite les
      // doublons et garantit que les boutons admin retrouvent la demande.
      requestId: `AFF_${requesterUid}_${establishmentId}`,
      requesterUid,
      requesterName,
      requesterRole,
      professionalNumber: options.professionalNumber || professionalNumberFor(account),
      establishmentId,
      establishmentName: h.name,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    });
    affs.push(a);
    saveAffiliations(affs);
    if (!options.silent) notifyAffiliationRequest(a);
    return a;
  }

  function notifyAffiliationRequest(affiliation) {
    const h = getHospitalById(affiliation.establishmentId);
    if (!window.Network?.notify) return;
    Network.notify({
      to_role: h?.owner_role || 'admin',
      to_id: h?.owner_uid || 'admin_root',
      type: 'info',
      subject: `🏥 Demande d'affiliation — ${affiliation.requesterName}`,
      body: [
        `${affiliation.requesterName} demande à rejoindre ${h?.name || 'cet établissement'}.`,
        `Rôle : ${Auth.getRoleLabel?.(affiliation.requesterRole) || affiliation.requesterRole}`,
        `Numéro professionnel : ${affiliation.professionalNumber || '—'}`,
        ``,
        `Cette demande est aussi disponible dans Administration > Établissements > Demandes d'affiliation.`,
      ].join('\n'),
    });
  }

  function upsertStaffMember(establishment, request) {
    const staff = Array.isArray(establishment.staff) ? establishment.staff : [];
    const idx = staff.findIndex(s => s.uid === request.requesterUid);
    const member = {
      uid: request.requesterUid,
      name: request.requesterName,
      role: request.requesterRole,
      professionalNumber: request.professionalNumber,
      establishmentId: establishment.establishmentId,
      establishmentName: establishment.name,
      status: 'active',
      linkedAt: idx === -1 ? now() : (staff[idx].linkedAt || now()),
      updatedAt: now(),
    };
    if (idx === -1) staff.push(member);
    else staff[idx] = { ...staff[idx], ...member };
    updateHospital(establishment.establishmentId, { staff });
  }

  function updateUserAffiliation(request, establishment, attach) {
    const accounts = DB.getAccounts();
    const idx = accounts.findIndex(a => a.uid === request.requesterUid);
    if (idx === -1) return;

    const current = accounts[idx];
    const affiliations = Array.isArray(current.establishments) ? current.establishments : [];
    const filtered = affiliations.filter(a => a.establishmentId !== establishment.establishmentId);

    if (attach) {
      filtered.push({
        establishmentId: establishment.establishmentId,
        establishmentName: establishment.name,
        role: request.requesterRole,
        status: 'active',
        linkedAt: now(),
      });
      accounts[idx] = {
        ...current,
        establishmentId: establishment.establishmentId,
        establishmentName: establishment.name,
        hospital_id: establishment.establishmentId,
        hospital: establishment.name,
        establishments: filtered,
        updated_at: now(),
      };
    } else {
      const next = { ...current, establishments: filtered, updated_at: now() };
      if (next.establishmentId === establishment.establishmentId || next.hospital_id === establishment.establishmentId) {
        delete next.establishmentId;
        delete next.establishmentName;
        delete next.hospital_id;
        delete next.hospital;
      }
      accounts[idx] = next;
    }

    DB.saveAccounts(accounts);
  }

  function respondAffiliation(requestId, approved) {
    const affs = getAffiliations();
    let idx = affs.findIndex(a => a.requestId === requestId || a.afid === requestId);
    // Repli : l'ID déterministe encode uid+établissement.
    if (idx === -1 && String(requestId).startsWith('AFF_')) {
      const parts = String(requestId).slice(4).split('_');
      const estId = parts.pop();
      const uid = parts.join('_');
      idx = affs.findIndex(a => a.requesterUid === uid && a.establishmentId === estId);
    }
    if (idx === -1) {
      App?.toast?.('Demande introuvable (elle a peut-être déjà été traitée).', 'error');
      return;
    }

    const req = normalizeRequest(affs[idx]);
    const h = getHospitalById(req.establishmentId);
    if (!h) { App?.toast?.('Établissement introuvable pour cette demande.', 'error'); return; }

    affs[idx] = normalizeRequest({
      ...req,
      status: approved ? 'approved' : 'rejected',
      updatedAt: now(),
      decided_at: now(),
    });
    saveAffiliations(affs);

    if (approved) {
      upsertStaffMember(h, affs[idx]);
      updateUserAffiliation(affs[idx], h, true);
    }
    App?.toast?.(approved ? '✅ Affiliation approuvée.' : '❌ Affiliation refusée.');

    if (window.Network?.notify) {
      Network.notify({
        to_role: affs[idx].requesterRole,
        to_id: affs[idx].requesterUid,
        type: 'info',
        subject: approved
          ? `✅ Affiliation approuvée — ${h.name || 'Établissement'}`
          : `❌ Affiliation refusée — ${h.name || 'Établissement'}`,
        body: approved
          ? `Votre demande d'affiliation à ${h.name} a été approuvée. Vous pouvez maintenant y accéder.`
          : `Votre demande d'affiliation à ${h.name} a été refusée par l'administrateur.`,
      });
    }
    App.toast(approved ? '✅ Affiliation approuvée' : '❌ Affiliation refusée');
  }

  function removeStaff(establishmentId, uid) {
    const h = getHospitalById(establishmentId);
    if (!h) return;
    if (!confirm(`Retirer cette affiliation de ${h.name} ?`)) return;

    const staff = (h.staff || []).map(member =>
      member.uid === uid ? { ...member, status: 'removed', removedAt: now(), updatedAt: now() } : member
    );
    updateHospital(establishmentId, { staff });

    const reqs = getAffiliations().map(req => {
      if (req.requesterUid === uid && req.establishmentId === establishmentId && req.status === 'approved') {
        return normalizeRequest({ ...req, status: 'removed', updatedAt: now(), decided_at: now() });
      }
      return req;
    });
    saveAffiliations(reqs);
    updateUserAffiliation({ requesterUid: uid }, h, false);
    App.toast('Affiliation retirée');
    renderManagePage(document.getElementById('main-content'), 'staff');
  }

  function getDoctorHospitals(uid) {
    const affs = getAffiliations().filter(a => a.requesterUid === uid && a.status === 'approved');
    return affs.map(a => getHospitalById(a.establishmentId)).filter(Boolean);
  }

  function getPendingAffiliations(establishmentId) {
    const h = getHospitalById(establishmentId);
    const activeStaffUids = new Set(
      (h?.staff || []).filter(s => s.status === 'active' || s.status === 'approved').map(s => s.uid));
    // Une demande dont l'agent est DÉJÀ membre actif n'est plus « en
    // attente » : c'est l'incohérence observée (personne active ET
    // demande pending). On l'exclut de la file, et on réconcilie son
    // statut en base pour ne plus la revoir.
    const stillPending = [];
    const toReconcile = [];
    getAffiliations().forEach(a => {
      if (a.establishmentId !== establishmentId || a.status !== 'pending') return;
      if (activeStaffUids.has(a.requesterUid)) toReconcile.push(a);
      else stillPending.push(a);
    });
    if (toReconcile.length) {
      const all = getAffiliations().map(a =>
        toReconcile.find(t => t.requestId === a.requestId)
          ? { ...a, status: 'approved', decided_at: a.decided_at || now(), updatedAt: now() }
          : a);
      saveAffiliations(all);
    }
    return stillPending;
  }

  /* ── CONTEXTE ACTIF ─────────────────────────────── */
  function getCurrentHospital() {
    const id = sessionStorage.getItem('mc_current_hospital');
    return id ? getHospitalById(id) : null;
  }

  function setCurrentHospital(establishmentId) {
    sessionStorage.setItem('mc_current_hospital', establishmentId);
    const h = getHospitalById(establishmentId);
    App.toast(`🏥 Établissement : ${h?.name || '—'}`);

    // Session hôpital desktop (connexion par matricule) : il n'y a pas
    // d'utilisateur mobile ni de shell mobile à rafraîchir — on s'arrête
    // là pour ne pas déclencher un rendu mobile parasite.
    const user = Auth.getUser();
    if (!user) return;

    if (window.App?.buildNav) App.buildNav(user);
    if (window.App?.navigateTo) App.navigateTo('dashboard');
    // Les listeners du contrat d'échange filtrent sur l'hôpital actif :
    // ils doivent être relancés quand il change.
    if (window.App?.startExchangeSync) App.startExchangeSync(user);
  }

  function clearCurrentHospital() {
    sessionStorage.removeItem('mc_current_hospital');
  }

  function activeStaffUids(establishmentId) {
    const h = getHospitalById(establishmentId);
    return (h?.staff || []).filter(s => s.status !== 'removed').map(s => s.uid);
  }

  function getPatientsForEstablishment(establishmentId) {
    const staffUids = activeStaffUids(establishmentId);
    return DB.getPatients().filter(p =>
      p.establishmentId === establishmentId ||
      p.hospital_id === establishmentId ||
      staffUids.includes(p.created_by)
    );
  }

  function getPatientsForContext(uid) {
    const h = getCurrentHospital();
    // Hors établissement (praticien solo) : seulement ses propres
    // patients. DANS un établissement : TOUT le personnel partage les
    // patients de l'hôpital — un patient créé par un collègue ne doit
    // pas être invisible (c'était la cause des ordonnances non
    // affichées : la liste de patients servant de base au filtre était
    // amputée des patients créés par d'autres membres du même hôpital).
    if (!h) return DB.getPatients().filter(p => !p.created_by || p.created_by === uid);
    return getPatientsForEstablishment(h.establishmentId);
  }

  function getAppointmentsForContext(uid) {
    const h = getCurrentHospital();
    return DB.getAppointments().filter(a =>
      (!uid || a.doctor_uid === uid || a.created_by === uid) &&
      (!h || a.establishmentId === h.establishmentId || a.hospital_id === h.establishmentId || !a.hospital_id)
    );
  }

  /* ── UI PARTAGÉE ────────────────────────────────── */
  function renderHospitalSwitcher(uid) {
    const hospitals = getDoctorHospitals(uid);
    const current = getCurrentHospital();

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
        <select onchange="HospitalsRegistry.setCurrentHospital(this.value)">
          ${hospitals.map(h =>
            `<option value="${h.establishmentId}" ${h.establishmentId===current?.establishmentId?'selected':''}>${esc(h.name)} — ${esc(h.city||h.country||'')}</option>`
          ).join('')}
        </select>
      </div>`;
  }

  function renderEstablishmentForm() {
    return `
      <form onsubmit="HospitalsRegistry.saveHospital(event)">
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Nom de l'établissement *</label>
            <input type="text" id="h-name" required placeholder="CHU, Clinique, Centre médical...">
          </div>
          <div class="form-group">
            <label>Numéro matricule / identifiant officiel *</label>
            <input type="text" id="h-official" required style="text-transform:uppercase;font-family:monospace"
              oninput="this.value=this.value.toUpperCase()">
          </div>
          <div class="form-group">
            <label>Type *</label>
            <select id="h-type" required>
              <option value="hospital">🏥 Hôpital</option>
              <option value="clinic">🏨 Clinique</option>
              <option value="medical_center">🏢 Centre médical</option>
              <option value="hospital_pharmacy">💊 Pharmacie hospitalière</option>
            </select>
          </div>
          <div class="form-group"><label>Téléphone</label><input type="tel" id="h-phone"></div>
          <div class="form-group"><label>Ville</label><input type="text" id="h-city"></div>
          <div class="form-group full-width"><label>Adresse</label><input type="text" id="h-address"></div>
          <div class="form-group"><label>Latitude GPS</label><input type="number" step="any" id="h-lat" placeholder="-4.3217"></div>
          <div class="form-group"><label>Longitude GPS</label><input type="number" step="any" id="h-lng" placeholder="15.3125"></div>
          <div class="form-group">
            <label>Statut</label>
            <select id="h-status">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">✅ Enregistrer</button>
        </div>
      </form>`;
  }

  function openRequestAffiliation() {
    const hospitals = getHospitals().filter(h => h.status !== 'inactive');
    App.openModal('🏥 Demander une affiliation', `
      <p style="font-size:.84rem;color:var(--text-muted);margin-bottom:1rem">
        La demande sera enregistrée dans <strong>affiliation_requests</strong> et visible dans
        Administration > Établissements > Demandes d'affiliation.
      </p>
      <form onsubmit="HospitalsRegistry.submitAffiliation(event)">
        <div class="form-group">
          <label>Établissement *</label>
          <select id="aff-hid" required>
            <option value="">— Choisir —</option>
            ${hospitals.map(h =>
              `<option value="${h.establishmentId}">${esc(h.name)} — ${esc(h.city||'')}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Ou créer un nouvel établissement</label>
          <button type="button" class="btn btn-ghost btn-sm"
            onclick="App.closeModal();HospitalsRegistry.openCreateHospital()">+ Créer un établissement</button>
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
    const id = document.getElementById('aff-hid').value;
    const ok = requestAffiliation(user.uid, user.name, id);
    App.closeModal();
    App.toast(ok ? '📤 Demande d’affiliation enregistrée' : '⚠️ Demande déjà envoyée ou rôle non autorisé', ok?'success':'error');
  }

  function openCreateHospital() {
    App.openModal('🏥 Ajouter un établissement', renderEstablishmentForm());
  }

  function saveHospital(e) {
    e.preventDefault();
    const user = Auth.getUser() || {};
    const h = addHospital({
      name: document.getElementById('h-name').value.trim(),
      officialId: document.getElementById('h-official').value.trim().toUpperCase(),
      type: document.getElementById('h-type').value,
      phone: document.getElementById('h-phone').value.trim(),
      address: document.getElementById('h-address').value.trim(),
      city: document.getElementById('h-city').value.trim(),
      latitude: document.getElementById('h-lat').value,
      longitude: document.getElementById('h-lng').value,
      status: document.getElementById('h-status').value,
      owner_uid: user.uid || 'admin_root',
      owner_role: user.role || 'admin',
    });

    if (['doctor','nurse'].includes(user.role)) {
      // DEMANDE pending uniquement — JAMAIS d'auto-approbation. Le
      // professionnel ne devient membre qu'après validation par
      // l'admin. (L'ancien code appelait respondAffiliation(...,true)
      // ici, ce qui transformait la demande en enregistrement validé
      // et court-circuitait l'administrateur.)
      const a = requestAffiliation(user.uid, user.name, h.establishmentId);
      App.closeModal();
      App.toast(a
        ? '📤 Établissement créé. Demande d’affiliation envoyée à l’administrateur.'
        : '⚠️ Établissement créé, mais une demande existe déjà ou le rôle n’est pas autorisé.',
        a ? 'success' : 'error');
    } else {
      App.closeModal();
      App.toast(`✅ Établissement enregistré — ${h.name}`);
      const main = document.getElementById('main-content');
      if (main) renderManagePage(main, 'list');
    }
  }

  /* ── ADMIN : ÉTABLISSEMENTS ─────────────────────── */
  function adminTabs(active) {
    const tabs = [
      ['list', '📋 Liste des établissements'],
      ['add', '➕ Ajouter un établissement'],
      ['requests', '⏳ Demandes d’affiliation'],
      ['staff', '👩‍⚕️ Personnel médical'],
      ['records', '🗂️ Dossiers médicaux'],
      ['data', '📍 Données & informations'],
    ];
    return `<div class="header-actions" style="margin-bottom:1rem;flex-wrap:wrap">
      ${tabs.map(([id,label]) => `
        <button class="chip-filter ${active===id?'active':''}"
          onclick="HospitalsRegistry.renderManagePage(document.getElementById('main-content'),'${id}')">${label}</button>
      `).join('')}
    </div>`;
  }

  function statusChip(status) {
    const color = ['active','approved'].includes(status) ? 'var(--secondary)' :
      status === 'pending' ? 'var(--accent)' : 'var(--danger)';
    const labels = { active:'Active', inactive:'Inactive', approved:'Approuvée', rejected:'Refusée', removed:'Retirée', pending:'En attente' };
    const label = labels[status] || status;
    return `<span class="chip" style="color:${color};border-color:${color}">${label}</span>`;
  }

  function renderAdminList() {
    const hospitals = getHospitals();
    if (!hospitals.length) return `<div class="card empty-state"><p>Aucun établissement enregistré</p></div>`;
    return `<div class="records-list">
      ${hospitals.map(h => `
        <div class="record-card">
          <div class="record-header">
            <span style="font-size:1.25rem">${TYPE_ICONS[h.type] || '🏥'}</span>
            <strong>${esc(h.name)}</strong>
            ${statusChip(h.status)}
            <span class="record-date">${esc(TYPE_LABELS[h.type] || h.type)}</span>
          </div>
          <p style="font-size:.83rem;color:var(--text-muted)">
            <span style="font-family:monospace">${esc(h.officialId || 'Identifiant non renseigné')}</span>
            ${h.city ? ` · ${esc(h.city)}` : ''}${h.phone ? ` · 📞 ${esc(h.phone)}` : ''}
          </p>
          <p style="font-size:.8rem;color:var(--text-dim)">
            GPS : ${h.latitude !== '' && h.longitude !== '' ? `${h.latitude}, ${h.longitude}` : 'Non renseignée'}
          </p>
        </div>
      `).join('')}
    </div>`;
  }

  function renderAdminRequests() {
    // Passe par getPendingAffiliations (qui exclut et réconcilie les
    // demandes dont l'agent est déjà membre actif) pour CHAQUE
    // établissement — évite d'afficher les doublons 'active + pending'.
    const pending = getHospitals()
      .flatMap(h => getPendingAffiliations(h.establishmentId));
    const history = getAffiliations().filter(a => a.status !== 'pending').slice().reverse().slice(0, 8);
    return `
      ${pending.length ? `<div class="records-list">
        ${pending.map(a => `
          <div class="record-card">
            <div class="record-header">
              <span>${a.requesterRole === 'nurse' ? '🩹' : '👨‍⚕️'}</span>
              <strong>${esc(a.requesterName)}</strong>
              <span class="role-badge role-${a.requesterRole}">${esc(a.requesterRole)}</span>
              <span class="chip">🏥 ${esc(a.establishmentName)}</span>
              <span class="record-date">📅 ${a.createdAt?.slice(0,10) || '—'}</span>
            </div>
            <p style="font-size:.82rem;color:var(--text-muted);font-family:monospace">
              ${esc(a.professionalNumber || 'Numéro professionnel non renseigné')}
            </p>
            <div style="display:flex;gap:.5rem;margin-top:.65rem;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" style="color:var(--secondary);border-color:rgba(16,185,129,.3)"
                onclick="HospitalsRegistry.respondAffiliation('${a.requestId}',true);HospitalsRegistry.renderManagePage(document.getElementById('main-content'),'requests')">
                ✅ Approuver
              </button>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3)"
                onclick="HospitalsRegistry.respondAffiliation('${a.requestId}',false);HospitalsRegistry.renderManagePage(document.getElementById('main-content'),'requests')">
                ❌ Refuser
              </button>
            </div>
          </div>
        `).join('')}
      </div>` : `<div class="card empty-state"><p>Aucune demande d'affiliation en attente</p></div>`}
      ${history.length ? `
        <h3 style="margin:1.25rem 0 .75rem">Historique récent</h3>
        <div class="records-list">
          ${history.map(a => `
            <div class="record-card" style="opacity:.78">
              <div class="record-header">
                <strong>${esc(a.requesterName)}</strong>
                <span class="chip">🏥 ${esc(a.establishmentName)}</span>
                ${statusChip(a.status)}
                <span class="record-date">${a.updatedAt?.slice(0,10) || '—'}</span>
              </div>
            </div>
          `).join('')}
        </div>` : ''}`;
  }

  function collectStaffRows() {
    const rows = [];
    getHospitals().forEach(h => {
      (h.staff || []).filter(s => s.status !== 'removed').forEach(s => rows.push({ ...s, establishmentId: h.establishmentId, establishmentName: h.name }));
    });
    DB.getAccounts()
      .filter(a => ['doctor','nurse'].includes(a.role) && (a.establishmentId || a.hospital_id))
      .forEach(a => {
        if (!rows.find(r => r.uid === a.uid && r.establishmentId === (a.establishmentId || a.hospital_id))) {
          rows.push({
            uid: a.uid,
            name: a.name,
            role: a.role,
            professionalNumber: professionalNumberFor(a),
            establishmentId: a.establishmentId || a.hospital_id,
            establishmentName: a.establishmentName || a.hospital,
            status: a.status || 'approved',
          });
        }
      });
    return rows;
  }

  function renderAdminStaff() {
    const rows = collectStaffRows();
    if (!rows.length) return `<div class="card empty-state"><p>Aucun médecin ou infirmier affilié</p></div>`;
    return `<div class="records-list">
      ${rows.map(s => `
        <div class="record-card">
          <div class="record-header">
            <span>${s.role === 'nurse' ? '🩹' : '👨‍⚕️'}</span>
            <strong>${esc(s.name)}</strong>
            <span class="role-badge role-${s.role}">${esc(s.role)}</span>
            <span class="chip">🏥 ${esc(s.establishmentName)}</span>
          </div>
          <p style="font-size:.82rem;color:var(--text-muted)">
            Numéro professionnel : <span style="font-family:monospace">${esc(s.professionalNumber || '—')}</span>
            · Statut : ${esc(s.status || 'active')}
          </p>
          <button class="btn btn-ghost btn-xs" style="color:var(--danger);margin-top:.45rem"
            onclick="HospitalsRegistry.removeStaff('${s.establishmentId}','${s.uid}')">Retirer l’affiliation</button>
        </div>
      `).join('')}
    </div>`;
  }

  function renderAdminRecords() {
    const hospitals = getHospitals();
    if (!hospitals.length) return `<div class="card empty-state"><p>Aucun établissement enregistré</p></div>`;
    const recentDocs = (DB.getEstablishmentDocuments?.() || []).slice(-10).reverse();
    return `
      <div class="auth-register-info">
        Accès contrôlé : l'admin peut gérer, un établissement voit ses dossiers, un médecin voit ses patients,
        et un patient voit uniquement son propre dossier.
      </div>
      ${recentDocs.length ? `
        <h4 style="margin:.75rem 0 .5rem;font-size:.85rem;color:var(--text-muted)">🗂️ Journal des documents (récents)</h4>
        <div class="records-list" style="margin-bottom:1rem">
          ${recentDocs.map(d => `
            <div class="record-card" style="padding:.6rem .85rem">
              <div class="record-header">
                <span>${d.documentType === 'prescription' ? '💊' : d.documentType === 'consultation' ? '🩺' : '📄'}</span>
                <strong style="font-size:.82rem">${esc(d.documentTitle || d.documentType)}</strong>
                <span class="chip" style="font-size:.7rem">${esc(d.establishmentName || '—')}</span>
                <span class="record-date" style="font-size:.72rem">${d.createdAt?.slice(0,16).replace('T',' ') || '—'}</span>
              </div>
              <p style="font-size:.74rem;color:var(--text-muted)">
                Dr. ${esc(d.doctorName || '—')}${d.doctorOrderNumber?' · N° '+esc(d.doctorOrderNumber):''} ·
                Patient : <span class="id-tag">${esc(d.patientCode || '—')}</span>
              </p>
            </div>`).join('')}
        </div>` : ''}
      <div class="records-list">
        ${hospitals.map(h => {
          const patients = getPatientsForEstablishment(h.establishmentId);
          const pids = patients.map(p => p.id);
          const consultations = DB.getConsultations().filter(c => pids.includes(c.patient_id) || c.establishmentId === h.establishmentId || c.hospital_id === h.establishmentId);
          const labs = DB.getAllLabResults().filter(l => pids.includes(l.patient_id) || l.establishmentId === h.establishmentId || l.hospital_id === h.establishmentId);
          const rxs = (DB.getPrescriptions?.() || []).filter(p => pids.includes(p.patient_id) || p.establishmentId === h.establishmentId || p.hospital_id === h.establishmentId);
          return `
            <div class="record-card">
              <div class="record-header">
                <span>${TYPE_ICONS[h.type] || '🏥'}</span>
                <strong>${esc(h.name)}</strong>
                <span class="chip">🩺 ${patients.length} dossier(s)</span>
                <span class="chip">📋 ${consultations.length} consultation(s)</span>
                <span class="chip">💊 ${rxs.length} ordonnance(s)</span>
                <span class="chip">🧪 ${labs.length} analyse(s)</span>
              </div>
              ${patients.slice(0,4).map(p => `
                <p style="font-size:.82rem;color:var(--text-muted)">
                  <span class="id-tag">${esc(p.id)}</span> ${esc(`${p.firstname || ''} ${p.lastname || ''}`.trim())}
                </p>
              `).join('')}
              ${patients.length > 4 ? `<p style="font-size:.78rem;color:var(--text-dim)">+${patients.length - 4} autres dossiers</p>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  }

  function renderAdminData() {
    const hospitals = getHospitals();
    return `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">🏥</div><div class="stat-value">${hospitals.length}</div><div class="stat-label">Établissements</div></div>
        <div class="stat-card"><div class="stat-icon">📍</div><div class="stat-value">${hospitals.filter(h => h.latitude !== '' && h.longitude !== '').length}</div><div class="stat-label">Avec GPS</div></div>
        <div class="stat-card"><div class="stat-icon">👩‍⚕️</div><div class="stat-value">${collectStaffRows().length}</div><div class="stat-label">Personnel affilié</div></div>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Établissement</th><th>Identifiant</th><th>Type</th><th>Ville</th><th>GPS</th><th>MAJ</th></tr></thead>
          <tbody>
            ${hospitals.map(h => `
              <tr>
                <td>${esc(h.name)}</td>
                <td style="font-family:monospace">${esc(h.officialId || '—')}</td>
                <td>${esc(TYPE_LABELS[h.type] || h.type)}</td>
                <td>${esc(h.city || '—')}</td>
                <td>${h.latitude !== '' && h.longitude !== '' ? `${h.latitude}, ${h.longitude}` : '—'}</td>
                <td>${h.updatedAt?.slice(0,10) || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderAdminPage(main, tab = 'list') {
    const hospitals = getHospitals();
    // Compteur cohérent avec la liste : demandes réellement en attente
    // (hors agents déjà membres actifs), via getPendingAffiliations.
    const pending = hospitals.flatMap(h => getPendingAffiliations(h.establishmentId));
    const content = {
      list: renderAdminList,
      add: () => `<div class="card">${renderEstablishmentForm()}</div>`,
      requests: renderAdminRequests,
      staff: renderAdminStaff,
      records: renderAdminRecords,
      data: renderAdminData,
    }[tab] || renderAdminList;

    main.innerHTML = `
      <div class="page-header">
        <h2>🏥 Gestion des établissements</h2>
        <button class="btn btn-primary btn-sm" onclick="HospitalsRegistry.openCreateHospital()">+ Ajouter</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">🏥</div><div class="stat-value">${hospitals.length}</div><div class="stat-label">Établissements</div></div>
        <div class="stat-card"><div class="stat-icon">⏳</div><div class="stat-value">${pending.length}</div><div class="stat-label">Demandes en attente</div></div>
        <div class="stat-card"><div class="stat-icon">👩‍⚕️</div><div class="stat-value">${collectStaffRows().length}</div><div class="stat-label">Personnel</div></div>
      </div>
      ${adminTabs(tab)}
      ${content()}`;
  }

  function renderUserPage(main) {
    const user = Auth.getUser();
    const myHosps = getDoctorHospitals(user.uid);
    main.innerHTML = `
      <div class="page-header">
        <h2>🏥 Mes Établissements</h2>
        <button class="btn btn-primary btn-sm" onclick="HospitalsRegistry.openRequestAffiliation()">+ Demander affiliation</button>
      </div>
      ${myHosps.length ? myHosps.map(h => {
        const isCurrent = getCurrentHospital()?.establishmentId === h.establishmentId;
        return `
          <div class="record-card ${isCurrent?'active-hosp':''}">
            <div class="record-header">
              <span>${TYPE_ICONS[h.type] || '🏥'}</span>
              <strong>${esc(h.name)}</strong>
              ${isCurrent ? `<span class="chip" style="color:var(--secondary);border-color:var(--secondary)">Actif</span>` : ''}
              <span class="record-date">${esc(h.city || '')}</span>
            </div>
            ${h.phone ? `<p style="font-size:.8rem;color:var(--text-muted)">📞 ${esc(h.phone)}</p>` : ''}
            ${!isCurrent ? `<button class="btn btn-ghost btn-sm" style="margin-top:.5rem"
              onclick="HospitalsRegistry.setCurrentHospital('${h.establishmentId}')">Basculer vers cet établissement</button>` : ''}
          </div>`;
      }).join('') : `
        <div class="card empty-state">
          <p>Aucun établissement affilié.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:.75rem"
            onclick="HospitalsRegistry.openRequestAffiliation()">+ Demander une affiliation</button>
        </div>`}
      <h3 style="margin:1.25rem 0 .75rem">Mes demandes</h3>
      <div class="records-list">
        ${getAffiliations().filter(a => a.requesterUid === user.uid).map(a => `
          <div class="record-card">
            <div class="record-header">
              <strong>${esc(a.establishmentName)}</strong>
              ${statusChip(a.status)}
              <span class="record-date">${a.createdAt?.slice(0,10) || '—'}</span>
            </div>
          </div>
        `).join('') || `<div class="card empty-state"><p>Aucune demande envoyée</p></div>`}
      </div>`;
  }

  function renderManagePage(main, tab = 'list') {
    const user = Auth.getUser();
    if (user?.role === 'admin') renderAdminPage(main, tab);
    else renderUserPage(main);
  }

  return {
    getHospitals, saveHospitals, addHospital, updateHospital, getHospitalById,
    getAffiliations, saveAffiliations, requestAffiliation, respondAffiliation, removeStaff,
    getDoctorHospitals, getPendingAffiliations,
    getCurrentHospital, setCurrentHospital, clearCurrentHospital,
    getPatientsForContext, getAppointmentsForContext, getPatientsForEstablishment,
    renderHospitalSwitcher, openRequestAffiliation, submitAffiliation,
    openCreateHospital, saveHospital,
    renderManagePage,
  };
})();

window.HospitalsRegistry = HospitalsRegistry;
