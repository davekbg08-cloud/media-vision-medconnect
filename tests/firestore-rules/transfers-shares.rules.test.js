/* =====================================================
   Tests — règles Firestore : emergencyTransfers / medical_record_shares (PARTIE I)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedMember(env, hospitalId, uid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, status: 'active' });
  });
}

// Correctif (audit "workflows mobile/desktop", section 13) :
// canDecideTransfer() (firestore.rules) exige désormais un rôle réel
// (doctor/admin_hospital), pas seulement l'appartenance à
// hospitalMembers — seedRole() reflète l'état d'un compte réellement
// approuvé (même convention que establishment-isolation.rules.test.js).
async function seedRole(env, uid, role) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', uid), { uid, role, status: 'approved' });
  });
}

async function seedTransfer(env, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'emergencyTransfers', id), data);
  });
}

async function seedShare(env, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'medical_record_shares', id), data);
  });
}

test("emergencyTransfers : membre de l'hôpital SOURCE peut lire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC', 'staff-src-1');
  await seedTransfer(env, 'T1', { fromHospitalId: 'HOSP-SRC', toHospitalId: 'HOSP-DST', patientId: 'MC-T1' });
  const src = env.authenticatedContext('staff-src-1').firestore();
  await assertSucceeds(getDoc(doc(src, 'emergencyTransfers', 'T1')));
});

test("emergencyTransfers : membre de l'hôpital DESTINATAIRE peut lire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-DST', 'staff-dst-1');
  await seedTransfer(env, 'T2', { fromHospitalId: 'HOSP-SRC', toHospitalId: 'HOSP-DST', patientId: 'MC-T2' });
  const dst = env.authenticatedContext('staff-dst-1').firestore();
  await assertSucceeds(getDoc(doc(dst, 'emergencyTransfers', 'T2')));
});

test('emergencyTransfers : un tiers hors du transfert est refusé', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-TIERS', 'staff-tiers-1');
  await seedTransfer(env, 'T3', { fromHospitalId: 'HOSP-SRC', toHospitalId: 'HOSP-DST', patientId: 'MC-T3' });
  const tiers = env.authenticatedContext('staff-tiers-1').firestore();
  await assertFails(getDoc(doc(tiers, 'emergencyTransfers', 'T3')));
});

test("emergencyTransfers : le contenu médical (emergencyPacket) reste figé même pour l'hôpital source", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC', 'staff-src-2');
  await seedTransfer(env, 'T4', {
    fromHospitalId: 'HOSP-SRC', toHospitalId: 'HOSP-DST', patientId: 'MC-T4',
    emergencyPacket: { diagnosis: 'original' }, status: 'pending',
  });
  const src = env.authenticatedContext('staff-src-2').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertFails(updateDoc(doc(src, 'emergencyTransfers', 'T4'), {
    emergencyPacket: { diagnosis: 'falsifié' },
  }));
});

test("medical_record_shares : hôpital source et destinataire autorisés, tiers refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC2', 'staff-src-3');
  await seedMember(env, 'HOSP-DST2', 'staff-dst-3');
  await seedMember(env, 'HOSP-TIERS2', 'staff-tiers-2');
  await seedShare(env, 'S1', { fromHospitalId: 'HOSP-SRC2', toHospitalId: 'HOSP-DST2', patientId: 'MC-S1', allowedSections: ['summary'] });
  const src = env.authenticatedContext('staff-src-3').firestore();
  const dst = env.authenticatedContext('staff-dst-3').firestore();
  const tiers = env.authenticatedContext('staff-tiers-2').firestore();
  await assertSucceeds(getDoc(doc(src, 'medical_record_shares', 'S1')));
  await assertSucceeds(getDoc(doc(dst, 'medical_record_shares', 'S1')));
  await assertFails(getDoc(doc(tiers, 'medical_record_shares', 'S1')));
});

// Correctif (chantier "durcissement sans Cloud Functions") : avant ce
// correctif, "signedIn()" seul suffisait à faire progresser le statut
// d'un partage — un utilisateur connecté SANS AUCUN lien avec ce
// partage (ni hôpital source/destinataire, ni patient concerné)
// pouvait l'approuver/le modifier à la place de l'hôpital destinataire
// légitime (js/hospital.js approveIncomingShare).
test("medical_record_shares : l'hôpital DESTINATAIRE peut approuver (statut), un tiers sans lien est refusé", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC3', 'staff-src-4');
  await seedMember(env, 'HOSP-DST3', 'staff-dst-4');
  await seedMember(env, 'HOSP-TIERS3', 'staff-tiers-3');
  await seedShare(env, 'S2', {
    fromHospitalId: 'HOSP-SRC3', toHospitalId: 'HOSP-DST3', patientId: 'MC-S2',
    allowedSections: ['summary'], status: 'pending_patient_consent', approvedByUid: null,
  });
  const dst = env.authenticatedContext('staff-dst-4').firestore();
  const tiers = env.authenticatedContext('staff-tiers-3').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertFails(updateDoc(doc(tiers, 'medical_record_shares', 'S2'), {
    status: 'active', approvedByUid: 'staff-tiers-3',
  }));
  await assertSucceeds(updateDoc(doc(dst, 'medical_record_shares', 'S2'), {
    status: 'active', approvedByUid: 'staff-dst-4',
  }));
});

/* ── Correctif P0/P1 (audit "workflows mobile/desktop", section 16) ──
   hospitalCanWriteFromDevice() ne vérifiait que l'abonnement/le type
   d'appareil, jamais l'appartenance réelle à fromHospitalId — un
   utilisateur connecté SANS AUCUN lien avec l'hôpital source pouvait
   créer un transfert d'urgence (ou un partage) en son nom. */
