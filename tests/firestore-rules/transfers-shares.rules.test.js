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
