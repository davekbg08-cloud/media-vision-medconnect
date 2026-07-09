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
