/* =====================================================
   Tests — Dossier médical électronique (MedicalRecordDesktop)

   Deux familles de tests :
   1. Isolation stricte par établissement (HospitalsRegistry/DB) —
      un hôpital ne doit JAMAIS voir les patients d'un autre.
   2. Visibilité des onglets par rôle (HospitalCapabilities) —
      un rôle non clinique (réception, laboratoire) ne doit voir
      que ce que son métier autorise.
   Une régression ici serait une fuite de données médicales
   entre établissements ou un accès non autorisé à un dossier.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadIntoWindow, makeMemoryStorage } = require('./helper');

/* db.js référence firebaseReady/firebaseDB en globales BARE (sans
   typeof guard) : il faut les prédéclarer dans le contexte, sinon
   toute écriture (_push) lève une ReferenceError asynchrone une
   fois Firestore indisponible simulé (voir tests/outbox.test.js
   pour le même besoin). On les fixe à indisponible : ces tests ne
   portent que sur la lecture/filtrage local. */
function loadDBAndRegistry() {
  const storage = makeMemoryStorage();
  const sessionStorage = makeMemoryStorage();
  const sandbox = {
    console,
    localStorage: storage,
    sessionStorage,
    window: { addEventListener: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    crypto: globalThis.crypto,
    firebaseReady: false,
    firebaseDB: null,
    Date, JSON,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/hospitals_registry.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { DB: sandbox.window.DB, Registry: sandbox.window.HospitalsRegistry, win: { sessionStorage } };
}

test('Hôpital A ne voit pas les dossiers de l\'Hôpital B', () => {
  const { DB, Registry } = loadDBAndRegistry();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  Registry.addHospital({ establishmentId: 'HOSP_B', name: 'Clinique B' });

  const pa = DB.addPatient({ firstname: 'Alice', lastname: 'A', country_code: 'CD', establishmentId: 'HOSP_A' });
  const pb = DB.addPatient({ firstname: 'Bob', lastname: 'B', country_code: 'CD', establishmentId: 'HOSP_B' });

  const listA = Registry.getPatientsForEstablishment('HOSP_A');
  const listB = Registry.getPatientsForEstablishment('HOSP_B');

  assert.ok(listA.some(p => p.id === pa.id), 'le patient A doit apparaître pour HOSP_A');
  assert.ok(!listA.some(p => p.id === pb.id), 'le patient B ne doit JAMAIS apparaître pour HOSP_A');
  assert.ok(listB.some(p => p.id === pb.id), 'le patient B doit apparaître pour HOSP_B');
  assert.ok(!listB.some(p => p.id === pa.id), 'le patient A ne doit JAMAIS apparaître pour HOSP_B');
});

test('un patient rattaché via hospital_id (ancien champ) reste isolé par établissement', () => {
  const { DB, Registry } = loadDBAndRegistry();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  Registry.addHospital({ establishmentId: 'HOSP_B', name: 'Clinique B' });
  const p = DB.addPatient({ firstname: 'Old', lastname: 'Field', country_code: 'CD', hospital_id: 'HOSP_A' });

  assert.ok(Registry.getPatientsForEstablishment('HOSP_A').some(x => x.id === p.id));
  assert.ok(!Registry.getPatientsForEstablishment('HOSP_B').some(x => x.id === p.id));
});

test('getCurrentHospital() reflète l\'établissement actif en session, et rien sans sélection', () => {
  const { Registry, win } = loadDBAndRegistry();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });

  assert.strictEqual(Registry.getCurrentHospital(), null, 'aucun établissement actif par défaut');

  win.sessionStorage.setItem('mc_current_hospital', 'HOSP_A');
  assert.strictEqual(Registry.getCurrentHospital()?.establishmentId, 'HOSP_A');
});

test('un membre du staff actif d\'un hôpital voit les patients qu\'il a créés pour cet hôpital, jamais pour l\'autre', () => {
  const { DB, Registry } = loadDBAndRegistry();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A', staff: [{ uid: 'doc1', status: 'active' }] });
  Registry.addHospital({ establishmentId: 'HOSP_B', name: 'Clinique B', staff: [{ uid: 'doc2', status: 'active' }] });

  // Patient créé par doc1 sans establishmentId explicite (cas réel :
  // import / création rapide) : doit rester rattaché à HOSP_A via le
  // staff actif, jamais visible depuis HOSP_B.
  const p = DB.addPatient({ firstname: 'X', lastname: 'Y', country_code: 'CD', created_by: 'doc1' });

  assert.ok(Registry.getPatientsForEstablishment('HOSP_A').some(x => x.id === p.id));
  assert.ok(!Registry.getPatientsForEstablishment('HOSP_B').some(x => x.id === p.id));
});

