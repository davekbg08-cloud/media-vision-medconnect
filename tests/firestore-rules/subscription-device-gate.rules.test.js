/* =====================================================
   Tests — règles Firestore : abonnement desktop appliqué aux
   consultations et ordonnances (mc_consultations / mc_prescriptions)

   Découvert en auditant le dépôt : le principe documenté
   (hospitalCanWriteFromDevice — mobile jamais coupé pour le soin
   courant, desktop bloqué si abonnement expiré/suspendu) n'était en
   réalité appliqué qu'aux collections jumelles /consultations et
   /prescriptions, jamais lues en pratique par l'app (mirrors morts).
   Le vrai chemin d'écriture (js/db.js addConsultation/addPrescription)
   n'avait aucun contrôle d'abonnement. Verrouille le comportement
   attendu après correctif.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedExpiredSubscription(env, hospitalId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'subscriptions', hospitalId), { status: 'expired' });
  });
}

test('mc_consultations : création refusée pour un desktop dont l\'abonnement hôpital est expiré', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-CONS-1');
  const doctor = env.authenticatedContext('doctor-cons-1', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_consultations', 'CONS-1'), {
    cid: 'CONS-1', patient_id: 'MC-CONS-1', establishmentId: 'HOSP-CONS-1', sourceDevice: 'desktop',
  }));
});

test("mc_consultations : création acceptée pour un mobile même si l'abonnement hôpital est expiré (le soin courant n'est jamais coupé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-CONS-2');
  const doctor = env.authenticatedContext('doctor-cons-2', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_consultations', 'CONS-2'), {
    cid: 'CONS-2', patient_id: 'MC-CONS-2', establishmentId: 'HOSP-CONS-2', sourceDevice: 'mobile',
  }));
});

test("mc_consultations : création acceptée pour un desktop dont l'abonnement est actif (défaut permissif sans document subscriptions)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-cons-3', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_consultations', 'CONS-3'), {
    cid: 'CONS-3', patient_id: 'MC-CONS-3', establishmentId: 'HOSP-CONS-3', sourceDevice: 'desktop',
  }));
});

test('mc_prescriptions : création refusée pour un desktop dont l\'abonnement hôpital est expiré', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RX-1');
  const doctor = env.authenticatedContext('doctor-rx-1', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_prescriptions', 'RX-1'), {
    pid: 'RX-1', patient_id: 'MC-RX-1', establishmentId: 'HOSP-RX-1', sourceDevice: 'desktop', medicines: [],
  }));
});

test("mc_prescriptions : création acceptée pour un mobile même si l'abonnement hôpital est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-RX-2');
  const doctor = env.authenticatedContext('doctor-rx-2', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_prescriptions', 'RX-2'), {
    pid: 'RX-2', patient_id: 'MC-RX-2', establishmentId: 'HOSP-RX-2', sourceDevice: 'mobile', medicines: [],
  }));
});