test("emergencyTransfers : un tiers non membre de fromHospitalId ne peut pas créer un transfert", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const tiers = env.authenticatedContext('tiers-create-1').firestore();
  await assertFails(setDoc(doc(tiers, 'emergencyTransfers', 'T-TIERS-1'), {
    fromHospitalId: 'HOSP-SRC-CREATE', toHospitalId: 'HOSP-DST-CREATE', patientId: 'MC-TIERS-1',
    requestingDoctorId: 'tiers-create-1', status: 'requested', emergencyPacket: {},
  }));
});

test("emergencyTransfers : un membre réel de fromHospitalId, MÉDECIN, peut créer un transfert avec son propre uid comme requestingDoctorId", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-CREATE2', 'doctor-create-1');
  await seedRole(env, 'doctor-create-1', 'doctor');
  const doctor = env.authenticatedContext('doctor-create-1').firestore();
  await assertSucceeds(setDoc(doc(doctor, 'emergencyTransfers', 'T-OK-1'), {
    fromHospitalId: 'HOSP-SRC-CREATE2', toHospitalId: 'HOSP-DST-CREATE2', patientId: 'MC-OK-1',
    requestingDoctorId: 'doctor-create-1', status: 'requested', emergencyPacket: {},
  }));
});

// Correctif (audit "workflows mobile/desktop", section 13, P0/P1) : bug
// confirmé — canDecideTransfer() (firestore.rules) existait déjà mais
// n'était jamais utilisé dans la règle create d'emergencyTransfers.
// N'importe quel membre de l'hôpital source (infirmier, réception,
// laborantin, pharmacien — AUCUN n'a la capacité 'decide_transfer' côté
// client, js/hospital-capabilities.js) pouvait donc créer un vrai
// transfert d'urgence en posant requestingDoctorId à son propre uid,
// même via une écriture Firestore directe (bouton JS non représentatif
// de la sécurité réelle).
test("emergencyTransfers : un membre de fromHospitalId SANS la capacité 'decide_transfer' (infirmier) est refusé, même en son propre nom", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-NURSE1', 'nurse-transfer-1');
  await seedRole(env, 'nurse-transfer-1', 'nurse');
  const nurse = env.authenticatedContext('nurse-transfer-1').firestore();
  await assertFails(setDoc(doc(nurse, 'emergencyTransfers', 'T-NURSE-1'), {
    fromHospitalId: 'HOSP-SRC-NURSE1', toHospitalId: 'HOSP-DST-NURSE1', patientId: 'MC-NURSE-1',
    requestingDoctorId: 'nurse-transfer-1', status: 'requested', emergencyPacket: {},
  }));
});

test("emergencyTransfers : un membre de fromHospitalId, admin_hospital, peut aussi créer un transfert (canDecideTransfer)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-ADMINH1', 'adminh-transfer-1');
  await seedRole(env, 'adminh-transfer-1', 'admin_hospital');
  const adminH = env.authenticatedContext('adminh-transfer-1').firestore();
  await assertSucceeds(setDoc(doc(adminH, 'emergencyTransfers', 'T-ADMINH-1'), {
    fromHospitalId: 'HOSP-SRC-ADMINH1', toHospitalId: 'HOSP-DST-ADMINH1', patientId: 'MC-ADMINH-1',
    requestingDoctorId: 'adminh-transfer-1', status: 'requested', emergencyPacket: {},
  }));
});

test("emergencyTransfers : un membre de fromHospitalId ne peut pas créer un transfert au nom d'un AUTRE utilisateur (requestingDoctorId usurpé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-CREATE3', 'doctor-create-2');
  await seedRole(env, 'doctor-create-2', 'doctor');
  const doctor = env.authenticatedContext('doctor-create-2').firestore();
  await assertFails(setDoc(doc(doctor, 'emergencyTransfers', 'T-SPOOF-1'), {
    fromHospitalId: 'HOSP-SRC-CREATE3', toHospitalId: 'HOSP-DST-CREATE3', patientId: 'MC-SPOOF-1',
    requestingDoctorId: 'quelquun-dautre', status: 'requested', emergencyPacket: {},
  }));
});