test('DB.getPatientAppointments ne retourne que les RDV du patient demandé, triés du plus récent au plus ancien', () => {
  const { DB } = loadDBAndRegistry();
  const p1 = DB.addPatient({ firstname: 'P1', lastname: 'X', country_code: 'CD' });
  const p2 = DB.addPatient({ firstname: 'P2', lastname: 'X', country_code: 'CD' });
  DB.addAppointment({ patient_id: p1.id, date: '2026-01-01', reason: 'Ancien' });
  DB.addAppointment({ patient_id: p1.id, date: '2026-06-01', reason: 'Récent' });
  DB.addAppointment({ patient_id: p2.id, date: '2026-05-01', reason: 'Autre patient' });

  const list = DB.getPatientAppointments(p1.id);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].reason, 'Récent', 'le plus récent doit être en premier');
});

test('DB.getPatientEstablishmentDocuments filtre par patient (patientUid) et par catégorie', () => {
  const { DB } = loadDBAndRegistry();
  const p1 = DB.addPatient({ firstname: 'P1', lastname: 'X', country_code: 'CD' });
  DB.addEstablishmentDocument({ patientUid: p1.id, documentType: 'imaging', documentTitle: 'Radio thorax' });
  DB.addEstablishmentDocument({ patientUid: p1.id, documentType: 'consultation', documentTitle: 'Consultation' });
  DB.addEstablishmentDocument({ patientUid: 'AUTRE_PATIENT', documentType: 'imaging', documentTitle: 'Ne doit pas apparaître' });

  const all = DB.getPatientEstablishmentDocuments(p1.id);
  assert.strictEqual(all.length, 2);
  const imaging = DB.getPatientEstablishmentDocuments(p1.id, 'imaging');
  assert.strictEqual(imaging.length, 1);
  assert.strictEqual(imaging[0].documentTitle, 'Radio thorax');
});

/* ── Visibilité des onglets du dossier par rôle ── */
// Array.from() : les tableaux produits par le contexte vm ne sont pas
// deepStrictEqual-compatibles avec des tableaux littéraux du contexte
// de test (prototypes de deux réalms différents) — on les rematérialise.
test('réception ne voit que le résumé (informations administratives)', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  assert.deepStrictEqual(Array.from(win.HospitalCapabilities.visibleRecordSections('reception')), ['summary']);
});

test('laboratoire ne voit que le résumé et les analyses', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  const sections = Array.from(win.HospitalCapabilities.visibleRecordSections('lab')).sort();
  assert.deepStrictEqual(sections, ['lab', 'summary']);
});

test('pharmacie ne voit que le résumé et les ordonnances', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  const sections = Array.from(win.HospitalCapabilities.visibleRecordSections('pharmacist')).sort();
  assert.deepStrictEqual(sections, ['prescriptions', 'summary']);
});

test('médecin et administration d\'établissement voient tous les onglets, y compris l\'historique des accès', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  for (const role of ['doctor', 'admin_hospital', 'admin']) {
    assert.ok(win.HospitalCapabilities.visibleRecordSections(role).includes('access_log'), `${role} doit voir l'historique des accès`);
  }
});

test('infirmier voit le dossier clinique mais pas l\'historique des accès', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  const sections = win.HospitalCapabilities.visibleRecordSections('nurse');
  assert.ok(sections.includes('consultations'));
  assert.ok(!sections.includes('access_log'));
});

/* ── Garde structurelle (lecture du source) ──
   Empêche une régression qui ferait lire DB.getPatients() sans
   filtre établissement pour peupler la liste du dossier médical. */
test('MedicalRecordDesktop ne construit jamais sa liste patients avec DB.getPatients() non filtré', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/medical-record-desktop.js'), 'utf8');
  assert.match(src, /getPatientsForEstablishment/, 'doit utiliser la liste scopée établissement');
  assert.doesNotMatch(src, /DB\.getPatients\(\)/, 'ne doit jamais lire tous les patients sans filtre');
  assert.match(src, /Veuillez sélectionner un établissement/, 'doit bloquer l\'affichage sans établissement actif');
});

