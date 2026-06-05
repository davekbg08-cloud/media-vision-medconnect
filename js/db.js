// ========== MedConnect — IndexedDB Database Layer ==========

const DB_NAME = 'MedConnectDB';
const DB_VERSION = 1;

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      // Patients store
      if (!database.objectStoreNames.contains('patients')) {
        const ps = database.createObjectStore('patients', { keyPath: 'id', autoIncrement: true });
        ps.createIndex('nom', 'nom', { unique: false });
        ps.createIndex('prenom', 'prenom', { unique: false });
        ps.createIndex('telephone', 'telephone', { unique: false });
      }

      // Consultations store
      if (!database.objectStoreNames.contains('consultations')) {
        const cs = database.createObjectStore('consultations', { keyPath: 'id', autoIncrement: true });
        cs.createIndex('patientId', 'patientId', { unique: false });
        cs.createIndex('date', 'date', { unique: false });
      }

      // Medications / Products store
      if (!database.objectStoreNames.contains('products')) {
        const ms = database.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        ms.createIndex('nom', 'nom', { unique: false });
        ms.createIndex('categorie', 'categorie', { unique: false });
      }

      // Sales store
      if (!database.objectStoreNames.contains('sales')) {
        const ss = database.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        ss.createIndex('date', 'date', { unique: false });
      }

      // Appointments store
      if (!database.objectStoreNames.contains('appointments')) {
        const as = database.createObjectStore('appointments', { keyPath: 'id', autoIncrement: true });
        as.createIndex('patientId', 'patientId', { unique: false });
        as.createIndex('date', 'date', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

// Generic CRUD operations
async function dbAdd(storeName, data) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.add({ ...data, createdAt: new Date().toISOString() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbUpdate(storeName, data) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(storeName, id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(storeName, id) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetByIndex(storeName, indexName, value) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const req = index.getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbCount(storeName) {
  const database = await openDB();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Seed demo data
async function seedDemoData() {
  // Demo patients
  const demoPatients = [
    { identiteNumero: 'MC-PAT-0001', nom: 'Dupont', prenom: 'Marie', dateNaissance: '1985-03-15', sexe: 'F', telephone: '+243 999 123 456', email: 'marie.dupont@email.com', adresse: '12 Rue de la Paix, Kinshasa', groupeSanguin: 'A+', allergies: 'Pénicilline', maladiesChroniques: 'Asthme', contactUrgence: 'Jean Dupont - +243 999 789 012', notes: '' },
    { identiteNumero: 'MC-PAT-0002', nom: 'Kabongo', prenom: 'Patrick', dateNaissance: '1990-07-22', sexe: 'M', telephone: '+243 998 456 789', email: 'p.kabongo@email.com', adresse: '45 Avenue Lumumba, Lubumbashi', groupeSanguin: 'O+', allergies: 'Aucune', maladiesChroniques: 'Diabète type 2', contactUrgence: 'Sarah Kabongo - +243 997 321 654', notes: '' },
    { identiteNumero: 'MC-PAT-0003', nom: 'Mbeki', prenom: 'Amina', dateNaissance: '1978-11-08', sexe: 'F', telephone: '+243 997 654 321', email: 'amina.m@email.com', adresse: '8 Boulevard du 30 Juin, Kinshasa', groupeSanguin: 'B-', allergies: 'Sulfamides, Aspirine', maladiesChroniques: 'Hypertension', contactUrgence: 'Ahmed Mbeki - +243 996 111 222', notes: 'Patiente suivie depuis 2020' },
    { identiteNumero: 'MC-PAT-0004', nom: 'Lukaku', prenom: 'David', dateNaissance: '1995-01-30', sexe: 'M', telephone: '+243 996 987 654', email: 'david.l@email.com', adresse: '23 Rue Kasai, Mbuji-Mayi', groupeSanguin: 'AB+', allergies: 'Aucune', maladiesChroniques: 'Aucune', contactUrgence: 'Rose Lukaku - +243 995 444 555', notes: '' },
  ];

  let patients = await dbGetAll('patients');
  const seedVersion = localStorage.getItem('medconnect_demo_seed_version');
  const shouldRunSeedMigration = patients.length === 0 || seedVersion !== '2';

  if (shouldRunSeedMigration) {
    for (const demoPatient of demoPatients) {
      const existing = patients.find(p =>
        p.identiteNumero === demoPatient.identiteNumero ||
        (!p.identiteNumero && p.nom === demoPatient.nom && p.prenom === demoPatient.prenom)
      );

      if (existing) {
        if (!existing.identiteNumero) {
          await dbUpdate('patients', { ...existing, identiteNumero: demoPatient.identiteNumero });
        }
      } else {
        await dbAdd('patients', demoPatient);
      }
    }
    localStorage.setItem('medconnect_demo_seed_version', '2');
  }

  patients = await dbGetAll('patients');
  const patientIdBySerial = Object.fromEntries(demoPatients.map((demoPatient) => {
    const patient = patients.find(p =>
      p.identiteNumero === demoPatient.identiteNumero ||
      (p.nom === demoPatient.nom && p.prenom === demoPatient.prenom)
    );
    return [demoPatient.identiteNumero, patient?.id];
  }));

  // Demo consultations
  const consultationCount = await dbCount('consultations');
  if (consultationCount === 0) {
    const consultations = [
      { patientId: patientIdBySerial['MC-PAT-0001'], date: '2026-05-15', docteur: 'Dr. Mukendi', diagnostic: 'Crise d\'asthme modérée', traitement: 'Ventoline 100µg - 2 bouffées x3/jour', notes: 'Contrôle dans 2 semaines', statut: 'terminé' },
      { patientId: patientIdBySerial['MC-PAT-0001'], date: '2026-04-20', docteur: 'Dr. Ngoy', diagnostic: 'Contrôle de routine', traitement: 'Maintien traitement habituel', notes: 'Résultats satisfaisants', statut: 'terminé' },
      { patientId: patientIdBySerial['MC-PAT-0002'], date: '2026-05-18', docteur: 'Dr. Mukendi', diagnostic: 'Contrôle glycémie', traitement: 'Metformine 500mg - 2x/jour', notes: 'HbA1c à 7.2%, amélioration', statut: 'terminé' },
      { patientId: patientIdBySerial['MC-PAT-0003'], date: '2026-05-19', docteur: 'Dr. Kasongo', diagnostic: 'Suivi hypertension', traitement: 'Amlodipine 5mg - 1x/jour', notes: 'TA: 140/85, ajuster dosage', statut: 'en cours' },
    ].filter(c => c.patientId);

    for (const c of consultations) await dbAdd('consultations', c);
  }

  // Demo products
  const productCount = await dbCount('products');
  if (productCount === 0) {
    const products = [
      { nom: 'Paracétamol 500mg', categorie: 'Antalgique', prix: 2500, stock: 150, emoji: '💊', dateExpiration: '2027-06-15' },
      { nom: 'Amoxicilline 500mg', categorie: 'Antibiotique', prix: 4500, stock: 80, emoji: '💊', dateExpiration: '2027-03-20' },
      { nom: 'Ibuprofène 400mg', categorie: 'Anti-inflammatoire', prix: 3000, stock: 120, emoji: '💊', dateExpiration: '2027-08-10' },
      { nom: 'Ventoline 100µg', categorie: 'Bronchodilatateur', prix: 12000, stock: 25, emoji: '🫁', dateExpiration: '2027-01-30' },
      { nom: 'Metformine 500mg', categorie: 'Antidiabétique', prix: 5500, stock: 60, emoji: '💉', dateExpiration: '2027-05-22' },
      { nom: 'Amlodipine 5mg', categorie: 'Antihypertenseur', prix: 4000, stock: 90, emoji: '❤️', dateExpiration: '2027-04-18' },
      { nom: 'Oméprazole 20mg', categorie: 'Antiulcéreux', prix: 3500, stock: 100, emoji: '💊', dateExpiration: '2027-07-05' },
      { nom: 'Vitamine C 1000mg', categorie: 'Vitamines', prix: 2000, stock: 200, emoji: '🍊', dateExpiration: '2027-12-31' },
      { nom: 'Sérum physiologique', categorie: 'Solution', prix: 1500, stock: 300, emoji: '💧', dateExpiration: '2028-01-15' },
      { nom: 'Pansements stériles', categorie: 'Matériel', prix: 3000, stock: 150, emoji: '🩹', dateExpiration: '2028-06-20' },
      { nom: 'Thermomètre digital', categorie: 'Matériel', prix: 8000, stock: 30, emoji: '🌡️', dateExpiration: '2030-01-01' },
      { nom: 'Masques chirurgicaux (50)', categorie: 'Protection', prix: 5000, stock: 45, emoji: '😷', dateExpiration: '2028-03-15' },
    ];

    for (const p of products) await dbAdd('products', p);
  }

  // Demo sales
  const salesCount = await dbCount('sales');
  if (salesCount === 0) {
    const sales = [
      { date: '2026-05-19T10:30:00', items: [{ nom: 'Paracétamol 500mg', quantite: 2, prixUnitaire: 2500 }, { nom: 'Vitamine C 1000mg', quantite: 1, prixUnitaire: 2000 }], total: 7000, client: 'Marie Dupont' },
      { date: '2026-05-19T09:15:00', items: [{ nom: 'Metformine 500mg', quantite: 3, prixUnitaire: 5500 }], total: 16500, client: 'Patrick Kabongo' },
      { date: '2026-05-18T16:45:00', items: [{ nom: 'Amlodipine 5mg', quantite: 1, prixUnitaire: 4000 }, { nom: 'Oméprazole 20mg', quantite: 2, prixUnitaire: 3500 }], total: 11000, client: 'Amina Mbeki' },
    ];

    for (const s of sales) await dbAdd('sales', s);
  }

  // Demo appointments
  const appointmentCount = await dbCount('appointments');
  if (appointmentCount === 0) {
    const appointments = [
      { patientId: patientIdBySerial['MC-PAT-0001'], patientNom: 'Marie Dupont', date: '2026-05-20', heure: '09:00', docteur: 'Dr. Mukendi', motif: 'Contrôle asthme', statut: 'confirmé' },
      { patientId: patientIdBySerial['MC-PAT-0003'], patientNom: 'Amina Mbeki', date: '2026-05-20', heure: '10:30', docteur: 'Dr. Kasongo', motif: 'Suivi hypertension', statut: 'confirmé' },
      { patientId: patientIdBySerial['MC-PAT-0002'], patientNom: 'Patrick Kabongo', date: '2026-05-21', heure: '14:00', docteur: 'Dr. Mukendi', motif: 'Contrôle diabète', statut: 'en attente' },
      { patientId: patientIdBySerial['MC-PAT-0004'], patientNom: 'David Lukaku', date: '2026-05-22', heure: '11:00', docteur: 'Dr. Ngoy', motif: 'Bilan de santé annuel', statut: 'en attente' },
    ].filter(a => a.patientId);

    for (const a of appointments) await dbAdd('appointments', a);
  }
}

// Export
window.MedDB = { openDB, dbAdd, dbUpdate, dbDelete, dbGetAll, dbGet, dbGetByIndex, dbCount, seedDemoData };
