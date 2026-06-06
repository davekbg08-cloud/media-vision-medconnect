/* =====================================================
   MedConnect 2.0 — DB Module (localStorage)
   Numéro de série patient : MC-YYYY-CC-XXXXXXXX
   ===================================================== */
const DB = (() => {

  /* ── SERIAL NUMBER ──────────────────────────────────
     MC-2026-NG-A3B7X9Q2
  ──────────────────────────────────────────────────── */
  function generatePatientId(countryCode) {
    const year  = new Date().getFullYear();
    const cc    = (countryCode || 'XX').toUpperCase().slice(0, 2);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let   rnd   = '';
    for (let i = 0; i < 8; i++) rnd += chars[Math.floor(Math.random() * chars.length)];
    return `MC-${year}-${cc}-${rnd}`;
  }

  /* ── HELPERS ──────────────────────────────────────── */
  const load = (k, d=[]) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };
  const save = (k, v)     => localStorage.setItem(k, JSON.stringify(v));
  const today = ()        => new Date().toISOString().slice(0, 10);

  /* ── ACCOUNTS ─────────────────────────────────────── */
  function getAccounts()        { return load('mc_accounts'); }
  function saveAccounts(list)   { save('mc_accounts', list); }

  /* ── PATIENTS ─────────────────────────────────────── */
  function getPatients()        { return load('mc_patients'); }
  function savePatients(list)   { save('mc_patients', list); }

  function addPatient(data) {
    const list = getPatients();
    const p = { ...data, id: generatePatientId(data.country_code), created_at: new Date().toISOString() };
    list.push(p);
    savePatients(list);
    return p;
  }
  function updatePatient(id, data) {
    const list = getPatients();
    const idx  = list.findIndex(p => p.id === id);
    if (idx !== -1) { list[idx] = { ...list[idx], ...data, id, updated_at: new Date().toISOString() }; savePatients(list); return list[idx]; }
    return null;
  }
  function deletePatient(id) {
    savePatients(getPatients().filter(p => p.id !== id));
    save('mc_consultations',  getConsultations().filter(c => c.patient_id !== id));
    save('mc_prescriptions',  getPrescriptions().filter(p => p.patient_id !== id));
    save('mc_vaccinations',   getVaccinations().filter(v => v.patient_id !== id));
    save('mc_lab_results',    getAllLabResults().filter(l => l.patient_id !== id));
    save('mc_appointments',   getAppointments().filter(a => a.patient_id !== id));
  }
  function getPatientById(id)   { return getPatients().find(p => p.id === id) || null; }
  function searchPatients(q) {
    if (!q) return getPatients();
    const ql = q.toLowerCase();
    return getPatients().filter(p =>
      (p.id||'').toLowerCase().includes(ql) ||
      (p.firstname||'').toLowerCase().includes(ql) ||
      (p.lastname||'').toLowerCase().includes(ql) ||
      (p.phone||'').includes(ql));
  }

  /* ── CONSULTATIONS ────────────────────────────────── */
  function getConsultations()   { return load('mc_consultations'); }
  function addConsultation(data) {
    const list = getConsultations();
    const c = { ...data, cid: `C${Date.now()}`, date: data.date || today() };
    list.push(c); save('mc_consultations', list); return c;
  }
  function getPatientConsultations(pid) {
    return getConsultations().filter(c => c.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }
  function deleteConsultation(cid) { save('mc_consultations', getConsultations().filter(c => c.cid !== cid)); }

  /* ── PRESCRIPTIONS ────────────────────────────────── */
  function getPrescriptions()   { return load('mc_prescriptions'); }
  function addPrescription(data) {
    const list = getPrescriptions();
    const p = { ...data, pid: `P${Date.now()}`, date: data.date || today() };
    list.push(p); save('mc_prescriptions', list); return p;
  }
  function getPatientPrescriptions(pid) {
    return getPrescriptions().filter(p => p.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ── APPOINTMENTS ─────────────────────────────────── */
  function getAppointments()    { return load('mc_appointments'); }
  function addAppointment(data) {
    const list = getAppointments();
    const a = { ...data, aid: `A${Date.now()}`, created_at: new Date().toISOString() };
    list.push(a); save('mc_appointments', list); return a;
  }
  function updateAppointment(aid, data) {
    const list = getAppointments();
    const idx  = list.findIndex(a => a.aid === aid);
    if (idx !== -1) { list[idx] = { ...list[idx], ...data, aid }; save('mc_appointments', list); }
  }
  function deleteAppointment(aid) { save('mc_appointments', getAppointments().filter(a => a.aid !== aid)); }

  /* ── VACCINATIONS ─────────────────────────────────── */
  function getVaccinations()    { return load('mc_vaccinations'); }
  function addVaccination(data) {
    const list = getVaccinations();
    const v = { ...data, vid: `V${Date.now()}`, date: data.date || today() };
    list.push(v); save('mc_vaccinations', list); return v;
  }
  function getPatientVaccinations(pid) {
    return getVaccinations().filter(v => v.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }
  function deleteVaccination(vid) { save('mc_vaccinations', getVaccinations().filter(v => v.vid !== vid)); }

  /* ── LAB RESULTS ──────────────────────────────────── */
  function getAllLabResults()    { return load('mc_lab_results'); }
  function addLabResult(data) {
    const list = getAllLabResults();
    const l = { ...data, lid: `L${Date.now()}`, date: data.date || today() };
    list.push(l); save('mc_lab_results', list); return l;
  }
  function getPatientLabResults(pid) {
    return getAllLabResults().filter(l => l.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }
  function deleteLabResult(lid) { save('mc_lab_results', getAllLabResults().filter(l => l.lid !== lid)); }

  /* ── MEDICINES ────────────────────────────────────── */
  function getMedicines()       { return load('mc_medicines'); }
  function addMedicine(data) {
    const list = getMedicines();
    const m = { ...data, mid: `M${Date.now()}`, created_at: new Date().toISOString() };
    list.push(m); save('mc_medicines', list); return m;
  }
  function updateMedicine(mid, data) {
    const list = getMedicines();
    const idx  = list.findIndex(m => m.mid === mid);
    if (idx !== -1) { list[idx] = { ...list[idx], ...data, mid }; save('mc_medicines', list); }
  }
  function deleteMedicine(mid)  { save('mc_medicines', getMedicines().filter(m => m.mid !== mid)); }

  /* ── SALES ────────────────────────────────────────── */
  function getSales()           { return load('mc_sales'); }
  function addSale(items, total, patientId) {
    const list = getSales();
    const s = { sid:`S${Date.now()}`, items, total:parseFloat(total).toFixed(2), patient_id:patientId||null, date:today(), time:new Date().toLocaleTimeString() };
    list.push(s); save('mc_sales', list);
    const meds = getMedicines();
    items.forEach(i => { const idx=meds.findIndex(m=>m.mid===i.mid); if(idx!==-1) meds[idx].stock=Math.max(0,(parseInt(meds[idx].stock)||0)-i.qty); });
    save('mc_medicines', meds);
    return s;
  }

  /* ── MESSAGES (Network) ───────────────────────────── */
  function getMessages()        { return load('mc_messages'); }
  function saveMessages(list)   { save('mc_messages', list); }

  /* ── SETTINGS ─────────────────────────────────────── */
  function getSettings()        { return load('mc_settings', {}); }
  function saveSettings(data)   { save('mc_settings', { ...getSettings(), ...data }); }

  /* ── STATS ────────────────────────────────────────── */
  function getStats() {
    const pts   = getPatients();
    const cons  = getConsultations();
    const sales = getSales();
    const meds  = getMedicines();
    const apts  = getAppointments();
    const td    = today();
    return {
      totalPatients:   pts.length,
      todayPatients:   pts.filter(p=>(p.created_at||'').startsWith(td)).length,
      totalConsults:   cons.length,
      todayConsults:   cons.filter(c=>c.date===td).length,
      totalSales:      sales.reduce((s,x)=>s+parseFloat(x.total||0),0),
      todaySales:      sales.filter(x=>x.date===td).reduce((s,x)=>s+parseFloat(x.total||0),0),
      lowStockCount:   meds.filter(m=>parseInt(m.stock)<10).length,
      expiredCount:    meds.filter(m=>m.expiry && m.expiry < td).length,
      pendingApts:     apts.filter(a=>a.status==='pending' && a.date>=td).length,
      unreadMessages:  getMessages().filter(m=>!m.read).length,
    };
  }

  return {
    generatePatientId,
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

// Compatibility bridge for legacy helpers that still expect the old async MedDB API.
window.MedDB = window.MedDB || {
  openDB: async () => null,
  seedDemoData: async () => null,
  dbGetAll: async (storeName) => {
    const map = {
      patients: DB.getPatients,
      consultations: DB.getConsultations,
      products: DB.getMedicines,
      sales: DB.getSales,
      appointments: DB.getAppointments,
    };
    return map[storeName]?.() || [];
  },
  dbGet: async (storeName, id) => {
    const items = await window.MedDB.dbGetAll(storeName);
    return items.find(item => String(item.id || item.mid || item.sid || item.aid || item.cid) === String(id)) || null;
  },
};