test('la route "records" est bien déclarée dans HospitalPermissions et HospitalDesktopUI', () => {
  const perms = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-permissions.js'), 'utf8');
  assert.match(perms, /records:\s*\[/, 'ROUTES.records doit exister');
  const ui = fs.readFileSync(path.resolve(__dirname, '..', 'js/hospital-desktop-ui.js'), 'utf8');
  assert.match(ui, /records:\s*\(c\)\s*=>\s*window\.MedicalRecordDesktop/, 'la route doit être branchée sur MedicalRecordDesktop');
});

/* =====================================================
   Tests d'intégration — MedicalRecordDesktop chargé pour de vrai
   (db.js + hospitals_registry.js + hospital-capabilities.js +
   hospital-permissions.js + medical-record-desktop.js dans le
   même contexte). Permet de tester la recherche, l'assemblage
   du dossier complet et le filtrage par rôle SANS DOM réel, en
   appelant directement les fonctions exposées par le module.
   ===================================================== */
function loadIntegration() {
  const storage = makeMemoryStorage();
  const sessionStorage = makeMemoryStorage();
  const sandbox = {
    console,
    localStorage: storage,
    sessionStorage,
    window: { addEventListener: () => {} },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    crypto: globalThis.crypto,
    firebaseReady: false,
    firebaseDB: null,
    // CloudDB (Firestore) n'est pas rechargé ici : stub minimal, les
    // tests d'isolation établissement portent sur DB/HospitalsRegistry
    // (source de vérité locale synchronisée depuis Firebase).
    CloudDB: {
      createAuditLog: async () => null,
      listByHospital: async () => [],
      listAuditLogForTarget: async () => [],
    },
    Date, JSON,
  };
  vm.createContext(sandbox);
  for (const f of ['js/db.js', 'js/hospitals_registry.js', 'js/hospital-capabilities.js', 'js/hospital-permissions.js', 'js/medical-record-desktop.js']) {
    const code = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return {
    DB: sandbox.window.DB,
    Registry: sandbox.window.HospitalsRegistry,
    MRD: sandbox.window.MedicalRecordDesktop,
    setRole(role) { sandbox.window.HospitalAuth = { getSession: () => ({ role }) }; },
    setHospital(id) { sessionStorage.setItem('mc_current_hospital', id); },
  };
}

test('[intégration] recherche patient : ne trouve que dans l\'établissement actif, par nom/prénom/téléphone/n° dossier', () => {
  const { DB, Registry, MRD, setHospital } = loadIntegration();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  Registry.addHospital({ establishmentId: 'HOSP_B', name: 'Clinique B' });
  const alice = DB.addPatient({ firstname: 'Alice', lastname: 'Nkulu', phone: '+243800000001', country_code: 'CD', establishmentId: 'HOSP_A' });
  DB.addPatient({ firstname: 'Bob', lastname: 'Mbala', phone: '+243800000002', country_code: 'CD', establishmentId: 'HOSP_A' });
  DB.addPatient({ firstname: 'Alice', lastname: 'AutreHopital', phone: '+243800000003', country_code: 'CD', establishmentId: 'HOSP_B' });

  setHospital('HOSP_A');
  MRD.filter('alice'); // recherche par prénom
  let results = MRD.patientsForList();
  assert.strictEqual(results.length, 1, 'ne doit trouver que la patiente Alice de HOSP_A');
  assert.strictEqual(results[0].id, alice.id);

  MRD.filter(alice.id); // recherche par numéro de dossier (code patient)
  assert.strictEqual(MRD.patientsForList().length, 1);

  MRD.filter('+243800000001'); // recherche par téléphone
  assert.strictEqual(MRD.patientsForList().length, 1);

  MRD.filter('mbala'); // recherche par nom de famille
  assert.strictEqual(MRD.patientsForList()[0].lastname, 'Mbala');

  MRD.filter(''); // vide = tous les patients de l'établissement actif
  assert.strictEqual(MRD.patientsForList().length, 2, 'HOSP_A a 2 patients, jamais celui de HOSP_B');
});

test('[intégration] ouverture d\'un dossier complet : identité, consultations, ordonnances, analyses, vaccinations, documents', () => {
  const { DB, Registry, MRD, setHospital } = loadIntegration();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  const p = DB.addPatient({ firstname: 'Alice', lastname: 'Nkulu', dob: '1990-01-01', country_code: 'CD', establishmentId: 'HOSP_A' });
  DB.addConsultation({ patient_id: p.id, date: '2026-01-01', doctor: 'Dr House', diagnosis: 'Grippe', reason: 'Fièvre' });
  DB.addPrescription({ patient_id: p.id, date: '2026-01-01', doctor: 'Dr House', medicines: [{ name: 'Paracétamol', dosage: '500mg' }] });
  DB.addLabResult({ patient_id: p.id, date: '2026-01-02', type: 'Glycémie', value: '0.95 g/L' });
  DB.addVaccination({ patient_id: p.id, date: '2026-01-03', vaccine: 'Tétanos' });
  DB.addEstablishmentDocument({ patientUid: p.id, documentType: 'consultation', documentTitle: 'Compte-rendu' });

  setHospital('HOSP_A');
  const record = MRD.loadRecord(p.id);

  assert.strictEqual(record.patient.id, p.id, 'identité patient chargée');
  assert.strictEqual(record.consultations.length, 1);
  assert.strictEqual(record.prescriptions.length, 1);
  assert.strictEqual(record.labs.length, 1);
  assert.strictEqual(record.vaccinations.length, 1);
  assert.strictEqual(record.documents.length, 1);

  // Le dossier complet doit rester ouvrable sans lever d'exception
  // (même sans DOM réel dans ce test).
  assert.doesNotThrow(() => MRD.open(p.id));
});

test('[intégration] consultations, ordonnances et analyses sont bien rendues dans le contenu affiché', () => {
  const { DB, Registry, MRD, setHospital } = loadIntegration();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  const p = DB.addPatient({ firstname: 'Alice', lastname: 'Nkulu', country_code: 'CD', establishmentId: 'HOSP_A' });
  DB.addConsultation({ patient_id: p.id, date: '2026-01-01', doctor: 'Dr House', diagnosis: 'Paludisme sévère' });
  DB.addPrescription({ patient_id: p.id, date: '2026-01-01', doctor: 'Dr House', medicines: [{ name: 'Artésunate', dosage: '120mg' }] });
  DB.addLabResult({ patient_id: p.id, date: '2026-01-02', type: 'Goutte épaisse', value: 'Positif' });

  setHospital('HOSP_A');
  const record = MRD.loadRecord(p.id);

  assert.match(MRD.renderConsultations(record), /Paludisme sévère/, 'la consultation doit être visible');
  assert.match(MRD.renderPrescriptions(record.prescriptions), /Artésunate/, 'l\'ordonnance doit être visible');
  assert.match(MRD.renderLab(record.labs), /Goutte épaisse/, 'l\'analyse doit être visible');
});

test('[intégration] réception ne voit pas les données médicales sensibles dans le résumé', () => {
  const { DB, Registry, MRD, setHospital } = loadIntegration();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  const p = DB.addPatient({
    firstname: 'Alice', lastname: 'Nkulu', phone: '+243800000001', country_code: 'CD',
    establishmentId: 'HOSP_A', blood_type: 'O+', allergies: 'Pénicilline', chronic: 'Diabète',
  });
  setHospital('HOSP_A');

  const receptionView = MRD.renderSummary(p, 'reception');
  assert.match(receptionView, /Alice/, 'la réception doit voir l\'identité');
  assert.match(receptionView, /\+243800000001/, 'la réception doit voir le contact');
  assert.doesNotMatch(receptionView, /Pénicilline/, 'la réception NE DOIT PAS voir les allergies');
  assert.doesNotMatch(receptionView, /Diabète/, 'la réception NE DOIT PAS voir les maladies chroniques');
  assert.doesNotMatch(receptionView, /O\+/, 'la réception NE DOIT PAS voir le groupe sanguin');

  const doctorView = MRD.renderSummary(p, 'doctor');
  assert.match(doctorView, /Pénicilline/, 'le médecin doit voir les allergies');
});

test('[intégration] laboratoire ne voit pas l\'onglet ordonnances, pharmacie ne voit pas l\'onglet analyses', () => {
  const win = loadIntoWindow(['js/hospital-capabilities.js']);
  const labSections = win.HospitalCapabilities.visibleRecordSections('lab');
  const pharmSections = win.HospitalCapabilities.visibleRecordSections('pharmacist');
  assert.ok(!labSections.includes('prescriptions'), 'le laboratoire ne doit pas avoir accès aux ordonnances');
  assert.ok(!pharmSections.includes('lab'), 'la pharmacie ne doit pas avoir accès aux analyses');
});

test('[intégration] sans établissement actif, aucun dossier n\'est listé', () => {
  const { DB, Registry, MRD } = loadIntegration();
  Registry.addHospital({ establishmentId: 'HOSP_A', name: 'Clinique A' });
  DB.addPatient({ firstname: 'Alice', lastname: 'Nkulu', country_code: 'CD', establishmentId: 'HOSP_A' });
  // Aucun setHospital(...) appelé : pas d'établissement actif en session.
  assert.strictEqual(MRD.establishmentPatients().length, 0);
});
