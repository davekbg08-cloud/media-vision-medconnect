/* =====================================================
   Tests — DB.addPatientAndConfirmAtomic / DB.buildPatientRecord
   (audit "workflows mobile/desktop", section 5)

   Bug confirmé : addPatientAndConfirmAtomic() appelait addPatient(),
   qui écrit IMMÉDIATEMENT dans le cache local ET lance trois écritures
   _push() INDÉPENDANTES (mc_patients/patients/medical_records) —
   chacune capable de se mettre en file d'outbox SÉPARÉMENT — avant même
   que le batch supposé atomique ne s'exécute. Hors ligne, ça pouvait
   mettre en file trois écritures non groupées pour une fiche que le
   batch rejetait ensuite. Corrigé : buildPatientRecord() est un helper
   PUR (aucune écriture), et addPatientAndConfirmAtomic() n'écrit dans
   le cache qu'APRÈS confirmation réelle du batch, sans jamais appeler
   addPatient() ni _push() individuellement.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function makeBatchFirestoreMock({ shouldFail = false, failCode = null, hangCommit = false, docExists = false } = {}) {
  const sets = [];
  return {
    batch() {
      return {
        set(ref, data) { sets.push({ col: ref.__col, id: ref.__id, data }); },
        async commit() {
          if (hangCommit) return new Promise(() => {}); // ne résout jamais (timeout côté interface)
          if (shouldFail) {
            const err = new Error('Batch commit failed (simulated)');
            if (failCode) err.code = failCode;
            throw err;
          }
          return true;
        },
      };
    },
    collection(name) {
      return {
        doc: (id) => ({
          __col: name, __id: id,
          // Réconciliation post-timeout (chantier v2.9.34) :
          // addPatientAndConfirmAtomic() relit mc_patients/{id}.
          async get() { return { exists: docExists, data: () => ({}) }; },
        }),
      };
    },
    _sets: sets,
  };
}

function setup({ firebaseReady = true, shouldFail = false, failCode = null, hangCommit = false, docExists = false } = {}) {
  const firebaseDB = firebaseReady ? makeBatchFirestoreMock({ shouldFail, failCode, hangCommit, docExists }) : undefined;
  const win = {
    matchMedia: () => ({ matches: false }), addEventListener(){},
    navigator: { userAgent: 'node-test', onLine: true, maxTouchPoints: 0 },
    screen: { width: 1280 }, innerWidth: 1280,
    localStorage: makeMemoryStorage(), sessionStorage: makeMemoryStorage(),
    setInterval: () => 0, clearInterval(){},
  };
  win.window = win;
  const sandbox = {
    window: win,
    document: { URL:'https://test/', addEventListener(){}, getElementById: () => null, querySelectorAll:()=>[], createElement: () => ({ style:{}, classList:{add(){},remove(){},toggle(){}} }) },
    navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    console, setInterval:()=>0, clearInterval(){}, setTimeout, clearTimeout,
    crypto: globalThis.crypto,
    firebaseReady, firebaseDB, firebaseAuth: null,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.resolve(__dirname, '..', 'js/db.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/db.js' });
  return { win: sandbox.window, firebaseDB };
}

test('buildPatientRecord() est un helper pur : aucune écriture cache, aucune entrée en outbox', () => {
  const { win } = setup({ firebaseReady: false });
  const before = win.DB.outboxCount();
  const p = win.DB.buildPatientRecord({ firstname: 'Jean', lastname: 'Kalala', country_code: 'CD' });
  assert.ok(p.id, 'un id doit être généré');
  assert.ok(p.firstAccessCode, 'un code de premier accès doit être généré');
  assert.strictEqual(win.DB.getPatients().length, 0, 'aucune écriture dans le cache local');
  assert.strictEqual(win.DB.outboxCount(), before, "aucune entrée d'outbox ne doit être créée");
});

test('addPatientAndConfirmAtomic() confirmé : le patient apparaît dans le cache APRÈS le batch, jamais avant', async () => {
  const { win, firebaseDB } = setup({ firebaseReady: true, shouldFail: false });
  const { patient, confirmed } = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Marie', lastname: 'Tshisekedi', country_code: 'CD' });
  assert.strictEqual(confirmed, true);
  assert.strictEqual(win.DB.getPatients().length, 1);
  assert.strictEqual(win.DB.getPatients()[0].id, patient.id);
  // Les 4 documents (dont patient_directory, section 7) doivent être
  // écrits dans le MÊME batch (un seul commit).
  const cols = firebaseDB._sets.map(s => s.col).sort();
  assert.deepStrictEqual(cols, ['mc_patients', 'medical_records', 'patient_directory', 'patients']);
});

test('addPatientAndConfirmAtomic() alimente patient_directory sans AUCUN champ clinique', async () => {
  const { win, firebaseDB } = setup({ firebaseReady: true, shouldFail: false });
  await win.DB.addPatientAndConfirmAtomic({
    firstname: 'Grace', lastname: 'Ilunga', country_code: 'CD',
    dob: '1990-01-01', gender: 'F', phone: '+243800000000',
    allergies: 'Pénicilline', chronic: 'Diabète', emergency: 'Frère : +243800000001',
  });
  const dirEntry = firebaseDB._sets.find(s => s.col === 'patient_directory');
  assert.ok(dirEntry, 'un document patient_directory doit être écrit');
  const keys = Object.keys(dirEntry.data).sort();
  assert.deepStrictEqual(keys, [
    'administrativeStatus', 'createdAt', 'dob', 'establishmentId', 'firstname',
    'gender', 'hospital_id', 'lastname', 'patientId', 'phone', 'updatedAt',
  ]);
  assert.strictEqual(dirEntry.data.firstname, 'Grace');
  assert.ok(!('allergies' in dirEntry.data), 'aucun champ clinique ne doit jamais atteindre patient_directory');
  assert.ok(!('chronic' in dirEntry.data), 'aucun champ clinique ne doit jamais atteindre patient_directory');
});

/* Chantier v2.9.34 (P0 création patient) : le comportement v2.9.33
   « échec = rien en file, réessai manuel obligatoire » évolue — un
   échec TRANSITOIRE (hors ligne, service indisponible) met désormais le
   groupe COMPLET en file comme UNE SEULE opération atomique (type
   'batch', rejouée par un seul commit — jamais décomposée en écritures
   indépendantes). Un REJET réel (permission refusée) ne met toujours
   RIEN en file. Dans les deux cas, le cache local reste vierge. */
