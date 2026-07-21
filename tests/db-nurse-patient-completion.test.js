/* =====================================================
   Tests — DB.completeNurseCreatedPatientAfterConsultation (v2.9.36)

   Complétion médicale d'une fiche créée par une infirmière
   (awaiting_doctor/pending → active/completed) après la première
   consultation. Fonction DÉDIÉE : écriture PARTIELLE (merge) confinée aux
   champs de complétion, cache local seulement après confirmation, jamais
   de faux succès, idempotence. N'utilise jamais DB.updatePatient().
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

/* Mock Firestore : batch() + collection().doc().get(). failMode s'applique
   UNIQUEMENT au lot qui touche mc_patients (la complétion) — le lot de
   confirmation de la consultation (mc_consultations seul) réussit toujours,
   sauf consultFail. Un serverStore applique la sémantique merge. */
function makeMock({ failMode = null, consultFail = false, serverPatients = {} } = {}) {
  const server = { mc_patients: { ...serverPatients }, patients: { ...serverPatients }, mc_consultations: {} };
  const commits = [];
  function docRef(col, id) {
    return { __col: col, __id: String(id),
      async get() { const d = server[col]?.[String(id)]; return { exists: d !== undefined, data: () => d || {} }; } };
  }
  return {
    server, commits,
    collection(col) { return { doc: (id) => docRef(col, id) }; },
    batch() {
      const writes = [];
      return {
        set(ref, data, opts) { writes.push({ col: ref.__col, id: ref.__id, data, merge: !!(opts && opts.merge) }); },
        async commit() {
          commits.push(writes.map(w => w.col));
          const touchesPatients = writes.some(w => w.col === 'mc_patients' || w.col === 'patients');
          const onlyConsult = writes.every(w => w.col === 'mc_consultations');
          if (onlyConsult && consultFail) { const e = new Error('consult refus'); e.code = 'unavailable'; throw e; }
          if (touchesPatients && failMode === 'blocked') { const e = new Error('refus'); e.code = 'permission-denied'; throw e; }
          if (touchesPatients && failMode === 'timeout') { return new Promise(() => {}); }
          if (touchesPatients && failMode === 'transient') { const e = new Error('indispo'); e.code = 'unavailable'; throw e; }
          // Applique les écritures (merge = fusion, sinon remplacement).
          writes.forEach(w => {
            if (w.merge) server[w.col][w.id] = { ...(server[w.col][w.id] || {}), ...w.data };
            else server[w.col][w.id] = w.data;
          });
          return true;
        },
      };
    },
  };
}

function setup({ firebaseReady = true, failMode = null, consultFail = false, patients = [], serverPatients = {} } = {}) {
  const firebaseDB = firebaseReady ? makeMock({ failMode, consultFail, serverPatients }) : undefined;
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
  const DB = sandbox.window.DB;
  if (patients.length) sandbox.window.localStorage.setItem('mc_patients', JSON.stringify(patients));
  return { win: sandbox.window, firebaseDB, DB };
}

const NURSE_PATIENT = {
  id: 'MC-2026-CD-NURSE1', firstname: 'Awa', lastname: 'Diallo',
  created_by: 'nurse-1', created_by_role: 'nurse',
  nurse_uid: 'nurse-1', nurse_name: 'Inf. Kalala', nurse_registration_number: 'N123',
  establishmentId: 'EST-1', hospital_id: 'EST-1',
  status: 'awaiting_doctor', medical_completion_status: 'pending',
};
const CONSULT = { cid: 'C-1', patient_id: 'MC-2026-CD-NURSE1', doctor_uid: 'doc-1', establishmentId: 'EST-1' };
const ARGS = { patientId: 'MC-2026-CD-NURSE1', consultation: CONSULT, doctorUid: 'doc-1', doctorName: 'Dr House', establishmentId: 'EST-1' };

