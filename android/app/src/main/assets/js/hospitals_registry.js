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

  /* PARTIE K — délègue à DB.pushCloud (js/db.js) au lieu d'un mini-push
     Firestore local avec .catch(() => {}) : tout échec est loggé et mis
     en file d'attente pour rejeu automatique, jamais perdu en silence. */
  function pushCloud(collection, docId, data) {
    DB.pushCloud(collection, docId, data);
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

  /* Variante confirmée de addHospital() : attend la confirmation
     Firestore réelle des 3 collections avant de résoudre (même
     principe que DB.addPatientAndConfirm, js/db.js). Nécessaire car
     `establishments`/`hospitals`/`mc_hospitals` ne sont pas
     inscriptibles par le compte non-admin qui vient de s'inscrire tant
     que la règle serveur ne l'autorise pas explicitement — sans
     confirmation, l'appelant (hospital-auth.js register()) ne peut pas
     savoir que l'établissement n'a en réalité jamais été créé côté
     serveur. */
  async function addHospitalAndConfirm(data) {
    const h = addHospital(data);
    const confirmed = await DB.pushAndReport([
      ['establishments', h.establishmentId, h],
      ['hospitals', h.establishmentId, h],
      ['mc_hospitals', h.establishmentId, h],
    ]);
    return { hospital: h, confirmed };
  }

  /* Migration organique du mot de passe hérité vers Firebase Auth
     (voir js/hospital-auth.js migrateLegacyEstablishmentAuth) : retire
     RÉELLEMENT passwordHash (pas juste `null` — hasNoSecretFields()
     côté règles bloque toute clé présente, valeur ou non) et pose
     authUid. Écrite en direct (pas via updateHospital/saveHospitals,
     qui font un .set() intégral côté cloud — la valeur locale de
     passwordHash serait alors repoussée telle quelle et annulerait la
     suppression cloud). */
  async function migratePasswordHashToAuth(establishmentId, authUid) {
    const list = getHospitals();
    const idx = list.findIndex(h => h.establishmentId === establishmentId || h.hid === establishmentId);
    if (idx === -1) return;
    list[idx] = { ...list[idx], authUid };
    delete list[idx].passwordHash;
    store(EST_KEY, list);
    store(LEGACY_EST_KEY, list);
    if (typeof firebaseDB === 'undefined' || !firebaseDB || typeof firebase === 'undefined') return;
    const patch = { authUid, passwordHash: firebase.firestore.FieldValue.delete() };
    await Promise.all(['establishments', 'hospitals', 'mc_hospitals'].map(col =>
      firebaseDB.collection(col).doc(establishmentId).set(patch, { merge: true })
        .catch(e => console.warn(`[HospitalsRegistry] Migration ${col} :`, e?.code || e?.message))
    ));
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

  /* Correctif (bug confirmé) : HospitalAuth.findByOfficialId() peut
     trouver l'établissement directement dans Firestore sans jamais
     l'ajouter au cache local — requestAffiliation() (via
     getHospitalById) échouait alors silencieusement pour un agent
     lab/reception se connectant/s'inscrivant sur un poste qui n'a
     jamais synchronisé cet établissement. cacheHospital() rend le
     document cloud disponible localement SANS écriture Firestore, sans
     changer son statut ni son propriétaire, et sans écraser un staff
     déjà connu localement si le document entrant n'en porte pas. */
  function cacheHospital(establishment) {
    if (!establishment) return null;
    const id = establishment.establishmentId || establishment.hid || establishment.id;
    if (!id) return null;
    const list = getHospitals();
    const idx = list.findIndex(h => h.establishmentId === id || h.hid === id);
    const incomingStaff = Array.isArray(establishment.staff) ? establishment.staff : null;
    const merged = idx === -1
      ? normalizeEstablishment({ ...establishment, establishmentId: id })
      : normalizeEstablishment({
          ...list[idx],
          ...establishment,
          establishmentId: id,
          status: list[idx].status || establishment.status,
          staff: (incomingStaff && incomingStaff.length) ? incomingStaff : list[idx].staff,
        });
    if (idx === -1) list.push(merged); else list[idx] = merged;
    // Écriture LOCALE uniquement — jamais pushCloud ici (voir saveHospitals) :
    // ce document vient déjà du cloud, le lui renvoyer serait un aller-retour inutile.
    const normalizedList = list.map(normalizeEstablishment);
    store(EST_KEY, normalizedList);
    store(LEGACY_EST_KEY, normalizedList);
    return merged;
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
    // Correctif (audit) : mc_affiliations (allow write: if isAdmin();)
    // n'est jamais lue par l'app (seule affiliation_requests l'est,
    // voir js/db.js) — cette écriture était systématiquement rejetée
    // pour l'appelant réel (le professionnel demandeur, non-admin),
    // sans impact fonctionnel mais avec un réessai perpétuel silencieux
    // dans la file d'attente locale. Collection legacy morte, retirée.
    normalized.forEach(a => {
      pushCloud('affiliation_requests', a.requestId, a);
    });
  }

  function professionalNumberFor(user) {
    return user?.order_num || user?.matricule || user?.username || '';
  }

  /* Correctif (bug confirmé) : getHospitalById(establishmentId) échouait
     silencieusement (retour false) lorsque l'établissement, bien que
     trouvé dans Firestore par HospitalAuth.findByOfficialId(), n'avait
     jamais été mis en cache localement — empêchant la création de la
     demande d'affiliation d'un agent lab/reception sur un poste qui
     n'a jamais synchronisé cet établissement. Accepte désormais
     options.establishment (transmis directement par l'appelant qui l'a
     déjà en mémoire) et, à défaut, tente une lecture Firestore ciblée
     avant de conclure à un échec. Devenue async pour cette raison —
     TOUS les appelants doivent désormais l'attendre (await).
     Contrat de retour : succès → l'objet affiliation normalisé
     (toujours porteur de .requestId) ; échec → { ok:false, reason }
     (jamais requestId) — les appelants doivent tester `.requestId`,
     jamais la simple troncature JS (un objet {ok:false} est truthy). */
  async function requestAffiliation(requesterUid, requesterName, establishmentId, options = {}) {
    const user = Auth.getUser() || {};
    const account = DB.getAccounts().find(a => a.uid === requesterUid) || user;
    const requesterRole = options.role || options.requesterRole || account.role || user.role || 'doctor';
    // Tous les rôles hospitaliers peuvent demander une affiliation
    // (médecin, infirmier, pharmacie, laboratoire, réception).
    if (!['doctor','nurse','pharmacist','lab','reception'].includes(requesterRole)) {
      return { ok: false, reason: 'invalid_role' };
    }

    let h = options.establishment || getHospitalById(establishmentId);
    if (!h && establishmentId && typeof firebaseDB !== 'undefined' && firebaseDB) {
      try {
        const doc = await firebaseDB.collection('establishments').doc(String(establishmentId)).get();
        if (doc.exists) h = { id: doc.id, ...doc.data() };
      } catch (e) {
        console.warn('[HospitalsRegistry] Lecture établissement (affiliation) :', e?.message || e);
      }
    }
    if (!h) return { ok: false, reason: 'establishment_not_found' };
    // Rend le document disponible localement (jamais d'écriture Firestore).
    h = cacheHospital(h) || h;

    const finalEstablishmentId = h.establishmentId || establishmentId;
    const affs = getAffiliations();
    const existing = affs.find(a =>
      a.requesterUid === requesterUid &&
      a.establishmentId === finalEstablishmentId &&
      ['pending','approved'].includes(a.status)
    );
    if (existing) return { ok: false, reason: 'already_exists', affiliation: existing };

    const a = normalizeRequest({
      // ID déterministe (cohérent avec normalizeRequest) : évite les
      // doublons et garantit que les boutons admin retrouvent la demande.
      requestId: `AFF_${requesterUid}_${finalEstablishmentId}`,
      requesterUid,
      requesterName,
      requesterRole,
      professionalNumber: options.professionalNumber || professionalNumberFor(account),
      establishmentId: finalEstablishmentId,
      establishmentName: h.name,
      officialId: h.officialId || options.officialId || '',
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    });
    affs.push(a);
    saveAffiliations(affs);
    if (!options.silent) notifyAffiliationRequest(a);
    return a;
  }

  /* Variante confirmée de requestAffiliation() : attend la confirmation
     Firestore réelle de affiliation_requests (avec délai maximal) avant
     de résoudre — utilisée à l'inscription lab/reception (js/auth.js
     _regAgentStrict), où annoncer une affiliation "envoyée" sans
     confirmation cloud tromperait l'agent (même principe que
     addHospitalAndConfirm). Retourne toujours une raison précise
     (establishment_not_found / permission_denied / timeout) plutôt
     qu'un booléen nu, pour un message d'erreur exploitable. */
  async function requestAffiliationAndConfirm(requesterUid, requesterName, establishmentId, options = {}) {
    const result = await requestAffiliation(requesterUid, requesterName, establishmentId, options);
    if (!result?.requestId) {
      return { affiliation: null, confirmed: false, reason: result?.reason || 'unknown' };
    }
    const timeoutMs = options.timeoutMs || 15000;
    if (DB.pushAndReportDetailed) {
      const report = await DB.pushAndReportDetailed(
        [['affiliation_requests', result.requestId, result]],
        { timeoutMs, label: 'Affiliation' }
      );
      const reason = report.ok ? null : (report.timedOut ? 'timeout' : 'permission_denied');
      return { affiliation: result, confirmed: report.ok, reason };
    }
    const confirmed = DB.pushAndReport ? await DB.pushAndReport([['affiliation_requests', result.requestId, result]]) : false;
    return { affiliation: result, confirmed, reason: confirmed ? null : 'permission_denied' };
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

  /* PARTIE E — hospitalMembers/{establishmentId}_{uid} : document plat
     miroir de establishments.staff[], nécessaire car une règle
     Firestore ne peut pas tester efficacement l'appartenance à un
     tableau d'objets. C'est la vraie source que firestore.rules
     consulte (isHospitalMember/belongsToSameEstablishment) pour
     l'isolation par établissement. Écrit ici à chaque
     approbation/retrait, ET par ensureHospitalMembership (auto-
     guérison à la connexion) pour les comptes déjà affiliés
     avant l'introduction de cette collection. */
  function writeHospitalMemberDoc(establishmentId, uid, role, status) {
    if (!establishmentId || !uid) return;
    pushCloud('hospitalMembers', `${establishmentId}_${uid}`, {
      hospitalId: establishmentId,
      uid,
      role: role || '',
      status,
      updatedAt: now(),
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
    writeHospitalMemberDoc(establishment.establishmentId, request.requesterUid, request.requesterRole, 'active');
  }

  // Auto-guérison : comptes affiliés avant l'introduction de
  // hospitalMembers (ou dont l'écriture aurait échoué) convergent au
  // fil des connexions, sans script de migration à lancer contre la
  // prod. Chacun n'écrit QUE son propre document ({hospitalId}_{son
  // uid}), jamais celui d'un tiers — aucune élévation de privilège
  // possible même si cette fonction est appelée pour n'importe quel uid.
  const _healedThisSession = new Set();
  function ensureHospitalMembership(uid) {
    if (!uid || _healedThisSession.has(uid)) return;
    _healedThisSession.add(uid);
    const account = DB.getAccounts().find(a => a.uid === uid);
    getAffiliations()
      .filter(a => a.requesterUid === uid && a.status === 'approved')
      .forEach(a => writeHospitalMemberDoc(a.establishmentId, uid, a.requesterRole || account?.role, 'active'));
  }

  /* ── SOURCES DE VÉRITÉ DIRECTES (hospitalMembers / affiliation_requests) ──
     Correctif (bug confirmé) : la connexion ne s'appuyait que sur
     establishments.staff[] (cache local, potentiellement obsolète) —
     alors que ce sont hospitalMembers/{estId}_{uid} et
     affiliation_requests/AFF_{uid}_{estId} que lisent réellement les
     règles Firestore et l'administration. Un staff local en retard
     bloquait alors à tort un agent pourtant réellement affilié. */
  async function getHospitalMemberDirect(establishmentId, uid) {
    if (!establishmentId || !uid || typeof firebaseDB === 'undefined' || !firebaseDB) return null;
    try {
      const doc = await firebaseDB.collection('hospitalMembers').doc(`${establishmentId}_${uid}`).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.warn('[HospitalsRegistry] Lecture hospitalMembers directe :', e?.message || e);
      return null;
    }
  }

  async function getAffiliationRequestDirect(uid, establishmentId) {
    if (!establishmentId || !uid || typeof firebaseDB === 'undefined' || !firebaseDB) return null;
    try {
      const doc = await firebaseDB.collection('affiliation_requests').doc(`AFF_${uid}_${establishmentId}`).get();
      return doc.exists ? normalizeRequest(doc.data()) : null;
    } catch (e) {
      console.warn('[HospitalsRegistry] Lecture affiliation directe :', e?.message || e);
      return null;
    }
  }

  /* Résout l'affiliation réelle d'un agent à la connexion, en donnant
     la priorité à hospitalMembers (source des règles serveur) et à
     affiliation_requests (source de la décision administrative) sur le
     cache local establishments.staff, qui ne sert plus que de miroir
     d'affichage. Réconciliation CONTRÔLÉE du cache local uniquement
     dans le sens Firestore → local (jamais l'inverse : hospitalMembers
     n'est jamais créé sur la seule foi du cache local). */
  async function resolveAgentAffiliation(establishmentId, uid, role) {
    const [member, affiliation] = await Promise.all([
      getHospitalMemberDirect(establishmentId, uid),
      getAffiliationRequestDirect(uid, establishmentId),
    ]);
    const memberActive = !!member && member.role === role && String(member.status || '').toLowerCase() === 'active';

    if (memberActive) {
      // hospitalMembers actif : réconcilie le miroir staff local s'il est
      // en retard, mais n'empêche jamais la connexion à cause de lui.
      const h = getHospitalById(establishmentId);
      if (h) {
        const staff = Array.isArray(h.staff) ? h.staff.slice() : [];
        const idx = staff.findIndex(s => s.uid === uid);
        const entry = {
          uid, role, status: 'active', updatedAt: now(),
          name: affiliation?.requesterName || staff[idx]?.name || '',
          professionalNumber: affiliation?.professionalNumber || staff[idx]?.professionalNumber || '',
          linkedAt: staff[idx]?.linkedAt || now(),
        };
        if (idx === -1) staff.push(entry); else staff[idx] = { ...staff[idx], ...entry };
        updateHospital(establishmentId, { staff });
      }
      return { status: 'active', member, affiliation };
    }

    if (affiliation?.status === 'approved') {
      // Affiliation approuvée côté Firestore mais hospitalMembers pas
      // (ou plus) confirmé actif : réparation UNIQUEMENT parce que
      // l'affiliation Firestore l'autorise explicitement — jamais sur
      // la seule foi d'un cache local.
      writeHospitalMemberDoc(establishmentId, uid, role, 'active');
      const h = getHospitalById(establishmentId);
      if (h) upsertStaffMember(h, affiliation);
      return { status: 'active', member, affiliation };
    }
    if (affiliation?.status === 'pending') return { status: 'pending', member, affiliation };
    if (affiliation?.status === 'rejected') return { status: 'rejected', member, affiliation };
    return { status: 'none', member, affiliation };
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

  /* ── État visuel du bouton d'affiliation ────────────── */
  function _lockAffButton(event, label) {
    const btn = event?.target?.closest ? event.target.closest('button') : (event?.currentTarget || null);
    if (!btn) return null;
    if (btn.dataset && btn.dataset.processing === 'true') return 'locked';
    if (btn.dataset) btn.dataset.processing = 'true';
    btn.disabled = true;
    btn._mcOriginalText = btn.textContent;
    btn.textContent = label;
    return btn;
  }
  function _unlockAffButton(btn) {
    if (!btn || typeof document === 'undefined' || !document.body) return;
    if (!document.body.contains(btn)) return;
    btn.disabled = false;
    btn.textContent = btn._mcOriginalText != null ? btn._mcOriginalText : btn.textContent;
    if (btn.dataset) delete btn.dataset.processing;
  }

  /* Transformée en fonction async CONFIRMÉE (correctif) : l'ancienne
     version annonçait "Affiliation approuvée" et mutait staff/
     hospitalMembers immédiatement en local, sans jamais attendre la
     confirmation Firestore — un échec réseau silencieux laissait
     croire à une approbation qui n'avait jamais atteint le serveur. */
  async function respondAffiliation(requestId, approved, event) {
    const btn = _lockAffButton(event, approved ? '⏳ Approbation en cours…' : '⏳ Refus en cours…');
    if (btn === 'locked') return;
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        App?.toast?.('Connexion internet requise pour traiter cette affiliation.', 'error');
        return;
      }

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

      if (approved) {
        // Le compte professionnel doit être approuvé AVANT toute
        // affiliation active, et son rôle doit concorder avec la demande
        // — sinon un compte encore pending (ou dont le rôle a changé)
        // pourrait obtenir un accès actif à un établissement.
        const account = (DB.getAccounts() || []).find(a => a.uid === req.requesterUid);
        const accStatus = String(account?.status || '').toLowerCase();
        if (!account || !['approved', 'active'].includes(accStatus)) {
          App?.toast?.('Le compte professionnel doit d\'abord être approuvé par l\'administration MedConnect.', 'error');
          return;
        }
        if (account.role !== req.requesterRole) {
          App?.toast?.('Le rôle du compte ne correspond pas à la demande d\'affiliation.', 'error');
          return;
        }
        // Correctif (audit) : 'add_member' figure dans
        // ExchangeBridge.DESKTOP_BLOCKED_ACTIONS depuis l'introduction du
        // contrat d'abonnement, mais n'était en réalité vérifié NULLE
        // PART — un établissement dont l'abonnement desktop est expiré/
        // suspendu pouvait quand même valider indéfiniment l'arrivée de
        // nouveau personnel. Même mécanisme que les autres actions
        // premium (ExchangeBridge.canWriteForHospital), sans effet si
        // ExchangeBridge est indisponible (repli déjà utilisé ailleurs
        // dans le projet : "allowed: true" par défaut).
        if (window.ExchangeBridge?.canWriteForHospital) {
          const gate = await window.ExchangeBridge.canWriteForHospital(h.establishmentId, 'add_member');
          if (!gate.allowed) {
            App?.toast?.(gate.message || 'Abonnement expiré : impossible d\'approuver une nouvelle affiliation.', 'error');
            return;
          }
        }
      }

      const nextReq = normalizeRequest({
        ...req,
        status: approved ? 'approved' : 'rejected',
        updatedAt: now(),
        decided_at: now(),
      });

      const writes = [['affiliation_requests', nextReq.requestId, nextReq]];
      let staffAfter = null;
      if (approved) {
        const staff = Array.isArray(h.staff) ? h.staff.slice() : [];
        const sidx = staff.findIndex(s => s.uid === req.requesterUid);
        const member = {
          uid: req.requesterUid, name: req.requesterName, role: req.requesterRole,
          professionalNumber: req.professionalNumber, establishmentId: h.establishmentId,
          establishmentName: h.name, status: 'active',
          linkedAt: sidx === -1 ? now() : (staff[sidx].linkedAt || now()), updatedAt: now(),
        };
        if (sidx === -1) staff.push(member); else staff[sidx] = { ...staff[sidx], ...member };
        staffAfter = staff;
        const nextEst = normalizeEstablishment({ ...h, staff, updatedAt: now() });
        writes.push(['establishments', h.establishmentId, nextEst]);
        writes.push(['hospitals', h.establishmentId, nextEst]);
        writes.push(['mc_hospitals', h.establishmentId, nextEst]);
        writes.push(['hospitalMembers', `${h.establishmentId}_${req.requesterUid}`, {
          hospitalId: h.establishmentId, uid: req.requesterUid, role: req.requesterRole,
          status: 'active', updatedAt: now(),
        }]);
      }

      // Revue Codex (P1, PR #39) : affiliation_requests + establishments/
      // hospitals/mc_hospitals + hospitalMembers sont écrits en un seul
      // batch ATOMIQUE (js/db.js pushBatchAndReportDetailed) plutôt qu'en
      // écritures indépendantes — sinon un échec partiel pouvait laisser
      // hospitalMembers actif sans que establishments.staff soit à jour
      // (ou l'inverse), et une pièce en échec repartait en file pour un
      // rejeu automatique ultérieur, potentiellement en conflit avec une
      // décision opposée prise entre-temps.
      const result = DB.pushBatchAndReportDetailed
        ? await DB.pushBatchAndReportDetailed(writes, { timeoutMs: 20000, label: 'Approbation affiliation' })
        : { ok: DB.pushAndReport ? await DB.pushAndReport(writes) : false };

      if (!result.ok) {
        // La demande reste pending — jamais de membre actif ajouté
        // localement tant que Firestore n'a pas confirmé.
        App?.toast?.('❌ Une erreur est survenue — la demande reste en attente. Réessayez.', 'error');
        return;
      }

      // Cache local mis à jour SEULEMENT après confirmation complète.
      saveAffiliations(affs.map((a, i) => (i === idx ? nextReq : a)));
      if (approved && staffAfter) {
        updateHospital(h.establishmentId, { staff: staffAfter });
        updateUserAffiliation(nextReq, h, true);
      }

      if (window.Network?.notify) {
        Network.notify({
          to_role: nextReq.requesterRole,
          to_id: nextReq.requesterUid,
          type: 'info',
          subject: approved
            ? `✅ Affiliation approuvée — ${h.name || 'Établissement'}`
            : `❌ Affiliation refusée — ${h.name || 'Établissement'}`,
          body: approved
            ? `Votre demande d'affiliation à ${h.name} a été approuvée. Vous pouvez maintenant y accéder.`
            : `Votre demande d'affiliation à ${h.name} a été refusée par l'administrateur.`,
        });
      }
      App?.toast?.(approved ? '✅ Affiliation approuvée' : '❌ Affiliation refusée');
      renderManagePage(document.getElementById('main-content'), 'requests');
    } finally {
      _unlockAffButton(btn);
    }
  }

  function removeStaff(establishmentId, uid) {
    const h = getHospitalById(establishmentId);
    if (!h) return;
    if (!confirm(`Retirer cette affiliation de ${h.name} ?`)) return;

    const staff = (h.staff || []).map(member =>
      member.uid === uid ? { ...member, status: 'removed', removedAt: now(), updatedAt: now() } : member
    );
    updateHospital(establishmentId, { staff });
    writeHospitalMemberDoc(establishmentId, uid, staff.find(s => s.uid === uid)?.role, 'removed');

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
    ensureHospitalMembership(uid);
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

  async function submitAffiliation(e) {
    e.preventDefault();
    const user = Auth.getUser();
    const id = document.getElementById('aff-hid').value;
    const result = await requestAffiliation(user.uid, user.name, id);
    const ok = !!result?.requestId;
    App.closeModal();
    App.toast(ok ? '📤 Demande d’affiliation enregistrée' : '⚠️ Demande déjà envoyée ou rôle non autorisé', ok?'success':'error');
  }

  function openCreateHospital() {
    App.openModal('🏥 Ajouter un établissement', renderEstablishmentForm());
  }

  async function saveHospital(e) {
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
      const result = await requestAffiliation(user.uid, user.name, h.establishmentId, { establishment: h });
      const ok = !!result?.requestId;
      App.closeModal();
      App.toast(ok
        ? '📤 Établissement créé. Demande d’affiliation envoyée à l’administrateur.'
        : '⚠️ Établissement créé, mais une demande existe déjà ou le rôle n’est pas autorisé.',
        ok ? 'success' : 'error');
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
      ${hospitals.map(h => {
        const st = String(h.status || '').toLowerCase();
        const isPending = st === 'pending' || (h.registeredFrom === 'desktop' && !['active','approved'].includes(st));
        return `
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
            ${h.registeredFrom === 'desktop' ? ' · 🖥️ inscrit desktop' : ''}
          </p>
          <p style="font-size:.8rem;color:var(--text-dim)">
            GPS : ${h.latitude !== '' && h.longitude !== '' ? `${h.latitude}, ${h.longitude}` : 'Non renseignée'}
          </p>
          ${isPending ? `
          <div style="display:flex;gap:.5rem;margin-top:.5rem;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="HospitalsRegistry.validateEstablishment('${esc(h.establishmentId)}',true)">✅ Valider</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="HospitalsRegistry.validateEstablishment('${esc(h.establishmentId)}',false)">❌ Refuser</button>
          </div>` : ''}
        </div>
      `;}).join('')}
    </div>`;
  }

  /* Valide (approved/active) ou refuse (rejected) un établissement en
     attente — typiquement inscrit depuis le desktop. Met à jour le
     document établissement (propagé aux collections miroir par
     updateHospital → saveHospitals → pushCloud establishments +
     mc_hospitals) ET le compte users/{authUid} pour autoriser la
     connexion desktop. */
  // Anti double-appui : l'action s'étend sur plusieurs écritures cloud
  // awaitées — un second clic pendant ce temps relançait tout le flux.
  let _validateBusy = false;
  async function validateEstablishment(establishmentId, approve) {
    if (_validateBusy) return;
    const h = getHospitalById(establishmentId);
    if (!h) { App?.toast?.('Établissement introuvable.', 'error'); return; }
    if (!confirm(approve
      ? `Valider l'établissement « ${h.name} » ? Il pourra se connecter.`
      : `Refuser l'établissement « ${h.name} » ?`)) return;
    _validateBusy = true;
    try {

    updateHospital(establishmentId, { status: approve ? 'active' : 'rejected' });

    // Statut établissement confirmé côté cloud AVANT d'annoncer la
    // validation : updateHospital ne fait qu'un push non attendu, que
    // l'écouteur establishments (remplacement intégral du snapshot) peut
    // écraser avec l'ancien 'pending' si la propagation échoue — le
    // badge "à valider" persisterait alors et prêterait à confusion
    // (même correctif que admin.js activateSubscription).
    let confirmed = true;
    try {
      if (typeof firebaseDB !== 'undefined' && firebaseDB) {
        await firebaseDB.collection('establishments').doc(establishmentId)
          .set({ status: approve ? 'active' : 'rejected' }, { merge: true });
      }
    } catch (e) { confirmed = false; console.warn('[Registry] Confirmation statut établissement :', e?.message || e); }

    // Compte Firebase de l'établissement (rôle 'hospital') : actif si
    // validé, pour que la connexion desktop soit autorisée.
    try {
      if (h.authUid && typeof firebaseDB !== 'undefined' && firebaseDB) {
        await firebaseDB.collection('users').doc(h.authUid).set({
          status: approve ? 'active' : 'rejected', role: 'hospital',
        }, { merge: true });
      }
    } catch (e) { confirmed = false; console.warn('[Registry] MAJ compte établissement :', e?.message || e); }

    App?.toast?.(!confirmed
      ? '⚠️ Action enregistrée localement, mais non confirmée côté serveur — réessayez.'
      : (approve ? '✅ Établissement validé.' : 'Établissement refusé.'), !confirmed ? 'warning' : undefined);
    if (window.App?.navigateTo) App.navigateTo('dashboard');
    else if (document.getElementById('main-content')) renderAdminPage(document.getElementById('main-content'), 'list');

    } finally { _validateBusy = false; }
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
                onclick="HospitalsRegistry.respondAffiliation('${a.requestId}', true, event)">
                ✅ Approuver
              </button>
              <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3)"
                onclick="HospitalsRegistry.respondAffiliation('${a.requestId}', false, event)">
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
    getHospitals, saveHospitals, addHospital, addHospitalAndConfirm, migratePasswordHashToAuth, updateHospital, getHospitalById, cacheHospital,
    getAffiliations, saveAffiliations, requestAffiliation, requestAffiliationAndConfirm, respondAffiliation, removeStaff, validateEstablishment,
    getDoctorHospitals, getPendingAffiliations, ensureHospitalMembership,
    getHospitalMemberDirect, getAffiliationRequestDirect, resolveAgentAffiliation,
    getCurrentHospital, setCurrentHospital, clearCurrentHospital,
    getPatientsForContext, getAppointmentsForContext, getPatientsForEstablishment,
    renderHospitalSwitcher, openRequestAffiliation, submitAffiliation,
    openCreateHospital, saveHospital,
    renderManagePage,
  };
})();

window.HospitalsRegistry = HospitalsRegistry;
