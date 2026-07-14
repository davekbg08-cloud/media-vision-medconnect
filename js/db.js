/* =====================================================
   MedConnect 2.0 — DB Module
   localStorage + Firebase Firestore sync

   Fonctionnement :
   - Lecture  → localStorage (rapide, hors-ligne)
   - Écriture → localStorage + Firebase (sync cloud)
   - Au démarrage → sync depuis Firebase vers localStorage
   ===================================================== */
const DB = (() => {

  /* ── HELPERS localStorage ────────────────────────── */
  const load  = (k, d=[]) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };
  const store = (k, v)    => localStorage.setItem(k, JSON.stringify(v));
  const today = ()        => new Date().toISOString().slice(0, 10);

  /* ── FILE D'ÉCRITURE CLOUD PERSISTANTE ─────────────────
     Firestore est la source de vérité. Mais une écriture peut
     échouer ponctuellement (hors-ligne, latence, règle en cours
     de déploiement). Sans file, cette donnée ne vivrait qu'en
     localStorage et disparaîtrait à la réinstallation — cause
     racine des pertes de données signalées.

     Chaque écriture cloud échouée est mémorisée ici (dans
     localStorage, donc elle survit à une fermeture d'app) et
     rejouée automatiquement dès que Firestore répond. La donnée
     n'est réputée « à l'abri » que lorsqu'elle a atteint le cloud. */
  const OUTBOX_KEY = 'mc_cloud_outbox';

  function _outboxAdd(collection, docId, data) {
    const q = load(OUTBOX_KEY);
    // Dédoublonnage : une réécriture plus récente du même document
    // remplace l'ancienne en file (dernière valeur = la bonne).
    const filtered = q.filter(e => !(e.collection === collection && e.docId === String(docId)));
    filtered.push({ collection, docId: String(docId), data, queuedAt: new Date().toISOString() });
    store(OUTBOX_KEY, filtered);
  }

  function _outboxCount() { return load(OUTBOX_KEY).length; }
  const outboxCount = _outboxCount;

  let _flushing = false;
  async function flushOutbox() {
    if (_flushing || !firebaseReady || !firebaseDB) return;
    const q = load(OUTBOX_KEY);
    if (!q.length) return;
    _flushing = true;
    const remaining = [];
    for (const e of q) {
      try {
        await firebaseDB.collection(e.collection).doc(e.docId).set(e.data, { merge: true });
      } catch (err) {
        console.warn(`[MedConnect] Outbox : réécriture ${e.collection}/${e.docId} encore en échec :`, err?.message || err);
        remaining.push(e); // on garde pour le prochain essai
      }
    }
    store(OUTBOX_KEY, remaining);
    _flushing = false;
    // Rafraîchit le badge de synchronisation pour refléter l'état réel.
    try { window.SyncBadge?.render?.(); } catch (_) {}
    if (remaining.length) console.warn(`[MedConnect] Outbox : ${remaining.length} écriture(s) toujours en attente.`);
  }

  /* ── IDs UNIQUES ──────────────────────────────────────
     Remplace les anciens `${PREFIX}${Date.now()}` qui pouvaient
     entrer en collision si deux écritures arrivaient dans la
     même milliseconde (lot rapide, double appui, Promise.all).
     N'affecte QUE les nouveaux IDs générés — les anciens IDs déjà
     stockés (format Date.now() seul) restent valides et inchangés.
  ──────────────────────────────────────────────────────── */
  function makeId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ── NUMÉRO DE SÉRIE PATIENT ─────────────────────── */
  function generatePatientId(countryCode) {
    const yr    = new Date().getFullYear();
    const cc    = (countryCode || 'XX').toUpperCase().slice(0, 2);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let   rnd   = '';
    for (let i = 0; i < 8; i++) rnd += chars[Math.floor(Math.random() * chars.length)];
    return `MC-${yr}-${cc}-${rnd}`;
  }

  /* ── CODE D'ACCÈS PATIENT (premier accès) ──────────
     Donné par l'hôpital au patient à la création de sa fiche, saisi
     avec le PIN au premier accès (js/auth.js _createPatientPin) —
     vérifié côté serveur (firestore.rules) contre
     mc_patients/{id}.firstAccessCode. Empêche un tiers connaissant
     seulement le numéro de fiche de préempter le compte du patient
     avant lui (voir rapport de sécurité). Alphabet sans caractères
     ambigus à l'oral/à l'écrit (pas de O/0, I/1/L). */
  function generateFirstAccessCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  /* ── SYNC FIREBASE ───────────────────────────────────
     Écrit dans localStorage ET dans Firestore si dispo.
     Lit toujours depuis localStorage (cache local).

     _push()         : compatible avec tout le code existant
                       (aucun appelant actuel ne vérifie son retour),
                       mais retourne désormais true/false et logue
                       clairement tout échec au lieu de l'avaler.
     _pushCritical() : à utiliser pour les écritures où l'utilisateur
                       doit savoir si le cloud a réellement confirmé
                       (inscription, approbation admin...).
  ──────────────────────────────────────────────────── */
  async function _push(collection, docId, data) {
    if (!firebaseReady || !firebaseDB) {
      // Firestore pas prêt : on ne perd PAS l'écriture, on la met en
      // file pour rejeu automatique dès que le cloud répond.
      _outboxAdd(collection, docId, data);
      return false;
    }
    try {
      await firebaseDB.collection(collection).doc(String(docId)).set(data);
      return true;
    } catch (e) {
      console.warn(`[MedConnect] Échec écriture Firestore ${collection}/${docId} — mise en file :`, e?.message || e);
      _outboxAdd(collection, docId, data);
      return false;
    }
  }

  /** Écriture critique : retourne explicitement le résultat, ne masque jamais l'échec. */
  async function _pushCritical(collection, docId, data) {
    return _push(collection, docId, data);
  }

  /** Pousse plusieurs (collection, docId, data) et résout true seulement si TOUT a réussi. */
  async function pushAndReport(entries) {
    const results = await Promise.all(entries.map(([col, id, data]) => _pushCritical(col, id, data)));
    return results.every(Boolean);
  }

  async function _delete(collection, docId) {
    if (!firebaseReady || !firebaseDB) return false;
    try {
      await firebaseDB.collection(collection).doc(String(docId)).delete();
      return true;
    } catch (e) {
      console.warn(`[MedConnect] Échec suppression Firestore ${collection}/${docId} :`, e?.message || e);
      return false;
    }
  }

  // Seules ces collections ADMINISTRATIVES, gérées côté cloud, se
  // vident quand le serveur confirme un snapshot vide (les « demandes
  // fantômes » du dashboard). Pour les données MÉDICALES créées
  // localement (ordonnances, consultations…), un cloud vide ne doit
  // JAMAIS effacer le travail local : d'anciennes écritures cloud ont
  // pu échouer en silence, le local est alors la seule copie.
  const EMPTY_WIPE_WHITELIST = new Set([
    'registration_requests', 'affiliation_requests',
    'establishments', 'establishment_documents',
  ]);

  function storeSnapshot(key, snap) {
    if (snap.empty) {
      if (!snap.metadata?.fromCache && EMPTY_WIPE_WHITELIST.has(key)) store(key, []);
      return;
    }
    store(key, snap.docs.map(d => d.data()));
  }

  /** Fusionne des documents dans une liste locale par identifiant,
      sans écraser les entrées locales absentes du snapshot (un
      listener FILTRÉ ne voit qu'une tranche de la collection : le
      remplacement intégral effacerait le reste). */
  function mergeStore(key, idField, docs) {
    const list = load(key);
    const byId = new Map(list.map(x => [x[idField], x]));
    docs.forEach(d => { if (d && d[idField] != null) byId.set(d[idField], d); });
    store(key, Array.from(byId.values()));
  }

  function listen(query, onData) {
    try {
      // Ne JAMAIS avaler l'erreur : c'est ce silence qui a masqué
      // pendant des semaines le rejet en bloc des requêtes
      // collection-entière par les règles Firestore.
      query.onSnapshot(onData, err =>
        console.warn('[MedConnect] Listener Firestore rejeté :', err?.message || err));
    } catch (e) {
      console.warn('[MedConnect] Listener impossible :', e?.message || e);
    }
  }

  function roleCollection(role) {
    return {
      patient: 'patients',
      doctor: 'doctors',
      nurse: 'nurses',
      pharmacist: 'pharmacies',
      pharmacy: 'pharmacies',
    }[role] || null;
  }

  function publicAccountProfile(account) {
    const profile = { ...account };
    delete profile.password;
    delete profile.passwordHash;
    return {
      ...profile,
      uid: account.uid,
      role: account.role,
      updatedAt: new Date().toISOString(),
    };
  }

  function mirrorAccountProfile(account) {
    if (!account?.uid) return;
    const profile = publicAccountProfile(account);
    _push('users', account.uid, profile);
    const collection = roleCollection(account.role);
    if (collection) _push(collection, account.uid, profile);
  }

  function professionalNumber(account) {
    return account?.order_num || account?.matricule || account?.username || '';
  }

  /* ── SYNC AU DÉMARRAGE ───────────────────────────── */
  async function syncFromFirebase() {
    if (!firebaseReady || !firebaseDB) return;
    // Collections SANS listener temps réel : seul le .get() initial
    // les charge. Les 12 collections couvertes par un listener dans
    // setupRealtimeListeners() sont volontairement EXCLUES d'ici :
    // la première émission d'un onSnapshot livre déjà l'intégralité
    // de la collection — le .get() préalable doublait chaque lecture
    // Firestore au démarrage (coût facturé + bande passante, bug
    // documenté de la version publiée). 'users' reste ici car son
    // listener est un sous-ensemble filtré (pharmacies publiques).
    const collections = [
      'mc_vaccinations','mc_lab_results','mc_consents','mc_admissions',
      'mc_emergency_cases','mc_maternity_cases',
      'users',
      'patients','doctors','nurses','pharmacies','hospitals',
      'medical_records','prescriptions','appointments','notifications',
      'mc_hospitals','mc_affiliations',
      // Collections des DEMANDES (écrites par un appareil, lues par
      // l'admin sur un autre) : sans elles, une demande créée sur
      // desktop ne redescendait jamais sur le mobile admin.
      'affiliation_requests','registration_requests','establishments',
      'mc_verified_doctors','mc_verified_pharms','mc_verified_nurses',
    ];
    // Chaque collection en parallèle avec un timeout individuel : un
    // réseau lent ou une requête bloquée ne doit jamais figer toute
    // l'app (observé : admin resté sur un sablier vide en LTE faible).
    const PER_COLLECTION_TIMEOUT_MS = 6000;
    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ]);
    }
    await Promise.all(collections.map(async col => {
      try {
        const snap = await withTimeout(firebaseDB.collection(col).get(), PER_COLLECTION_TIMEOUT_MS);
        // Vide confirmé serveur : vidage UNIQUEMENT pour les collections
        // administratives de la whitelist (fantômes du dashboard) —
        // jamais pour les données médicales créées localement.
        if (!snap.empty) store(col, snap.docs.map(d => d.data()));
        else if (!snap.metadata?.fromCache && EMPTY_WIPE_WHITELIST.has(col)) store(col, []);
      } catch (e) {
        console.warn(`[MedConnect] Sync ${col} ignorée (lente/indisponible) :`, e?.message || e);
      }
    }));
    // Horodatage pour l'écran "À propos" (VersionManager) — dernière
    // fois que la synchro Firebase a été tentée avec succès.
    try { localStorage.setItem('mc_last_sync_at', new Date().toISOString()); } catch (_) {}
  }

  function getLastSyncAt() {
    try { return localStorage.getItem('mc_last_sync_at'); } catch (_) { return null; }
  }

  /** Version non bloquante : lance la sync en arrière-plan sans jamais
      faire attendre l'appelant. À utiliser partout où l'affichage ne
      doit pas dépendre du réseau (ex: dashboard admin). */
  function syncFromFirebaseInBackground(onDone) {
    syncFromFirebase()
      .then(() => onDone?.(true))
      .catch(e => { console.warn('[MedConnect] Sync arrière-plan :', e); onDone?.(false); });
  }

  /* ── LISTENERS TEMPS RÉEL ────────────────────────── */
  function setupRealtimeListeners() {
    if (!firebaseReady || !firebaseDB) return;
    // Patients — FUSION : un dossier créé localement dont la montée
    // cloud a échoué ne doit pas disparaître au snapshot suivant.
    listen(firebaseDB.collection('mc_patients'), snap => {
      if (!snap.empty) mergeStore('mc_patients', 'id', snap.docs.map(d => d.data()));
    });
    // Messages : PAS de listener global ici — la règle Firestore exige
    // to_id == uid par document, une écoute collection-entière est
    // rejetée en bloc pour tout le monde (c'était le cas depuis
    // toujours, silencieusement). Voir setupUserScopedListeners().
    // Rendez-vous — FUSION (même principe que mc_patients).
    listen(firebaseDB.collection('mc_appointments'), snap => {
      if (!snap.empty) mergeStore('mc_appointments', 'aid', snap.docs.map(d => d.data()));
    });
    // Comptes
    listen(firebaseDB.collection('mc_accounts'), snap => {
      storeSnapshot('mc_accounts', snap);
    });
    // Profils pharmacies visibles publiquement — listener FILTRÉ :
    // fusion obligatoire, un remplacement intégral écraserait les
    // autres profils chargés par la sync initiale.
    listen(firebaseDB.collection('users')
      .where('role', '==', 'pharmacist')
      .where('status', 'in', ['active', 'approved'])
      .where('isLocationVisible', '==', true), snap => {
        if (!snap.empty) mergeStore('users', 'uid', snap.docs.map(d => d.data()));
    });
    // Établissements
    listen(firebaseDB.collection('establishments'), snap => {
      storeSnapshot('establishments', snap);
    });
    // Demandes d'affiliation
    listen(firebaseDB.collection('affiliation_requests'), snap => {
      storeSnapshot('affiliation_requests', snap);
    });
    listen(firebaseDB.collection('registration_requests'), snap => {
      storeSnapshot('registration_requests', snap);
    });
    // Ordonnances — FUSION : c'est la protection qui garantit que
    // l'ordonnance du médecin reste visible même si sa montée cloud
    // a échoué (cause de l'écran « Aucune donnée »).
    listen(firebaseDB.collection('mc_prescriptions'), snap => {
      if (!snap.empty) mergeStore('mc_prescriptions', 'pid', snap.docs.map(d => d.data()));
    });
    // Consultations — FUSION (même principe).
    listen(firebaseDB.collection('mc_consultations'), snap => {
      if (!snap.empty) mergeStore('mc_consultations', 'cid', snap.docs.map(d => d.data()));
    });
    // Inventaire pharmacie (stock partagé entre appareils du même pharmacien)
    listen(firebaseDB.collection('mc_medicines'), snap => {
      storeSnapshot('mc_medicines', snap);
    });
    // Ventes
    listen(firebaseDB.collection('mc_sales'), snap => {
      storeSnapshot('mc_sales', snap);
    });
    // Trace documents établissement (audit)
    listen(firebaseDB.collection('establishment_documents'), snap => {
      storeSnapshot('establishment_documents', snap);
    });
  }

  /** Listeners dépendants de l'utilisateur connecté — montés APRÈS
      login (App.startExchangeSync), pas au boot. Requêtes filtrées :
      seule forme que les règles par-document acceptent. Fusion par
      identifiant : un snapshot filtré ne doit jamais écraser le
      reste de la liste locale. */
  let _userListenersUnsubs = [];
  function setupUserScopedListeners() {
    if (!firebaseReady || !firebaseDB) return;
    const user = window.Auth?.getUser?.();
    if (!user?.uid) return;

    _userListenersUnsubs.forEach(u => { try { u(); } catch (_) {} });
    _userListenersUnsubs = [];

    const scoped = (query, key, idField) => {
      try {
        const unsub = query.onSnapshot(
          snap => {
            if (!snap.empty) {
              mergeStore(key, idField, snap.docs.map(d => d.data()));
              // Rafraîchit la vue affichée si elle dépend de ces données
              // (ex. l'écran Ordonnances quand mc_prescriptions arrive),
              // pour un affichage immédiat sans rechargement manuel.
              try {
                const section = { mc_prescriptions: 'prescriptions', mc_messages: 'messages' }[key];
                if (section && window.App?.refreshIfCurrent) window.App.refreshIfCurrent(section);
              } catch (_) {}
            }
          },
          err => console.warn(`[MedConnect] Listener ${key} (scoped) rejeté :`, err?.message || err)
        );
        _userListenersUnsubs.push(unsub);
      } catch (e) {
        console.warn(`[MedConnect] Listener ${key} impossible :`, e?.message || e);
      }
    };

    // Messagerie : la règle exige to_id == uid — c'est la seule
    // écoute des messages qui fonctionne réellement.
    scoped(firebaseDB.collection('mc_messages').where('to_id', '==', user.uid),
      'mc_messages', 'mid');

    // Pharmacien : ses ordonnances reçues (pharmacyCanReadPrescription).
    if (user.role === 'pharmacist') {
      scoped(firebaseDB.collection('mc_prescriptions').where('pharmacyUid', '==', user.uid),
        'mc_prescriptions', 'pid');
    }

    // Médecin / infirmier : la règle Firestore les autorise à LIRE la
    // collection mc_prescriptions (currentRoleIs doctor/nurse). Sans ce
    // listener, leurs ordonnances n'étaient jamais rechargées après la
    // connexion — cause du bug « ordonnances qui n'apparaissent pas ».
    // Le filtrage métier (contexte établissement, consentement patient)
    // reste appliqué à l'affichage par prescriptionsForContext ; ici on
    // se contente de ramener les données en local par fusion.
    if (user.role === 'doctor' || user.role === 'nurse') {
      scoped(firebaseDB.collection('mc_prescriptions'),
        'mc_prescriptions', 'pid');
    }
  }

  /* ── INIT ────────────────────────────────────────── */
  async function init() {
    await syncFromFirebase();
    setupRealtimeListeners();
    // Rejoue immédiatement les écritures d'une session précédente qui
    // n'avaient pas atteint le cloud (fermeture d'app hors-ligne, etc.),
    // puis réessaie régulièrement tant qu'il en reste.
    flushOutbox();
    setInterval(flushOutbox, 20000);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', flushOutbox);
    }
  }

  /* ══════════════════════════════════════════════════
     PATIENTS
  ══════════════════════════════════════════════════ */
  function getPatients()   { return load('mc_patients'); }
  function savePatients(list) { store('mc_patients', list); }

  function addPatient(data) {
    const list = getPatients();
    const p = { ...data, id: generatePatientId(data.country_code), firstAccessCode: generateFirstAccessCode(), created_at: new Date().toISOString() };
    list.push(p); store('mc_patients', list);
    _push('mc_patients', p.id, p);
    _push('patients', p.id, p);
    _push('medical_records', p.id, {
      recordId: p.id,
      patientId: p.id,
      patientUid: p.uid || p.patient_uid || '',
      created_by: p.created_by || '',
      establishmentId: p.establishmentId || p.hospital_id || '',
      type: 'patient_record',
      status: 'active',
      createdAt: p.created_at,
      updatedAt: p.created_at,
    });
    return p;
  }

  /* ── Réaffichage du code d'accès après création ──────
     showFirstAccessCodeModal (js/hospital.js) ne montre le code
     qu'une fois, à la création. Si le personnel doit le redonner au
     patient plus tard, il faut vérifier avant tout que le compte
     n'est pas déjà créé (le code serait alors sans objet) puis
     relire le code réel côté serveur — jamais se fier uniquement au
     cache local, qui peut ne pas refléter un compte créé depuis un
     autre appareil. */
  async function accountExistsForPatient(patientId) {
    const uid = `PAT_${patientId}`;
    if (getAccounts().some(a => a.uid === uid)) return true;
    if (!firebaseReady || !firebaseDB) return false;
    try {
      const doc = await firebaseDB.collection('mc_accounts').doc(uid).get();
      return doc.exists;
    } catch (e) { console.warn('[MedConnect] Vérification compte existant :', e); return false; }
  }

  async function getPatientAccessCode(patientId) {
    if (firebaseReady && firebaseDB) {
      try {
        const doc = await firebaseDB.collection('mc_patients').doc(patientId).get();
        if (doc.exists) return doc.data()?.firstAccessCode || null;
      } catch (e) { console.warn('[MedConnect] Lecture du code d\'accès :', e); }
    }
    return getPatientById(patientId)?.firstAccessCode || null;
  }

  /* Variante async de addPatient() : attend la confirmation Firestore
     réelle des 3 écritures avant de résoudre. addPatient() lance déjà
     ces écritures en fire-and-forget (jamais attendu par ses
     appelants historiques, ne pas changer son comportement) — ici on
     les repousse explicitement en mode critique (_pushCritical, même
     principe que pushAndReport) pour savoir si elles ont réellement
     atteint le cloud. Nécessaire pour fermer la course où le code
     d'accès (firstAccessCode) d'une fiche tout juste créée n'a pas
     encore atteint Firestore au moment où le patient tente son
     premier accès (voir firestore.rules patientFirstAccessOk). */
  async function addPatientAndConfirm(data) {
    const p = addPatient(data);
    // Seul mc_patients est vérifié par patientFirstAccessOk() côté
    // règles — inutile de re-pousser patients/medical_records ici,
    // addPatient() les a déjà mis en route (fire-and-forget, comme
    // pour tous ses autres appelants).
    const ok = await pushAndReport([['mc_patients', p.id, p]]);
    return { patient: p, confirmed: ok };
  }

  function updatePatient(id, data) {
    const list = getPatients();
    const idx  = list.findIndex(p => p.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, id, updated_at: new Date().toISOString() };
      store('mc_patients', list);
      _push('mc_patients', id, list[idx]);
      _push('patients', id, list[idx]);
      _push('medical_records', id, {
        recordId: id,
        patientId: id,
        patientUid: list[idx].uid || list[idx].patient_uid || '',
        created_by: list[idx].created_by || '',
        establishmentId: list[idx].establishmentId || list[idx].hospital_id || '',
        type: 'patient_record',
        status: 'active',
        updatedAt: list[idx].updated_at,
      });
      return list[idx];
    }
    return null;
  }

  function deletePatient(id) {
    store('mc_patients',       getPatients().filter(p => p.id !== id));
    store('mc_consultations',  getConsultations().filter(c => c.patient_id !== id));
    store('mc_prescriptions',  getPrescriptions().filter(p => p.patient_id !== id));
    store('mc_vaccinations',   getVaccinations().filter(v => v.patient_id !== id));
    store('mc_lab_results',    getAllLabResults().filter(l => l.patient_id !== id));
    store('mc_appointments',   getAppointments().filter(a => a.patient_id !== id));
    _delete('mc_patients', id);
    _delete('patients', id);
    _delete('medical_records', id);
  }

  function getPatientById(id) { return getPatients().find(p => p.id === id) || null; }

  function searchPatients(q) {
    if (!q) return getPatients();
    const ql = q.toLowerCase();
    return getPatients().filter(p =>
      (p.id||'').toLowerCase().includes(ql) ||
      (p.firstname||'').toLowerCase().includes(ql) ||
      (p.lastname||'').toLowerCase().includes(ql) ||
      (p.phone||'').includes(ql));
  }

  /* ══════════════════════════════════════════════════
     COMPTES
  ══════════════════════════════════════════════════ */
  function getAccounts()    { return load('mc_accounts'); }
  function saveAccounts(l)  {
    store('mc_accounts', l);
    l.forEach(a => {
      _push('mc_accounts', a.uid, a);
      mirrorAccountProfile(a);
    });
  }

  function getUsers()       { return load('users'); }
  function saveUsers(l)     {
    store('users', l);
    l.forEach(u => {
      _push('users', u.uid, u);
      const collection = roleCollection(u.role);
      if (collection) _push(collection, u.uid, u);
    });
  }

  function getRegistrationRequests() { return load('registration_requests'); }
  function saveRegistrationRequests(l) {
    store('registration_requests', l);
    l.forEach(r => _push('registration_requests', r.requestId, r));
  }

  function createRegistrationRequest(account) {
    const list = getRegistrationRequests();
    const requestId = makeId('REG');
    const req = {
      requestId,
      requesterUid: account.uid,
      requesterName: account.name || '',
      requesterRole: account.role,
      professionalNumber: professionalNumber(account),
      email: account.email || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(req);
    saveRegistrationRequests(list);
    return req;
  }

  function upsertUserProfile(uid, data) {
    const users = getUsers();
    const idx = users.findIndex(u => u.uid === uid);
    const current = idx !== -1 ? users[idx] : { uid };
    const next = { ...current, ...data, uid, updatedAt: new Date().toISOString() };
    if (idx === -1) users.push(next);
    else users[idx] = next;
    saveUsers(users);
    _push('users', uid, next);
    return next;
  }

  /* ══════════════════════════════════════════════════
     CONSULTATIONS
  ══════════════════════════════════════════════════ */
  function getConsultations() { return load('mc_consultations'); }

  function addConsultation(data) {
    const list = getConsultations();
    // sourceDevice : nécessaire pour que hospitalCanWriteFromDevice()
    // (firestore.rules) applique la distinction desktop/mobile — sans
    // ce champ, resolveHospitalId() trouve bien l'établissement mais
    // la règle reste permissive par défaut (même piège déjà corrigé
    // au cas par cas sur emergency-transfer.js, voir addPrescription
    // ci-dessous qui l'a déjà).
    const c = { ...data, cid: makeId('C'), date: data.date || today(),
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(c); store('mc_consultations', list);
    _push('mc_consultations', c.cid, c);
    _push('medical_records', c.cid, {
      ...c,
      recordId: c.cid,
      type: 'consultation',
      patientId: c.patient_id,
      patientUid: c.patient_uid || '',
      updatedAt: new Date().toISOString(),
    });
    return c;
  }

  function getPatientConsultations(pid) {
    return getConsultations().filter(c => c.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteConsultation(cid) {
    store('mc_consultations', getConsultations().filter(c => c.cid !== cid));
    _delete('mc_consultations', cid);
  }

  /* ══════════════════════════════════════════════════
     PRESCRIPTIONS
  ══════════════════════════════════════════════════ */
  function getPrescriptions() { return load('mc_prescriptions'); }

  function addPrescription(data) {
    const list = getPrescriptions();
    const p = { ...data, pid: makeId('P'), date: data.date || today(), status: data.status || 'sent',
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(p); store('mc_prescriptions', list);
    _push('mc_prescriptions', p.pid, p);
    _push('prescriptions', p.pid, p);
    return p;
  }

  /** Applique la mise à jour au store local uniquement (pas d'écriture
      cloud ici) et retourne l'objet fusionné, ou null si introuvable. */
  function _updatePrescriptionLocal(pid, data) {
    const list = getPrescriptions();
    const idx  = list.findIndex(p => p.pid === pid);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, pid, updatedAt: new Date().toISOString() };
    store('mc_prescriptions', list);
    return list[idx];
  }

  function updatePrescription(pid, data) {
    const updated = _updatePrescriptionLocal(pid, data);
    if (!updated) return null;
    _push('mc_prescriptions', pid, updated);
    _push('prescriptions', pid, updated);
    return updated;
  }

  /** Comme updatePrescription, mais attend la confirmation Firestore
      réelle avant de résoudre — utilisé quand l'appelant doit savoir
      si le cloud a réellement accepté l'écriture (ex : avant d'afficher
      "Ordonnance envoyée" à l'utilisateur) plutôt que de l'afficher de
      façon optimiste sur une écriture fire-and-forget. Retourne
      { ok, reason } plutôt qu'un simple booléen, pour que l'appelant
      distingue "hors ligne, en file d'attente" de "refusé par le
      serveur" (PARTIE H/K) — reason vaut 'offline' ou 'denied' quand
      ok est false, sinon null. */
  async function updatePrescriptionAndConfirm(pid, data) {
    const updated = _updatePrescriptionLocal(pid, data);
    if (!updated) return { ok: false, reason: 'not_found' };
    const wasOffline = !firebaseReady || !firebaseDB;
    const ok = await pushAndReport([
      ['mc_prescriptions', pid, updated],
      ['prescriptions', pid, updated],
    ]);
    return { ok, reason: ok ? null : (wasOffline ? 'offline' : 'denied') };
  }

  function getPatientPrescriptions(pid) {
    return getPrescriptions().filter(p => p.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     RENDEZ-VOUS
  ══════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════
     PARTIE G — TRACE DOCUMENTS ÉTABLISSEMENT (audit)
  ══════════════════════════════════════════════════ */
  function getEstablishmentDocuments() { return load('establishment_documents'); }

  function addEstablishmentDocument(doc) {
    const list = getEstablishmentDocuments();
    const d = {
      documentId: makeId('DOC'),
      createdAt:  new Date().toISOString(),
      auditRequired: true,
      ...doc,
    };
    list.push(d); store('establishment_documents', list);
    _push('establishment_documents', d.documentId, d);
    return d;
  }

  /** Documents d'un patient (champ canonique de establishment_documents :
      patientUid, cf. hospital.js addEstablishmentDocument), éventuellement
      filtrés par documentType (ex: 'imaging' pour l'onglet Imagerie). */
  function getPatientEstablishmentDocuments(pid, documentType) {
    return getEstablishmentDocuments()
      .filter(d => d.patientUid === pid && (!documentType || d.documentType === documentType))
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  }

  function getAppointments() { return load('mc_appointments'); }

  function addAppointment(data) {
    const list = getAppointments();
    // sourceDevice : nécessaire pour que hospitalCanWriteFromDevice()
    // (firestore.rules, mc_appointments) applique la distinction
    // desktop/mobile — la clause existait déjà côté règles (PR2) mais
    // restait un no-op sans ce champ, comme pour addConsultation avant
    // son propre correctif.
    const a = { ...data, aid: makeId('A'), created_at: new Date().toISOString(),
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(a); store('mc_appointments', list);
    _push('mc_appointments', a.aid, a);
    _push('appointments', a.aid, a);
    return a;
  }

  function updateAppointment(aid, data) {
    const list = getAppointments();
    const idx  = list.findIndex(a => a.aid === aid);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, aid };
      store('mc_appointments', list);
      _push('mc_appointments', aid, list[idx]);
      _push('appointments', aid, list[idx]);
    }
  }

  function deleteAppointment(aid) {
    store('mc_appointments', getAppointments().filter(a => a.aid !== aid));
    _delete('mc_appointments', aid);
    _delete('appointments', aid);
  }

  function getPatientAppointments(pid) {
    return getAppointments().filter(a => a.patient_id === pid).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }

  /* ══════════════════════════════════════════════════
     VACCINATIONS
  ══════════════════════════════════════════════════ */
  function getVaccinations() { return load('mc_vaccinations'); }

  function addVaccination(data) {
    const list = getVaccinations();
    const v = { ...data, vid: makeId('V'), date: data.date || today() };
    list.push(v); store('mc_vaccinations', list);
    _push('mc_vaccinations', v.vid, v);
    return v;
  }

  function getPatientVaccinations(pid) {
    return getVaccinations().filter(v => v.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteVaccination(vid) {
    store('mc_vaccinations', getVaccinations().filter(v => v.vid !== vid));
    _delete('mc_vaccinations', vid);
  }

  /* ══════════════════════════════════════════════════
     LABORATOIRE
  ══════════════════════════════════════════════════ */
  function getAllLabResults() { return load('mc_lab_results'); }

  function addLabResult(data) {
    const list = getAllLabResults();
    const l = { ...data, lid: makeId('L'), date: data.date || today() };
    list.push(l); store('mc_lab_results', list);
    _push('mc_lab_results', l.lid, l);
    _push('medical_records', l.lid, {
      ...l,
      recordId: l.lid,
      type: 'lab_result',
      patientId: l.patient_id,
      patientUid: l.patient_uid || '',
      updatedAt: new Date().toISOString(),
    });
    return l;
  }

  function getPatientLabResults(pid) {
    return getAllLabResults().filter(l => l.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteLabResult(lid) {
    store('mc_lab_results', getAllLabResults().filter(l => l.lid !== lid));
    _delete('mc_lab_results', lid);
    _delete('medical_records', lid);
  }

  /* ══════════════════════════════════════════════════
     ADMISSIONS (miroir patient)

     Correctif (audit) : hospital-beds.js/hospital-reception.js
     écrivent l'admission dans la collection desktop `admissions`
     (patientMc, jamais lue par le patient) — le filtre "🏥
     Hospitalisation" de js/timeline.js existait déjà côté interface
     mais n'était jamais alimenté. mc_admissions est le miroir
     lisible côté patient, même principe que mc_lab_results.
  ══════════════════════════════════════════════════ */
  function getAllAdmissions() { return load('mc_admissions'); }

  function addAdmissionRecord(data) {
    const list = getAllAdmissions();
    const a = { ...data, aid: data.aid || makeId('ADM'), date: data.date || today() };
    list.push(a); store('mc_admissions', list);
    _push('mc_admissions', a.aid, a);
    return a;
  }

  function getPatientAdmissions(pid) {
    return getAllAdmissions().filter(a => a.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     URGENCES / MATERNITÉ (miroirs patient)

     Correctif (audit) : hospital-emergency.js/hospital-maternity.js
     écrivent uniquement dans les collections desktop emergencyCases/
     maternityCases (patientMc, aucun champ patient_uid/uid) — lues
     exclusivement par leur propre module desktop, jamais par le
     patient ni par un autre professionnel. Même principe de miroir
     que mc_lab_results/mc_admissions.
  ══════════════════════════════════════════════════ */
  function getAllEmergencyCases() { return load('mc_emergency_cases'); }

  function addEmergencyCaseRecord(data) {
    const list = getAllEmergencyCases();
    const e = { ...data, eid: data.eid || makeId('ER'), date: data.date || today() };
    list.push(e); store('mc_emergency_cases', list);
    _push('mc_emergency_cases', e.eid, e);
    return e;
  }

  function getPatientEmergencyCases(pid) {
    return getAllEmergencyCases().filter(e => e.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function getAllMaternityCases() { return load('mc_maternity_cases'); }

  function addMaternityCaseRecord(data) {
    const list = getAllMaternityCases();
    const m = { ...data, mid: data.mid || makeId('MAT'), date: data.date || today() };
    list.push(m); store('mc_maternity_cases', list);
    _push('mc_maternity_cases', m.mid, m);
    return m;
  }

  function getPatientMaternityCases(pid) {
    return getAllMaternityCases().filter(m => m.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     MÉDICAMENTS
  ══════════════════════════════════════════════════ */
  function getMedicines() { return load('mc_medicines'); }

  function addMedicine(data) {
    const list = getMedicines();
    const m = { ...data, mid: makeId('M'), created_at: new Date().toISOString() };
    list.push(m); store('mc_medicines', list);
    _push('mc_medicines', m.mid, m);
    return m;
  }

  function updateMedicine(mid, data) {
    const list = getMedicines();
    const idx  = list.findIndex(m => m.mid === mid);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, mid };
      store('mc_medicines', list);
      _push('mc_medicines', mid, list[idx]);
    }
  }

  function deleteMedicine(mid) {
    store('mc_medicines', getMedicines().filter(m => m.mid !== mid));
    _delete('mc_medicines', mid);
  }

  /* ══════════════════════════════════════════════════
     VENTES
  ══════════════════════════════════════════════════ */
  function getSales() { return load('mc_sales'); }

  function addSale(items, total, patientId) {
    const list = getSales();
    const s = {
      sid: makeId('S'), items,
      total: parseFloat(total).toFixed(2),
      patient_id: patientId || null,
      date: today(), time: new Date().toLocaleTimeString(),
    };
    list.push(s); store('mc_sales', list);
    _push('mc_sales', s.sid, s);
    // Déduire le stock
    const meds = getMedicines();
    items.forEach(i => {
      const idx = meds.findIndex(m => m.mid === i.mid);
      if (idx !== -1) meds[idx].stock = Math.max(0, (parseInt(meds[idx].stock)||0) - i.qty);
    });
    store('mc_medicines', meds);
    meds.forEach(m => _push('mc_medicines', m.mid, m));
    return s;
  }

  /* ══════════════════════════════════════════════════
     MESSAGES
  ══════════════════════════════════════════════════ */
  function getMessages()    { return load('mc_messages'); }
  function saveMessages(l)  {
    store('mc_messages', l);
    l.forEach(m => {
      _push('mc_messages', m.mid, m);
      _push('notifications', m.mid, m);
    });
  }

  /* ══════════════════════════════════════════════════
     PARAMÈTRES
  ══════════════════════════════════════════════════ */
  function getSettings()      { return load('mc_settings', {}); }
  function saveSettings(data) {
    const s = { ...getSettings(), ...data };
    store('mc_settings', s);
    // Nettoyage (audit) : l'ancienne écriture cloud des réglages visait
    // une collection SANS aucune règle Firestore — systématiquement
    // rejetée par la clause catch-all (allow write: if false) — et jamais
    // relue côté cloud (getSettings lit le localStorage local, aucune
    // synchronisation des réglages). Écriture morte retirée : les réglages
    // restent locaux à l'appareil, comme c'était déjà le cas en pratique.
    // (Une vraie synchro cross-appareil nécessiterait règles + listener +
    // lecture cloud — hors périmètre.)
  }

  /* ══════════════════════════════════════════════════
     STATISTIQUES
  ══════════════════════════════════════════════════ */
  function getStats() {
    const pts   = getPatients();
    const cons  = getConsultations();
    const sales = getSales();
    const meds  = getMedicines();
    const apts  = getAppointments();
    const msgs  = getMessages();
    const td    = today();
    return {
      totalPatients:   pts.length,
      todayPatients:   pts.filter(p => (p.created_at||'').startsWith(td)).length,
      totalConsults:   cons.length,
      todayConsults:   cons.filter(c => c.date === td).length,
      totalSales:      sales.reduce((s,x) => s + parseFloat(x.total||0), 0),
      todaySales:      sales.filter(x => x.date === td).reduce((s,x) => s + parseFloat(x.total||0), 0),
      lowStockCount:   meds.filter(m => parseInt(m.stock) < 10).length,
      expiredCount:    meds.filter(m => m.expiry && m.expiry < td).length,
      pendingApts:     apts.filter(a => a.status === 'pending' && a.date >= td).length,
      unreadMessages:  msgs.filter(m => !m.read).length,
    };
  }

  return {
    init, syncFromFirebase, syncFromFirebaseInBackground, setupUserScopedListeners, generatePatientId, makeId, pushAndReport, flushOutbox, outboxCount, getLastSyncAt,
    // pushCloud/deleteCloud : wrappers publics sur _push/_delete, à
    // utiliser par tout module (access_control.js, hospitals_registry.js,
    // affiliation-cleanup.js...) au lieu de réimplémenter un mini-push
    // Firestore local avec .catch(() => {}) qui avale les échecs en
    // silence. Ici, tout échec est loggé ET mis en file d'attente pour
    // rejeu automatique (voir _push ci-dessus).
    pushCloud: _push, deleteCloud: _delete, roleCollection,
    getAccounts, saveAccounts, getUsers, saveUsers, upsertUserProfile,
    getRegistrationRequests, saveRegistrationRequests, createRegistrationRequest,
    getPatients, savePatients, addPatient, addPatientAndConfirm, updatePatient, deletePatient, getPatientById, searchPatients,
    accountExistsForPatient, getPatientAccessCode,
    getConsultations, addConsultation, getPatientConsultations, deleteConsultation,
    getPrescriptions, addPrescription, updatePrescription, updatePrescriptionAndConfirm, getPatientPrescriptions,
    getEstablishmentDocuments, addEstablishmentDocument, getPatientEstablishmentDocuments,
    getAppointments, addAppointment, updateAppointment, deleteAppointment, getPatientAppointments,
    getVaccinations, addVaccination, getPatientVaccinations, deleteVaccination,
    getAllLabResults, addLabResult, getPatientLabResults, deleteLabResult,
    getAllAdmissions, addAdmissionRecord, getPatientAdmissions,
    getAllEmergencyCases, addEmergencyCaseRecord, getPatientEmergencyCases,
    getAllMaternityCases, addMaternityCaseRecord, getPatientMaternityCases,
    getMedicines, addMedicine, updateMedicine, deleteMedicine,
    getSales, addSale,
    getMessages, saveMessages,
    getSettings, saveSettings,
    getStats,
  };
})();

window.DB = DB;
