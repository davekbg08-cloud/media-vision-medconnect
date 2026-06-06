/* =====================================================
   MedConnect 2.0 — Access Control Layer (ACL)
   Vérification d'identité · Rôles · Consentement
   ===================================================== */
const ACL = (() => {

  /* ── REGISTRE DES CRÉDENTIELS VÉRIFIÉS ────────────
     Géré uniquement par l'Admin.
     En production : connecté à une API des autorités.
  ──────────────────────────────────────────────────── */
  function getVerifiedDoctors()   { return JSON.parse(localStorage.getItem('mc_verified_doctors')   || '[]'); }
  function getVerifiedPharmacists(){ return JSON.parse(localStorage.getItem('mc_verified_pharms')    || '[]'); }
  function getVerifiedNurses()    { return JSON.parse(localStorage.getItem('mc_verified_nurses')     || '[]'); }
  function saveVerifiedDoctors(l)    { localStorage.setItem('mc_verified_doctors', JSON.stringify(l)); }
  function saveVerifiedPharmacists(l){ localStorage.setItem('mc_verified_pharms',  JSON.stringify(l)); }
  function saveVerifiedNurses(l)     { localStorage.setItem('mc_verified_nurses',  JSON.stringify(l)); }

  /* ── VÉRIFICATION DES CRÉDENTIELS ─────────────── */
  function isDoctorVerified(orderNum) {
    return getVerifiedDoctors().some(d => d.order_num === orderNum.trim().toUpperCase());
  }
  function isPharmacistVerified(matricule) {
    return getVerifiedPharmacists().some(p => p.matricule === matricule.trim().toUpperCase());
  }
  function isNurseVerified(matricule) {
    return getVerifiedNurses().some(n => n.matricule === matricule.trim().toUpperCase());
  }

  /* ── CONSENTEMENTS PATIENT ─────────────────────── */
  function getConsents()    { return JSON.parse(localStorage.getItem('mc_consents') || '[]'); }
  function saveConsents(l)  { localStorage.setItem('mc_consents', JSON.stringify(l)); }

  function requestConsent(patientId, doctorId, doctorName) {
    const consents = getConsents();
    const existing = consents.find(c => c.patient_id===patientId && c.doctor_id===doctorId);
    if (existing) return;
    const req = {
      cid:        `CON${Date.now()}`,
      patient_id: patientId,
      doctor_id:  doctorId,
      doctor_name:doctorName,
      status:     'pending',
      requested_at: new Date().toISOString(),
      expires_at: null,
    };
    consents.push(req);
    saveConsents(consents);
    // Notify patient via message
    const msgs = DB.getMessages();
    msgs.push({
      mid:     `N${Date.now()}`,
      to_role: 'patient',
      to_id:   patientId,
      type:    'consent_request',
      subject: `🔐 Demande d'accès — Dr. ${doctorName}`,
      body:    `Le Dr. ${doctorName} demande à accéder à votre dossier médical complet.\n\nVous pouvez approuver ou refuser dans la section "Confidentialité" de votre espace.`,
      from:    doctorName,
      date:    new Date().toISOString().slice(0,10),
      read:    false,
      consent_id: req.cid,
    });
    DB.saveMessages(msgs);
    return req;
  }

  function respondConsent(cid, approved) {
    const consents = getConsents();
    const idx = consents.findIndex(c => c.cid === cid);
    if (idx === -1) return;
    consents[idx].status     = approved ? 'approved' : 'denied';
    consents[idx].decided_at = new Date().toISOString();
    if (approved) {
      // 30 jours par défaut
      const exp = new Date(Date.now() + 30*24*3600*1000);
      consents[idx].expires_at = exp.toISOString().slice(0,10);
    }
    saveConsents(consents);
    logAccess(consents[idx].patient_id, consents[idx].doctor_id, approved ? 'consent_approved' : 'consent_denied');
  }

  function revokeConsent(cid) {
    const consents = getConsents();
    const idx = consents.findIndex(c => c.cid === cid);
    if (idx !== -1) {
      consents[idx].status     = 'revoked';
      consents[idx].revoked_at = new Date().toISOString();
      saveConsents(consents);
    }
  }

  function hasConsent(patientId, doctorId) {
    const today = new Date().toISOString().slice(0,10);
    return getConsents().some(c =>
      c.patient_id === patientId &&
      c.doctor_id  === doctorId  &&
      c.status     === 'approved' &&
      (!c.expires_at || c.expires_at >= today)
    );
  }

  function getPatientConsents(patientId) {
    return getConsents().filter(c => c.patient_id === patientId);
  }

  function getDoctorPatients(doctorId) {
    // Patients créés par ce médecin OU ayant consenti
    const created  = DB.getPatients().filter(p => p.created_by === doctorId);
    const consented= DB.getPatients().filter(p =>
      getConsents().some(c => c.patient_id===p.id && c.doctor_id===doctorId && c.status==='approved')
    );
    const ids = new Set([...created.map(p=>p.id), ...consented.map(p=>p.id)]);
    return DB.getPatients().filter(p => ids.has(p.id));
  }

  /* ── VÉRIFICATION D'ACCÈS ──────────────────────── */
  function canAccessPatient(user, patientId) {
    if (!user) return false;
    switch (user.role) {
      case 'patient':
        return localStorage.getItem('mc_my_patient_id') === patientId;
      case 'doctor':
      case 'nurse': {
        const p = DB.getPatientById(patientId);
        return p && (p.created_by === user.uid || hasConsent(patientId, user.uid));
      }
      case 'admin':
        return true;
      case 'pharmacist':
        return false; // pharmacien voit seulement ordonnances envoyées, pas dossier complet
      default:
        return false;
    }
  }

  function canViewMedicalHistory(user, patientId) {
    if (user.role === 'pharmacist') return false;
    return canAccessPatient(user, patientId);
  }

  /* ── JOURNAL D'ACCÈS ───────────────────────────── */
  function getAccessLog()   { return JSON.parse(localStorage.getItem('mc_access_log') || '[]'); }

  function logAccess(patientId, userId, action) {
    const log = getAccessLog();
    log.push({
      lid:       `L${Date.now()}`,
      patient_id: patientId,
      user_id:    userId,
      action,
      timestamp:  new Date().toISOString(),
    });
    // Garder seulement les 500 derniers logs
    if (log.length > 500) log.splice(0, log.length - 500);
    localStorage.setItem('mc_access_log', JSON.stringify(log));
  }

  /* ── ADMIN : GESTION DES REGISTRES ────────────── */
  function addVerifiedDoctor(data) {
    const list = getVerifiedDoctors();
    if (list.find(d => d.order_num === data.order_num)) return false;
    list.push({ ...data, order_num: data.order_num.toUpperCase(), added_at: new Date().toISOString() });
    saveVerifiedDoctors(list);
    return true;
  }

  function addVerifiedPharmacist(data) {
    const list = getVerifiedPharmacists();
    if (list.find(p => p.matricule === data.matricule)) return false;
    list.push({ ...data, matricule: data.matricule.toUpperCase(), added_at: new Date().toISOString() });
    saveVerifiedPharmacists(list);
    return true;
  }

  function removeVerifiedDoctor(order_num) {
    saveVerifiedDoctors(getVerifiedDoctors().filter(d => d.order_num !== order_num));
  }
  function removeVerifiedPharmacist(matricule) {
    saveVerifiedPharmacists(getVerifiedPharmacists().filter(p => p.matricule !== matricule));
  }

  /* ── INITIALISATION (données démo) ─────────────── */
  function initDemoRegistry() {
    if (getVerifiedDoctors().length > 0) return; // déjà initialisé

    // Médecins vérifiés démo
    saveVerifiedDoctors([
      { order_num:'OM-CD-2024-0042', name:'Dr. Amina Koné',     specialty:'Médecine générale',  hospital:'CHU Kinshasa',     country:'CD' },
      { order_num:'OM-CD-2024-0117', name:'Dr. Jean Kabila',    specialty:'Cardiologie',         hospital:'Clinique Ngaliema',country:'CD' },
      { order_num:'OM-SN-2023-0089', name:'Dr. Fatou Diallo',   specialty:'Pédiatrie',           hospital:'Hôpital Fann',     country:'SN' },
      { order_num:'OM-CI-2024-0203', name:'Dr. Kofi Mensah',    specialty:'Chirurgie',           hospital:'CHU Abidjan',      country:'CI' },
      { order_num:'OM-CM-2024-0055', name:'Dr. Marie Biya',     specialty:'Gynécologie',         hospital:'Hôpital Central',  country:'CM' },
      { order_num:'OM-FR-2024-1234', name:'Dr. Pierre Martin',  specialty:'Médecine interne',    hospital:'Hôpital Lariboisière',country:'FR'},
    ]);

    // Pharmaciens vérifiés démo
    saveVerifiedPharmacists([
      { matricule:'PH-CD-2024-0015', name:'Jean-Claude Mutombo', pharmacy:'Pharmacie Centrale Kinshasa',   country:'CD' },
      { matricule:'PH-CD-2024-0032', name:'Sylvie Ngoma',        pharmacy:'Pharmacie du Marché',           country:'CD' },
      { matricule:'PH-SN-2023-0077', name:'Omar Sow',            pharmacy:'Pharmacie de Dakar',            country:'SN' },
      { matricule:'PH-FR-2024-0891', name:'Claire Dupont',       pharmacy:'Pharmacie de Paris',            country:'FR' },
    ]);

    // Infirmiers vérifiés démo
    saveVerifiedNurses([
      { matricule:'INF-CD-2024-0089', name:'Sophie Mbeki',   hospital:'CHU Kinshasa', country:'CD' },
      { matricule:'INF-CM-2024-0034', name:'Paul Essomba',   hospital:'Hôp. Central', country:'CM' },
    ]);
  }

  return {
    // Registre
    getVerifiedDoctors, getVerifiedPharmacists, getVerifiedNurses,
    isDoctorVerified, isPharmacistVerified, isNurseVerified,
    addVerifiedDoctor, addVerifiedPharmacist, removeVerifiedDoctor, removeVerifiedPharmacist,
    // Consentement
    requestConsent, respondConsent, revokeConsent, hasConsent,
    getPatientConsents, getDoctorPatients,
    // Accès
    canAccessPatient, canViewMedicalHistory,
    // Log
    logAccess, getAccessLog,
    // Init
    initDemoRegistry,
  };
})();

window.ACL = ACL;