test("emergencyTransfers : un tiers sans lien avec le transfert ne peut pas modifier son statut", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedTransfer(env, 'T-NOLINK-1', {
    fromHospitalId: 'HOSP-SRC-NL', toHospitalId: 'HOSP-DST-NL', patientId: 'MC-NL-1',
    requestingDoctorId: 'doctor-nl-1', status: 'requested', emergencyPacket: {},
  });
  const tiers = env.authenticatedContext('tiers-nolink-1').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertFails(updateDoc(doc(tiers, 'emergencyTransfers', 'T-NOLINK-1'), { status: 'accepted' }));
});

test("emergencyTransfers : l'hôpital destinataire peut faire progresser le statut (requested -> accepted -> in_transit -> arrived -> completed)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-DST-PROGRESS', 'staff-dst-progress-1');
  await seedTransfer(env, 'T-PROGRESS-1', {
    fromHospitalId: 'HOSP-SRC-PROGRESS', toHospitalId: 'HOSP-DST-PROGRESS', patientId: 'MC-PROGRESS-1',
    requestingDoctorId: 'doctor-progress-1', status: 'requested', emergencyPacket: {},
  });
  const dst = env.authenticatedContext('staff-dst-progress-1').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertSucceeds(updateDoc(doc(dst, 'emergencyTransfers', 'T-PROGRESS-1'), { status: 'accepted' }));
  await assertSucceeds(updateDoc(doc(dst, 'emergencyTransfers', 'T-PROGRESS-1'), { status: 'in_transit' }));
  await assertSucceeds(updateDoc(doc(dst, 'emergencyTransfers', 'T-PROGRESS-1'), { status: 'arrived' }));
  await assertSucceeds(updateDoc(doc(dst, 'emergencyTransfers', 'T-PROGRESS-1'), { status: 'completed' }));
});

test("emergencyTransfers : une transition de statut invalide (ex. requested -> completed directement) est refusée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-DST-SKIP', 'staff-dst-skip-1');
  await seedTransfer(env, 'T-SKIP-1', {
    fromHospitalId: 'HOSP-SRC-SKIP', toHospitalId: 'HOSP-DST-SKIP', patientId: 'MC-SKIP-1',
    requestingDoctorId: 'doctor-skip-1', status: 'requested', emergencyPacket: {},
  });
  const dst = env.authenticatedContext('staff-dst-skip-1').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertFails(updateDoc(doc(dst, 'emergencyTransfers', 'T-SKIP-1'), { status: 'completed' }));
});

test("emergencyTransfers : toHospitalId et requestingDoctorId restent figés même pour l'hôpital source", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-IMMUT', 'staff-src-immut-1');
  await seedTransfer(env, 'T-IMMUT-1', {
    fromHospitalId: 'HOSP-SRC-IMMUT', toHospitalId: 'HOSP-DST-IMMUT', patientId: 'MC-IMMUT-1',
    requestingDoctorId: 'doctor-immut-1', status: 'requested', emergencyPacket: {},
  });
  const src = env.authenticatedContext('staff-src-immut-1').firestore();
  const { updateDoc } = require('firebase/firestore');
  await assertFails(updateDoc(doc(src, 'emergencyTransfers', 'T-IMMUT-1'), { toHospitalId: 'HOSP-AUTRE' }));
  await assertFails(updateDoc(doc(src, 'emergencyTransfers', 'T-IMMUT-1'), { requestingDoctorId: 'un-autre-medecin' }));
});

test("medical_record_shares : un tiers non membre de fromHospitalId ne peut pas créer un partage", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const tiers = env.authenticatedContext('tiers-share-create-1').firestore();
  await assertFails(setDoc(doc(tiers, 'medical_record_shares', 'S-TIERS-1'), {
    fromHospitalId: 'HOSP-SRC-SHARE-CREATE', toHospitalId: 'HOSP-DST-SHARE-CREATE', patientId: 'MC-SHARE-TIERS-1',
    allowedSections: ['summary'],
  }));
});

test("medical_record_shares : un membre réel de fromHospitalId peut créer un partage", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-SRC-SHARE-CREATE2', 'staff-share-create-1');
  const staff = env.authenticatedContext('staff-share-create-1').firestore();
  await assertSucceeds(setDoc(doc(staff, 'medical_record_shares', 'S-OK-1'), {
    fromHospitalId: 'HOSP-SRC-SHARE-CREATE2', toHospitalId: 'HOSP-DST-SHARE-CREATE2', patientId: 'MC-SHARE-OK-1',
    allowedSections: ['summary'],
  }));
});
