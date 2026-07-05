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
      console.warn(`[MedConnect] Firestore indisponible — écriture locale seulement (${collection}/${docId})`);
      return false;
    }
    try {
      await firebaseDB.collection(collection).doc(String(docId)).set(data);
      return true;
    } catch (e) {
      console.warn(`[MedConnect] Échec écriture Firestore ${collection}/${docId} :`, e?.message || e);
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

  function storeSnapshot(key, snap) {
    // Un snapshot VIDE confirmé par le serveur est une information :
    // la collection n'existe plus, le cache local doit se vider (les
    // « demandes fantômes » du dashboard admin venaient des gardes
    // !snap.empty qui ignoraient ce cas — le local ne se vidait
    // jamais). On n'ignore que les vides issus du cache hors-ligne
    // (démarrage sans réseau), pour ne pas effacer des données valides.
    if (snap.empty && snap.metadata?.fromCache) return;
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
      'mc_vaccinations','mc_lab_results','mc_consents',
      'users',
      'patients','doctors','nurses','pharmacies','hospitals',
      'medical_records','prescriptions','appointments','notifications',
      'mc_hospitals','mc_affiliations',
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
        // Vide confirmé serveur = la collection a été vidée : le cache
        // local doit suivre (mêmes fantômes possibles qu'avec les
        // listeners). Seul le vide issu du cache hors-ligne est ignoré.
        if (!(snap.empty && snap.metadata?.fromCache)) store(col, snap.docs.map(d => d.data()));
      } catch (e) {
        console.warn(`[MedConnect] Sync ${col} ignorée (lente/indisponible) :`, e?.message || e);
      }
    }));
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
    // Patients
    listen(firebaseDB.collection('mc_patients'), snap => {
      storeSnapshot('mc_patients', snap);
    });
    // Messages : PAS de listener global ici — la règle Firestore exige
    // to_id == uid par document, une écoute collection-entière est
    // rejetée en bloc pour tout le monde (c'était le cas depuis
    // toujours, silencieusement). Voir setupUserScopedListeners().
    // Rendez-vous
    listen(firebaseDB.collection('mc_appointments'), snap => {
      storeSnapshot('mc_appointments', snap);
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
    // Ordonnances — pour rafraîchir l'inbox pharmacie/médecin en quasi temps réel
    listen(firebaseDB.collection('mc_prescriptions'), snap => {
      storeSnapshot('mc_prescriptions', snap);
    });
    // Consultations
    listen(firebaseDB.collection('mc_consultations'), snap => {
      storeSnapshot('mc_consultations', snap);
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
          snap => { if (!snap.empty) mergeStore(key, idField, snap.docs.map(d => d.data())); },
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
  }

  /* ── INIT ────────────────────────────────────────── */
  async function init() {
    await syncFromFirebase();
    setupRealtimeListeners();
  }

  /* ══════════════════════════════════════════════════
     PATIENTS
  ══════════════════════════════════════════════════ */
  function getPatients()   { return load('mc_patients'); }
  function savePatients(list) { store('mc_patients', list); }

  function addPatient(data) {
    const list = getPatients();
    const p = { ...data, id: generatePatientId(data.country_code), created_at: new Date().toISOString() };
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
    const c = { ...data, cid: makeId('C'), date: data.date || today() };
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
    const p = { ...data, pid: makeId('P'), date: data.date || today(), status: data.status || 'sent' };
    list.push(p); store('mc_prescriptions', list);
    _push('mc_prescriptions', p.pid, p);
    _push('prescriptions', p.pid, p);
    return p;
  }

  function updatePrescription(pid, data) {
    const list = getPrescriptions();
    const idx  = list.findIndex(p => p.pid === pid);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, pid, updatedAt: new Date().toISOString() };
    store('mc_prescriptions', list);
    _push('mc_prescriptions', pid, list[idx]);
    _push('prescriptions', pid, list[idx]);
    return list[idx];
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

  function getAppointments() { return load('mc_appointments'); }

  function addAppointment(data) {
    const list = getAppointments();
    const a = { ...data, aid: makeId('A'), created_at: new Date().toISOString() };
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
    const user = Auth?.getUser?.();
    if (user) _push('mc_settings', user.uid, s);
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
    init, syncFromFirebase, syncFromFirebaseInBackground, setupUserScopedListeners, generatePatientId, makeId, pushAndReport,
    getAccounts, saveAccounts, getUsers, saveUsers, upsertUserProfile,
    getRegistrationRequests, saveRegistrationRequests, createRegistrationRequest,
    getPatients, savePatients, addPatient, updatePatient, deletePatient, getPatientById, searchPatients,
    getConsultations, addConsultation, getPatientConsultations, deleteConsultation,
    getPrescriptions, addPrescription, updatePrescription, getPatientPrescriptions,
    getEstablishmentDocuments, addEstablishmentDocument,
    getAppointments, addAppointment, updateAppointment, deleteAppointment,
    getVaccinations, addVaccination, getPatientVaccinations, deleteVaccination,
    getAllLabResults, addLabResult, getPatientLabResults, deleteLabResult,
    getMedicines, addMedicine, updateMedicine, deleteMedicine,
    getSales, addSale,
    getMessages, saveMessages,
    getSettings, saveSettings,
    getStats,
  };
})();

window.DB = DB;