test('complète une fiche infirmière pending → confirmed + cache mis à jour APRÈS confirmation', async () => {
  const { DB, firebaseDB } = setup({ patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.confirmed, true);
  const p = DB.getPatientById('MC-2026-CD-NURSE1');
  assert.strictEqual(p.status, 'active');
  assert.strictEqual(p.medical_completion_status, 'completed');
  assert.strictEqual(p.completed_by_doctor_uid, 'doc-1');
  assert.strictEqual(p.completed_by_consultation_id, 'C-1');
});

test('écriture PARTIELLE : le lot de complétion ne contient QUE les champs de complétion (merge)', async () => {
  const { DB, firebaseDB } = setup({ patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  // Le serveur (merge) conserve l'identité et la traçabilité infirmière.
  const srv = firebaseDB.server.mc_patients['MC-2026-CD-NURSE1'];
  assert.strictEqual(srv.firstname, 'Awa', 'prénom préservé');
  assert.strictEqual(srv.nurse_uid, 'nurse-1', 'nurse_uid préservé');
  assert.strictEqual(srv.created_by, 'nurse-1', 'created_by préservé');
  assert.strictEqual(srv.id, 'MC-2026-CD-NURSE1', 'numéro MC préservé');
  assert.strictEqual(srv.status, 'active');
  assert.strictEqual(srv.medical_completion_status, 'completed');
});

test('le cache local préserve nurse_uid, created_by et le numéro MC', async () => {
  const { DB } = setup({ patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  const p = DB.getPatientById('MC-2026-CD-NURSE1');
  assert.strictEqual(p.nurse_uid, 'nurse-1');
  assert.strictEqual(p.nurse_name, 'Inf. Kalala');
  assert.strictEqual(p.created_by, 'nurse-1');
  assert.strictEqual(p.id, 'MC-2026-CD-NURSE1');
  assert.strictEqual(p.firstname, 'Awa');
});

test('idempotence : une fiche déjà completed retourne alreadyCompleted, sans réécriture', async () => {
  const done = { ...NURSE_PATIENT, status: 'active', medical_completion_status: 'completed' };
  const { DB, firebaseDB } = setup({ patients: [done] });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.alreadyCompleted, true);
  assert.strictEqual(firebaseDB.commits.length, 0, 'aucune écriture pour une fiche déjà complétée');
});

test('une deuxième consultation ne relance pas la complétion (déjà completed)', async () => {
  const { DB, firebaseDB } = setup({ patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  const before = firebaseDB.commits.length;
  const res2 = await DB.completeNurseCreatedPatientAfterConsultation({ ...ARGS, consultation: { ...CONSULT, cid: 'C-2' } });
  assert.strictEqual(res2.alreadyCompleted, true);
  assert.strictEqual(firebaseDB.commits.length, before, 'la 2e consultation ne réécrit pas la fiche');
});

test('fiche créée par un MÉDECIN : notApplicable (jamais complétée par cette voie)', async () => {
  const docPatient = { ...NURSE_PATIENT, created_by: 'doc-9', created_by_role: 'doctor', nurse_uid: undefined, status: 'active', medical_completion_status: 'completed' };
  const { DB } = setup({ patients: [docPatient] });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  // Déjà completed → alreadyCompleted (idempotent, jamais réécrit).
  assert.strictEqual(res.alreadyCompleted, true);
});

test('fiche pending mais NON créée par une infirmière : notApplicable', async () => {
  const weird = { ...NURSE_PATIENT, created_by_role: 'reception' };
  const { DB, firebaseDB } = setup({ patients: [weird] });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.notApplicable, true);
  assert.strictEqual(res.reason, 'non_cree_par_infirmiere');
  assert.strictEqual(firebaseDB.commits.length, 0);
});

test('hors ligne → queued, cache NON modifié (reste pending)', async () => {
  const { DB } = setup({ firebaseReady: false, patients: [NURSE_PATIENT] });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.queued, true);
  assert.ok(res.operationId);
  const p = DB.getPatientById('MC-2026-CD-NURSE1');
  assert.strictEqual(p.medical_completion_status, 'pending', 'cache inchangé hors ligne');
  assert.strictEqual(p.status, 'awaiting_doctor');
  // L'opération en file est un lot PARTIEL (merge) — jamais un overwrite.
  const entry = DB.getOutboxEntries().find(e => e.operationType === 'patient_medical_completion');
  assert.ok(entry, 'opération patient_medical_completion en file');
  assert.strictEqual(entry.merge, true, 'rejeu en écriture partielle');
});

test('refus serveur (permission-denied) → failed/blocked, cache NON modifié, rien en file', async () => {
  const { DB } = setup({ failMode: 'blocked', patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.blocked, true);
  assert.strictEqual(res.errorCode, 'permission-denied');
  const p = DB.getPatientById('MC-2026-CD-NURSE1');
  assert.strictEqual(p.medical_completion_status, 'pending', 'aucun faux succès : cache reste pending');
  assert.strictEqual(DB.getOutboxSummary().total, 0, 'un refus réel n\'est jamais mis en file');
});

test('échec transitoire (unavailable) → queued', async () => {
  const { DB } = setup({ failMode: 'transient', patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(DB.getOutboxSummary().total, 1);
  assert.strictEqual(DB.getPatientById('MC-2026-CD-NURSE1').medical_completion_status, 'pending');
});

test('consultation non confirmée → queued, cache non modifié', async () => {
  const { DB } = setup({ consultFail: true, patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  const res = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(res.queued, true);
  assert.strictEqual(DB.getPatientById('MC-2026-CD-NURSE1').medical_completion_status, 'pending');
});

test('anti double-appel (busy)', async () => {
  // Le verrou _completingPatient est pris avant le premier await (la
  // confirmation de la consultation) : le 2e appel concurrent est absorbé
  // sans qu'on ait besoin de faire traîner le 1er.
  const { DB } = setup({ patients: [NURSE_PATIENT], serverPatients: { 'MC-2026-CD-NURSE1': { ...NURSE_PATIENT } } });
  const p1 = DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  const r2 = await DB.completeNurseCreatedPatientAfterConsultation(ARGS);
  assert.strictEqual(r2.busy, true);
  await p1; // laisse la première complétion se terminer proprement
});
