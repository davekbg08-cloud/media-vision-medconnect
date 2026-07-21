/* =====================================================
   Tests — DB.searchPatientDirectory (chantier v2.9.34, P1)

   Recherche dans l'annuaire non clinique patient_directory pour la
   réception et le laboratoire : une fiche créée sur un autre poste n'est
   pas dans le cache local. Vérifie que la requête est TOUJOURS bornée à
   establishmentId (seule forme autorisée par firestore.rules), que le
   filtrage nom/téléphone se fait côté client, que rien de clinique n'est
   renvoyé, et les replis (hors ligne, permission refusée).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeMemoryStorage } = require('./helper');

function makeDirectoryFirestoreMock({ entries = [], failCode = null } = {}) {
  const whereCalls = [];
  return {
    whereCalls,
    collection(name) {
      return {
        where(field, op, value) {
          whereCalls.push({ collection: name, field, op, value });
          const filtered = entries.filter(e => e.establishmentId === value);
          return {
            async get() {
              if (failCode) { const err = new Error('refus'); err.code = failCode; throw err; }
              return {
                forEach(cb) { filtered.forEach(e => cb({ id: e.patientId, data: () => e })); },
              };
            },
          };
        },
      };
    },
  };
}

function setup({ firebaseReady = true, entries = [], failCode = null, localPatients = [] } = {}) {
  const firebaseDB = firebaseReady ? makeDirectoryFirestoreMock({ entries, failCode }) : undefined;
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
  if (localPatients.length) sandbox.window.DB.savePatients(localPatients);
  return { win: sandbox.window, firebaseDB, DB: sandbox.window.DB };
}

const DIRECTORY = [
  { patientId: 'MC-A', firstname: 'Awa', lastname: 'Diallo', phone: '0810000001', establishmentId: 'EST-1', administrativeStatus: 'active' },
  { patientId: 'MC-B', firstname: 'Bob', lastname: 'Kalume', phone: '0820000002', establishmentId: 'EST-1', administrativeStatus: 'active' },
  { patientId: 'MC-C', firstname: 'Chris', lastname: 'Autre', phone: '0830000003', establishmentId: 'EST-2', administrativeStatus: 'active' },
];

test('searchPatientDirectory : requête TOUJOURS bornée à establishmentId (égalité)', async () => {
  const { DB, firebaseDB } = setup({ entries: DIRECTORY });
  await DB.searchPatientDirectory('diallo', 'EST-1');
  assert.strictEqual(firebaseDB.whereCalls.length, 1);
  assert.deepStrictEqual(
    { c: firebaseDB.whereCalls[0].collection, f: firebaseDB.whereCalls[0].field, o: firebaseDB.whereCalls[0].op, v: firebaseDB.whereCalls[0].value },
    { c: 'patient_directory', f: 'establishmentId', o: '==', v: 'EST-1' });
});

test('searchPatientDirectory : trouve par nom (filtrage client), ne renvoie que le même établissement', async () => {
  const { DB } = setup({ entries: DIRECTORY });
  const res = await DB.searchPatientDirectory('kalume', 'EST-1');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-B');
  assert.strictEqual(res[0].lastname, 'Kalume');
});

test('searchPatientDirectory : trouve par téléphone', async () => {
  const { DB } = setup({ entries: DIRECTORY });
  const res = await DB.searchPatientDirectory('0810000001', 'EST-1');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-A');
});

test('searchPatientDirectory : ne renvoie AUCUN champ clinique (identité + statut administratif seulement)', async () => {
  const { DB } = setup({ entries: DIRECTORY });
  const res = await DB.searchPatientDirectory('awa', 'EST-1');
  const keys = Object.keys(res[0]).sort().join(',');
  assert.strictEqual(keys, '_source,administrativeStatus,dob,establishmentId,firstname,gender,id,lastname,phone');
});

test('searchPatientDirectory : requête vide renvoie [] (jamais tout l\'annuaire)', async () => {
  const { DB, firebaseDB } = setup({ entries: DIRECTORY });
  const res = await DB.searchPatientDirectory('', 'EST-1');
  assert.strictEqual(res.length, 0);
  assert.strictEqual(firebaseDB.whereCalls.length, 0, 'aucune requête cloud pour une saisie vide');
});

test('searchPatientDirectory : sans establishmentId, repli cache local uniquement (jamais de requête non bornée)', async () => {
  const { DB, firebaseDB } = setup({
    entries: DIRECTORY,
    localPatients: [{ id: 'MC-LOCAL', firstname: 'Local', lastname: 'Test', phone: '0899', establishmentId: 'EST-1' }],
  });
  const res = await DB.searchPatientDirectory('local', null);
  assert.strictEqual(firebaseDB.whereCalls.length, 0);
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-LOCAL');
});

test('searchPatientDirectory : permission refusée → repli cache local, jamais d\'exception', async () => {
  const { DB } = setup({
    entries: DIRECTORY, failCode: 'permission-denied',
    localPatients: [{ id: 'MC-LOCAL2', firstname: 'Awa', lastname: 'Locale', phone: '0700', establishmentId: 'EST-1' }],
  });
  const res = await DB.searchPatientDirectory('awa', 'EST-1');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].id, 'MC-LOCAL2');
});

test('searchPatientDirectory : une entrée locale prime sur le doublon annuaire (fusion par id)', async () => {
  const { DB } = setup({
    entries: [{ patientId: 'MC-A', firstname: 'Awa', lastname: 'Ancienne', phone: '0810000001', establishmentId: 'EST-1' }],
    localPatients: [{ id: 'MC-A', firstname: 'Awa', lastname: 'Récente', phone: '0810000001', establishmentId: 'EST-1' }],
  });
  const res = await DB.searchPatientDirectory('awa', 'EST-1');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].lastname, 'Récente');
  assert.strictEqual(res[0]._source, 'local');
});
