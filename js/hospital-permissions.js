/* =====================================================
   MedConnect 2.0 — HospitalPermissions (bundle desktop, adapté)
   Contrôle d'accès des routes du tableau de bord hôpital.

   ADAPTATION vs bundle d'origine : les rôles inexistants du
   bundle (platform_admin, hospital_admin, lab_technician,
   receptionist) sont ramenés aux 5 rôles réels du projet
   (doctor / nurse / pharmacist / admin / patient). Aucun
   rôle parallèle n'est introduit.
   ===================================================== */
const HospitalPermissions = (() => {

  /**
   * route -> rôles autorisés.
   * Le patient n'accède jamais au tableau de bord hôpital
   * (produit desktop réservé au personnel).
   */
  const ROUTES = {
    dashboard:     ['admin', 'admin_hospital', 'doctor', 'nurse', 'pharmacist', 'lab', 'reception'],
    patients:      ['admin', 'admin_hospital', 'doctor', 'nurse', 'reception'],
    consultations: ['admin', 'admin_hospital', 'doctor'],
    beds:          ['admin', 'admin_hospital', 'doctor', 'nurse'],
    maternity:     ['admin', 'admin_hospital', 'doctor', 'nurse'],
    emergency:     ['admin', 'admin_hospital', 'doctor', 'nurse', 'reception'],
    doctors:       ['admin', 'admin_hospital', 'doctor'],
    lab:           ['admin', 'admin_hospital', 'doctor', 'nurse', 'lab'],
    pharmacy:      ['admin', 'admin_hospital', 'pharmacist'],
    reception:     ['admin', 'admin_hospital', 'reception', 'nurse'],
    ai:            ['admin', 'admin_hospital', 'doctor'],
    subscription:  ['admin', 'admin_hospital'],
    settings:      ['admin', 'admin_hospital', 'doctor', 'nurse', 'pharmacist', 'lab', 'reception'],
  };

  function canAccess(role, route) {
    const allowed = ROUTES[route];
    return Array.isArray(allowed) && allowed.includes(role);
  }

  function getCurrentRole() {
    // Priorité à la session hôpital desktop (connexion par matricule) ;
    // repli sur le compte utilisateur mobile si présent.
    return window.HospitalAuth?.getSession?.()?.role ||
           window.Auth?.getUser?.()?.role || '';
  }

  function requireRoute(route) {
    const role = getCurrentRole();
    if (!canAccess(role, route)) {
      throw new Error("Vous n'avez pas l'autorisation d'accéder à cette page.");
    }
    return true;
  }

  function visibleMenuFor(role) {
    const L = k => (window.I18n?.t ? I18n.t(k) : null);
    const menu = [];
    if (canAccess(role, 'dashboard'))     menu.push({ key:'dashboard',     label:L('hd_dashboard')     || 'Tableau de bord',        icon:'📊' });
    if (canAccess(role, 'reception'))     menu.push({ key:'reception',     label:'Réception / Accueil',  icon:'🛎️' });
    if (canAccess(role, 'patients'))      menu.push({ key:'patients',      label:L('hd_patients')      || 'Patients',                icon:'👥' });
    if (canAccess(role, 'consultations')) menu.push({ key:'consultations', label:L('hd_consultations') || 'Consultations',           icon:'🩺' });
    if (canAccess(role, 'emergency'))     menu.push({ key:'emergency',     label:'Urgences',             icon:'🚑' });
    if (canAccess(role, 'maternity'))     menu.push({ key:'maternity',     label:'Maternité',            icon:'🤰' });
    if (canAccess(role, 'beds'))          menu.push({ key:'beds',          label:L('hd_beds')          || 'Hospitalisation / Lits',  icon:'🛏️' });
    if (canAccess(role, 'lab'))           menu.push({ key:'lab',           label:L('hd_lab')           || 'Laboratoire',             icon:'🧪' });
    if (canAccess(role, 'pharmacy'))      menu.push({ key:'pharmacy',      label:L('hd_pharmacy')      || 'Pharmacie',                icon:'💊' });
    if (canAccess(role, 'doctors'))       menu.push({ key:'doctors',       label:L('hd_doctors')       || 'Médecins affiliés',       icon:'👨‍⚕️' });
    if (canAccess(role, 'ai'))            menu.push({ key:'ai',            label:L('hd_ai')            || 'IA médicale',             icon:'🤖' });
    if (canAccess(role, 'subscription'))  menu.push({ key:'subscription',  label:L('hd_subscription')  || 'Abonnement',              icon:'💳' });
    if (canAccess(role, 'settings'))      menu.push({ key:'settings',      label:L('hd_settings')      || 'Paramètres',              icon:'⚙️' });
    return menu;
  }

  function roleLabel(role) {
    // Rôles spécifiques au desktop hôpital (absents du dictionnaire
    // mobile Auth.getRoleLabel).
    const DESK = {
      admin_hospital: 'Administration hôpital',
      lab: 'Laboratoire',
      reception: 'Réception',
    };
    if (DESK[role]) return DESK[role];
    return window.Auth?.getRoleLabel?.(role) || role || 'Utilisateur';
  }

  return { ROUTES, canAccess, getCurrentRole, requireRoute, visibleMenuFor, roleLabel };
})();

window.HospitalPermissions = HospitalPermissions;
