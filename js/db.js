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
  ──────────────────────────────────────────────────── */
  async function _push(collection, docId, data) {
    if (!firebaseReady || !firebaseDB) return;
    try {
      await firebaseDB.collection(collection).doc(String(docId)).set(data);
    } catch (e) {}
  }

  async function _delete(collection, docId) {
    if (!firebaseReady || !firebaseDB) return;
    try {
      await firebaseDB.collection(collection).doc(String(docId)).delete();
    } catch (e) {}
  }

  /* ── SYNC AU DÉMARRAGE ───────────────────────────── */
  async function syncFromFirebase() {
    if (!firebaseReady || !firebaseDB) return;
    const collections = [
      'mc_patients','mc_accounts','mc_consultations','mc_prescriptions',
      'mc_appointments','mc_vaccinations','mc_lab_results',
      'mc_medicines','mc_sales','mc_messages','mc_consents',
      'mc_hospitals','mc_affiliations',
      'mc_verified_doctors','mc_verified_pharms','mc_verified_nurses',
    ];
    for (const col of collections) {
      try {
        const snap = await firebaseDB.collection(col).get();
        if (!snap.empty) {
          const data = snap.docs.map(d => d.data());
          store(col, data);
        }
      } catch (e) {}
    }
  }

  /* ── LISTENERS TEMPS RÉEL ────────────────────────── */
  function setupRealtimeListeners() {
    if (!firebaseReady || !firebaseDB) return;
    // Patients
    firebaseDB.collection('mc_patients').onSnapshot(snap => {
      if (!snap.empty) { store('mc_patients', snap.docs.map(d => d.data())); }
    });
    // Messages
    firebaseDB.collection('mc_messages').onSnapshot(snap => {
      if (!snap.empty) { store('mc_messages', snap.docs.map(d => d.data())); }
    });
    // Rendez-vous
    firebaseDB.collection('mc_appointments').onSnapshot(snap => {
      if (!snap.empty) { store('mc_appointments', snap.docs.map(d => d.data())); }
    });
    // Comptes
    firebaseDB.collection('mc_accounts').onSnapshot(snap => {
      if (!snap.empty) { store('mc_accounts', snap.docs.map(d => d.data())); }
    });
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

  function addPatient(data) {
    const list = getPatients();
    const p = { ...data, id: generatePatientId(data.country_code), created_at: new Date().toISOString() };
    list.push(p); store('mc_patients', list);
    _push('mc_patients', p.id, p);
    return p;
  }

  function updatePatient(id, data) {
    const list = getPatients();
    const idx  = list.findIndex(p => p.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, id, updated_at: new Date().toISOString() };
      store('mc_patients', list);
      _push('mc_patients', id, list[idx]);
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
  function saveAccounts(l)  { store('mc_accounts', l); l.forEach(a => _push('mc_accounts', a.uid, a)); }

  /* ══════════════════════════════════════════════════
     CONSULTATIONS
  ══════════════════════════════════════════════════ */
  function getConsultations() { return load('mc_consultations'); }

  function addConsultation(data) {
    const list = getConsultations();
    const c = { ...data, cid: `C${Date.now()}`, date: data.date || today() };
    list.push(c); store('mc_consultations', list);
    _push('mc_consultations', c.cid, c);
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
    const p = { ...data, pid: `P${Date.now()}`, date: data.date || today() };
    list.push(p); store('mc_prescriptions', list);
    _push('mc_prescriptions', p.pid, p);
    return p;
  }

  function getPatientPrescriptions(pid) {
    return getPrescriptions().filter(p => p.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     RENDEZ-VOUS
  ══════════════════════════════════════════════════ */
  function getAppointments() { return load('mc_appointments'); }

  function addAppointment(data) {
    const list = getAppointments();
    const a = { ...data, aid: `A${Date.now()}`, created_at: new Date().toISOString() };
    list.push(a); store('mc_appointments', list);
    _push('mc_appointments', a.aid, a);
    return a;
  }

  function updateAppointment(aid, data) {
    const list = getAppointments();
    const idx  = list.findIndex(a => a.aid === aid);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, aid };
      store('mc_appointments', list);
      _push('mc_appointments', aid, list[idx]);
    }
  }

  function deleteAppointment(aid) {
    store('mc_appointments', getAppointments().filter(a => a.aid !== aid));
    _delete('mc_appointments', aid);
  }

  /* ══════════════════════════════════════════════════
     VACCINATIONS
  ══════════════════════════════════════════════════ */
  function getVaccinations() { return load('mc_vaccinations'); }

  function addVaccination(data) {
    const list = getVaccinations();
    const v = { ...data, vid: `V${Date.now()}`, date: data.date || today() };
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
    const l = { ...data, lid: `L${Date.now()}`, date: data.date || today() };
    list.push(l); store('mc_lab_results', list);
    _push('mc_lab_results', l.lid, l);
    return l;
  }

  function getPatientLabResults(pid) {
    return getAllLabResults().filter(l => l.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteLabResult(lid) {
    store('mc_lab_results', getAllLabResults().filter(l => l.lid !== lid));
    _delete('mc_lab_results', lid);
  }

  /* ══════════════════════════════════════════════════
     MÉDICAMENTS
  ══════════════════════════════════════════════════ */
  function getMedicines() { return load('mc_medicines'); }

  function addMedicine(data) {
    const list = getMedicines();
    const m = { ...data, mid: `M${Date.now()}`, created_at: new Date().toISOString() };
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
      sid: `S${Date.now()}`, items,
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
    l.forEach(m => _push('mc_messages', m.mid, m));
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
    init, syncFromFirebase, generatePatientId,
    getAccounts, saveAccounts,
    getPatients, addPatient, updatePatient, deletePatient, getPatientById, searchPatients,
    getConsultations, addConsultation, getPatientConsultations, deleteConsultation,
    getPrescriptions, addPrescription, getPatientPrescriptions,
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