test("addPatientAndConfirmAtomic() rejet réel (permission-denied) : rien en cache, rien en file — l'agent corrige et réessaie", async () => {
  const { win } = setup({ firebaseReady: true, shouldFail: true, failCode: 'permission-denied' });
  const before = win.DB.outboxCount();
  const result = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Paul', lastname: 'Mukendi', country_code: 'CD' });
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(result.failed, true);
  assert.strictEqual(result.blocked, true);
  assert.strictEqual(result.errorCode, 'permission-denied');
  assert.strictEqual(result.patient, null, 'aucun objet patient présenté comme créé sur un rejet réel');
  assert.strictEqual(win.DB.getPatients().length, 0, 'aucune fiche provisoire ne doit rester en cache après un rejet');
  assert.strictEqual(win.DB.outboxCount(), before,
    'un rejet réel ne doit jamais laisser une file fantôme (une nouvelle tentative aurait un NOUVEL id : risque de doublon)');
});

test("addPatientAndConfirmAtomic() échec transitoire (batch rejeté sans code) : groupe atomique mis en file comme UNE opération, cache vierge", async () => {
  const { win } = setup({ firebaseReady: true, shouldFail: true });
  const result = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Sara', lastname: 'Mbuyi', country_code: 'CD' });
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(result.queued, true);
  assert.ok(result.operationId);
  assert.strictEqual(win.DB.getPatients().length, 0, 'le cache local ne doit être renseigné qu\'après confirmation réelle');
  const entries = win.DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1, 'UNE seule entrée pour tout le groupe — jamais 4 écritures indépendantes');
  assert.strictEqual(entries[0].type, 'batch');
  assert.strictEqual(entries[0].operationType, 'patient_create');
  assert.strictEqual(entries[0].writes.length, 4);
  // join() : les tableaux issus du sandbox vm ont un AUTRE prototype
  // Array — deepStrictEqual les refuse même à contenu identique.
  assert.strictEqual(entries[0].writes.map(w => w[0]).sort().join(','),
    'mc_patients,medical_records,patient_directory,patients');
});

