/* =====================================================
   MedConnect 2.0 — Access Control Layer (ACL)
   ===================================================== */
const ACL = (() => {

  const load = k => {
    try { return JSON.parse(localStorage.getItem(k) || '[]'); }
    catch { return []; }
  };
  const saveLocal = (k,v) => localStorage.setItem(k, JSON.stringify(v));

  /* PARTIE K — pushCloud/deleteCloud délèguent maintenant à
     DB.pushCloud/DB.deleteCloud (js/db.js) au lieu de réimplémenter un
     mini-push Firestore local avec .catch(() => {}) : tout échec (y
     compris pour mc_consents, le cas le plus sensible) est désormais
     loggé ET mis en file d'attente pour rejeu automatique, plutôt que
     silencieusement perdu quand le cloud est indisponible. */
  function pushCloud(collection, docId, data) {
    if (!docId) return;
    DB.pushCloud(collection, docId, data);
  }

  function deleteCloud(collection, docId) {
    if (!docId) return;
    DB.deleteCloud(collection, docId);
  }

  function getVerifiedDoctors()    { return load('mc_verified_doctors'); }
  function getVerifiedPharmacists(){ return load('mc_verified_pharms');  }
  function getVerifiedNurses()     { return load('mc_verified_nurses');  }
  function saveVerifiedDoctors(l) {
    saveLocal('mc_verified_doctors', l);
    l.forEach(d => pushCloud('mc_verified_doctors', d.order_num, d));
  }
  function saveVerifiedPharmacists(l) {
    saveLocal('mc_verified_pharms', l);
    l.forEach(p => pushCloud('mc_verified_pharms', p.matricule, p));
  }
  function saveVerifiedNurses(l) {
    saveLocal('mc_verified_nurses', l);
    l.forEach(n => pushCloud('mc_verified_nurses', n.matricule, n));
  }

  /* ── VÉRIFICATION DU REGISTRE OFFICIEL */
  function isDoctorVerified(num) {
    return getVerifiedDoctors().some(d =>
      d.order_num.toUpperCase() === num.trim().toUpperCase());
  }
  function isPharmacistVerified(num) {
    return getVerifiedPharmacists().some(p =>
      p.matricule.toUpperCase() === num.trim().toUpperCase());
  }
  function isNurseVerified(num) {
    return getVerifiedNurses().some(n =>
      n.matricule.toUpperCase() === num.trim().toUpperCase());
  }

  /* ── AJOUT / SUPPRESSION ──────────────────────────── */
  function addVerifiedDoctor(data) {
    const list = getVerifiedDoctors();
    const key  = data.order_num.toUpperCase();
    if (list.find(d => d.order_num === key)) return false;
    list.push({ ...data, order_num: key, added_at: new Date().toISOString() });
    saveVerifiedDoctors(list); return true;
  }
  function addVerifiedPharmacist(data) {
    const list = getVerifiedPharmacists();
    const key  = data.matricule.toUpperCase();
    if (list.find(p => p.matricule === key)) return false;
    list.push({ ...data, matricule: key, added_at: new Date().toISOString() });
    saveVerifiedPharmacists(list); return true;
  }
  function addVerifiedNurse(data) {
    const list = getVerifiedNurses();
    const key  = data.matricule.toUpperCase();
    if (list.find(n => n.matricule === key)) return false;
    list.push({ ...data, matricule: key, added_at: new Date().toISOString() });
    saveVerifiedNurses(list); return true;
  }
  function removeVerifiedDoctor(num) {
    const key = (num || '').toUpperCase();
    saveVerifiedDoctors(getVerifiedDoctors().filter(d => d.order_num !== key));
    deleteCloud('mc_verified_doctors', key);
  }
  function removeVerifiedPharmacist(num) {
    const key = (num || '').toUpperCase();
    saveVerifiedPharmacists(getVerifiedPharmacists().filter(p => p.matricule !== key));
    deleteCloud('mc_verified_pharms', key);
  }
  function removeVerifiedNurse(num) {
    const key = (num || '').toUpperCase();
    saveVerifiedNurses(getVerifiedNurses().filter(n => n.matricule !== key));
    deleteCloud('mc_verified_nurses', key);
  }

  function initRegistry() {
    // Le registre officiel est alimenté par l'administrateur, jamais par seed client.
  }

  /* ── CONSENTEMENTS ────────────────────────────────── */
  function getConsents()   { return load('mc_consents'); }
  function saveConsents(l) {
    saveLocal('mc_consents', l);
    l.forEach(c => pushCloud('mc_consents', c.cid, c));
  }

  function requestConsent(patientId, doctorId, doctorName) {
    const list = getConsents();
    if (list.find(c => c.patient_id===patientId && c.doctor_id===doctorId && c.status==='approved')) return;
    const c = { cid:DB.makeId('CON'), patient_id:patientId, doctor_id:doctorId,
                doctor_name:doctorName, status:'pending', requested_at:new Date().toISOString() };
    list.push(c); saveConsents(list);
    const msgs = DB.getMessages();
    msgs.push({ mid:DB.makeId('N'), to_role:'patient', to_id:patientId, type:'consent_request',
      subject:`🔐 Demande d'accès — ${doctorName}`,
      body:`${doctorName} souhaite accéder à votre dossier médical complet.\nAcceptez ou refusez dans Paramètres → Confidentialité.`,
      from:doctorName, date:new Date().toISOString().slice(0,10), read:false, consent_id:c.cid });
    DB.saveMessages(msgs);
    return c;
  }

  function respondConsent(cid, approved) {
    const list = getConsents();
    const idx  = list.findIndex(c => c.cid === cid);
    if (idx === -1) return;
    list[idx].status     = approved ? 'approved' : 'denied';
    list[idx].decided_at = new Date().toISOString();
    if (approved) list[idx].expires_at = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    saveConsents(list);
  }

  function revokeConsent(cid) {
    const list = getConsents();
    const idx  = list.findIndex(c => c.cid === cid);
    if (idx !== -1) { list[idx].status = 'revoked'; saveConsents(list); }
  }

  function hasConsent(patientId, doctorId) {
    const today = new Date().toISOString().slice(0,10);
    return getConsents().some(c =>
      c.patient_id===patientId && c.doctor_id===doctorId &&
      c.status==='approved' && (!c.expires_at || c.expires_at >= today));
  }

  function getPatientConsents(pid) { return getConsents().filter(c => c.patient_id === pid); }

  /* ── CONTRÔLE D'ACCÈS ─────────────────────────────── */
  /* PARTIE K — le médecin auteur d'un acte garde toujours accès,
     même s'il n'a pas créé la fiche patient lui-même. */
  function isAuthorDoctor(user, patientId) {
    if (!user?.uid) return false;
    const p = DB.getPatientById(patientId);
    if (p && p.created_by === user.uid) return true;
    const authored = c => (c.patient_id === patientId) && (c.doctor_uid === user.uid || c.created_by === user.uid);
    return DB.getConsultations().some(authored) || DB.getPrescriptions().some(authored);
  }

  /** Liste les médecins ayant un accès automatique (auteur) à ce patient */
  function getAuthorDoctors(patientId) {
    const names = new Map();
    const p = DB.getPatientById(patientId);
    if (p?.created_by) names.set(p.created_by, p.created_by_name || 'Médecin');
    DB.getConsultations().filter(c => c.patient_id === patientId).forEach(c => {
      if (c.doctor_uid) names.set(c.doctor_uid, c.doctor || names.get(c.doctor_uid) || 'Médecin');
    });
    DB.getPrescriptions().filter(rx => rx.patient_id === patientId).forEach(rx => {
      if (rx.doctor_uid) names.set(rx.doctor_uid, rx.doctor || names.get(rx.doctor_uid) || 'Médecin');
    });
    return [...names.entries()].map(([uid, name]) => ({ uid, name }));
  }

  function canAccessPatient(user, patientId) {
    if (!user) return false;
    if (user.role === 'patient')    return localStorage.getItem('mc_my_patient_id') === patientId;
    if (user.role === 'pharmacist') return false;
    if (user.role === 'admin')      return true;
    if (isAuthorDoctor(user, patientId)) return true;
    return hasConsent(patientId, user.uid);
  }

  /* ── JOURNAL D'ACCÈS ──────────────────────────────── */
  function getAccessLog() { return load('mc_access_log'); }
  function logAccess(patientId, userId, action) {
    const log = getAccessLog();
    const entry = { lid:`L${Date.now()}`, patient_id:patientId, user_id:userId, action, timestamp:new Date().toISOString() };
    log.push(entry);
    if (log.length > 500) log.splice(0, log.length - 500);
    saveLocal('mc_access_log', log);
    pushCloud('mc_access_log', entry.lid, entry);
  }

  return {
    getVerifiedDoctors, getVerifiedPharmacists, getVerifiedNurses,
    saveVerifiedDoctors, saveVerifiedPharmacists, saveVerifiedNurses,
    isDoctorVerified, isPharmacistVerified, isNurseVerified,
    addVerifiedDoctor, addVerifiedPharmacist, addVerifiedNurse,
    removeVerifiedDoctor, removeVerifiedPharmacist, removeVerifiedNurse,
    initRegistry,
    getConsents, requestConsent, respondConsent, revokeConsent,
    hasConsent, getPatientConsents,
    canAccessPatient, isAuthorDoctor, getAuthorDoctors, logAccess, getAccessLog,
  };
})();

window.ACL = ACL;
