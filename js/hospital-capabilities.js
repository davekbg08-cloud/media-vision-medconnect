/* =====================================================
   MedConnect 2.0 — HospitalCapabilities
   Matrice CENTRALE des capacités par rôle (desktop).

   Principe : le niveau d'accès ne se choisit pas, il découle du
   rôle VÉRIFIÉ de l'agent (lié à son numéro d'ordre / matricule
   dans le staff de l'établissement). Un laborantin n'a pas le
   même niveau qu'un médecin : il ne peut pas décider d'un
   transfert médical, ni valider une consultation, etc.

   Une « capacité » est une action sensible. Toute action
   sensible DOIT passer par can(action) avant d'être exécutée,
   côté UI (masquer/désactiver) ET au moment de l'action
   (refuser si non autorisé). L'affichage seul ne suffit pas.
   ===================================================== */
const HospitalCapabilities = (() => {

  // Capacités reconnues (actions sensibles du desktop).
  const CAPS = {
    // Décisions médicales
    create_consultation:   'Créer / valider une consultation',
    prescribe:             'Rédiger une ordonnance',
    decide_transfer:       'Décider un transfert médical',
    accept_transfer:       'Accepter un transfert entrant',
    admit_patient:         'Admettre / hospitaliser un patient',
    discharge_patient:     'Prononcer une sortie',
    // Laboratoire
    request_lab:           'Demander une analyse',
    enter_lab_result:      'Saisir un résultat d\'analyse',
    // Pharmacie
    dispense:              'Délivrer un médicament',
    // Dossier
    create_patient:        'Créer un dossier patient',
    edit_patient:          'Modifier un dossier patient',
    view_patient:          'Consulter un dossier patient',
    share_record:          'Partager un dossier',
    // Administration établissement
    manage_staff:          'Gérer le personnel',
    manage_subscription:   'Gérer l\'abonnement',
    manage_beds:           'Gérer les lits',
  };

  /* Matrice rôle → capacités. Volontairement explicite (pas de
     "tout par défaut") : ajouter une capacité à un rôle est une
     décision consciente. */
  const MATRIX = {
    admin_hospital: [
      'view_patient','create_patient','edit_patient','share_record',
      'admit_patient','discharge_patient','accept_transfer','manage_beds',
      'manage_staff','manage_subscription','request_lab',
    ],
    doctor: [
      'view_patient','create_patient','edit_patient',
      'create_consultation','prescribe',
      'decide_transfer','accept_transfer','share_record',
      'admit_patient','discharge_patient','request_lab',
    ],
    nurse: [
      'view_patient','edit_patient',
      'admit_patient','discharge_patient',
      'request_lab','manage_beds',
      // PAS de decide_transfer, PAS de prescribe : l'infirmier
      // exécute des soins, il ne décide pas d'un transfert médical
      // ni ne prescrit.
    ],
    lab: [
      'view_patient',          // lecture pour identifier le patient
      'enter_lab_result',
      // Un laborantin : saisit des résultats. Il ne consulte pas,
      // ne prescrit pas, ne transfère pas, n'admet pas.
    ],
    reception: [
      'view_patient','create_patient',
      // La réception enregistre et oriente. Aucune décision médicale.
    ],
    pharmacist: [
      'view_patient','dispense',
      // La pharmacie délivre. Pas de décision médicale.
    ],
    // Rôles mobiles historiques : mappés au plus proche pour
    // compatibilité si jamais présents côté desktop.
    admin: null, // admin plateforme = tout (voir can())
  };

  function can(role, action) {
    if (!role || !action) return false;
    if (role === 'admin') return true;          // admin plateforme
    const caps = MATRIX[role];
    if (!Array.isArray(caps)) return false;
    return caps.includes(action);
  }

  function capabilitiesOf(role) {
    if (role === 'admin') return Object.keys(CAPS);
    return Array.isArray(MATRIX[role]) ? MATRIX[role].slice() : [];
  }

  function label(action) { return CAPS[action] || action; }

  /* Niveau d'accès lisible, dérivé du rôle (affichage topbar). */
  function accessLevel(role) {
    return ({
      admin_hospital: 'Accès complet établissement',
      doctor:         'Accès clinique complet',
      nurse:          'Accès soins (sans décision médicale)',
      lab:            'Accès laboratoire uniquement',
      reception:      'Accès accueil / enregistrement',
      pharmacist:     'Accès pharmacie / dispensation',
      admin:          'Accès plateforme',
    })[role] || 'Accès limité';
  }

  /* Garde pratique : exécute l'action seulement si autorisée,
     sinon avertit et retourne false. À appeler AVANT toute action
     sensible. */
  function require(role, action) {
    if (can(role, action)) return true;
    window.App?.toast?.(`⛔ Votre rôle (${label ? role : role}) ne permet pas cette action : ${label(action)}.`, 'error');
    return false;
  }

  /* Garde d'action sensible pour le DESKTOP hôpital uniquement.
     En session hôpital (connexion par matricule), vérifie que le
     rôle vérifié a la capacité. Hors de cette session (mobile,
     praticien solo), ne bloque rien — le contrôle d'accès mobile
     reste géré par l'ACL patient/consentement existante. */
  function guardHospitalAction(action) {
    const session = window.HospitalAuth?.getSession?.();
    if (!session) return true; // pas une session hôpital desktop
    return window.HospitalCapabilities?.require?.(session.role, action) ?? true;
  }

  return { can, capabilitiesOf, label, accessLevel, require, guardHospitalAction, CAPS };
})();

window.HospitalCapabilities = HospitalCapabilities;