test('addPatientAndConfirmAtomic() hors ligne (firebaseDB indisponible) : groupe atomique en file, cache vierge, code non affichable', async () => {
  const { win } = setup({ firebaseReady: false });
  const result = await win.DB.addPatientAndConfirmAtomic({ firstname: 'Alice', lastname: 'Kabongo', country_code: 'CD' });
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(result.queued, true);
  assert.strictEqual(win.DB.getPatients().length, 0);
  const entries = win.DB.getOutboxEntries();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].type, 'batch');
});

test('addPatientAndConfirmAtomic() timeout puis réconciliation : le document existe côté serveur → confirmé, JAMAIS un doublon proposé', async () => {
  // Promise.race n'annule pas une écriture déjà partie : le commit
  // « pend » côté interface (timeout), mais a réellement abouti côté
  // serveur (docExists:true). La réconciliation par identifiant doit
  // conclure « confirmé » — pas une nouvelle création.
  const { win } = setup({ firebaseReady: true, hangCommit: true, docExists: true });
  const result = await win.DB.addPatientAndConfirmAtomic(
    { firstname: 'Timeout', lastname: 'Reconcilie', country_code: 'CD' },
    { timeoutMs: 50 }
  );
  assert.strictEqual(result.confirmed, true);
  assert.strictEqual(result.reconciled, true);
  assert.strictEqual(win.DB.getPatients().length, 1, 'la fiche réconciliée entre dans le cache');
  assert.strictEqual(win.DB.outboxCount(), 0, 'rien en file : le serveur a déjà le document');
});

test('addPatientAndConfirmAtomic() timeout et document ABSENT côté serveur : groupe atomique en file (rejeu idempotent, mêmes ids)', async () => {
  const { win } = setup({ firebaseReady: true, hangCommit: true, docExists: false });
  const result = await win.DB.addPatientAndConfirmAtomic(
    { firstname: 'Timeout', lastname: 'EnFile', country_code: 'CD' },
    { timeoutMs: 50 }
  );
  assert.strictEqual(result.confirmed, false);
  assert.strictEqual(result.queued, true);
  assert.strictEqual(win.DB.getOutboxEntries()[0].type, 'batch');
  assert.strictEqual(win.DB.getPatients().length, 0);
});

test('addPatientAndConfirmAtomic() : verrou anti double-appel — un second appel concurrent est absorbé (busy), un seul patient créé', async () => {
  const { win, firebaseDB } = setup({ firebaseReady: true });
  const p1 = win.DB.addPatientAndConfirmAtomic({ firstname: 'Un', lastname: 'Seul', country_code: 'CD' });
  const p2 = win.DB.addPatientAndConfirmAtomic({ firstname: 'Un', lastname: 'Seul', country_code: 'CD' });
  const [r1, r2] = await Promise.all([p1, p2]);
  const busyCount = [r1, r2].filter(r => r.busy).length;
  const okCount = [r1, r2].filter(r => r.confirmed).length;
  assert.strictEqual(busyCount, 1, 'le second appel concurrent doit être absorbé');
  assert.strictEqual(okCount, 1);
  assert.strictEqual(win.DB.getPatients().length, 1, 'un double-clic ne doit jamais créer deux patients');
  assert.strictEqual(firebaseDB._sets.filter(s => s.col === 'mc_patients').length, 1);
});

test('addPatient() (chemin historique médecin/infirmier, INCHANGÉ) continue de peupler le cache immédiatement', () => {
  const { win } = setup({ firebaseReady: false });
  const p = win.DB.addPatient({ firstname: 'Historique', lastname: 'Test', country_code: 'CD' });
  assert.strictEqual(win.DB.getPatients().length, 1, 'addPatient() garde son comportement existant (non touché par ce correctif)');
  assert.strictEqual(win.DB.getPatients()[0].id, p.id);
});
