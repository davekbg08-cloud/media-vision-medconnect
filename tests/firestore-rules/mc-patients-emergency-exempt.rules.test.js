/* =====================================================
   Tests — création de patient : l'intake d'URGENCE est exempté du
   contrôle d'abonnement (mc_patients + collection jumelle /patients)

   Décision produit : la création d'un nouveau patient sur desktop est
   bloquée si l'abonnement de l'établissement est expiré (create_patient,
   la seule action que le mobile bloque aussi), SAUF aux urgences — le
   soin d'urgence n'est jamais coupé pour une facture impayée (même
   principe que emergency-transfer). js/hospital-emergency.js pose
   emergencyIntake:true sur la fiche ; la règle (isEmergencyIntake)
   autorise alors la création malgré l'abonnement expiré. Les flux
   normaux (réception, maternité, nouveau patient) restent bloqués.

   ⚠️ emergencyIntake est déclaré par le client (limite connue, comme
   sourceDevice) : contrôle dissuasif, non infalsifiable sans backend.
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

for (const collection of ['mc_patients', 'patients']) {
  test(`${collection} : création NORMALE refusée si l'abonnement hôpital est expiré`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-EMG-1');
    const doctor = env.authenticatedContext('doc-emg-1', { role: 'doctor' }).firestore();
    await assertFails(setDoc(doc(doctor, collection, 'PAT-EMG-1'), {
      id: 'PAT-EMG-1', firstname: 'A', lastname: 'B', establishmentId: 'HOSP-EMG-1',
    }));
  });

  test(`${collection} : création d'URGENCE (emergencyIntake:true) acceptée même abonnement expiré — payload légitime tracé`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-EMG-2');
    const doctor = env.authenticatedContext('doc-emg-2', { role: 'doctor' }).firestore();
    // Durcissement C : le contournement d'urgence exige un document TRAÇABLE
    // (created_by == auth.uid) et RATTACHÉ (establishmentId non nul). Le
    // client réel (currentEstablishmentFields) pose déjà ces deux champs.
    await assertSucceeds(setDoc(doc(doctor, collection, 'PAT-EMG-2'), {
      id: 'PAT-EMG-2', firstname: 'A', lastname: 'B', establishmentId: 'HOSP-EMG-2',
      created_by: 'doc-emg-2', emergencyIntake: true,
    }));
  });

  test(`${collection} : contournement d'urgence REFUSÉ si created_by usurpe un autre agent (abonnement expiré)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-EMG-2b');
    const doctor = env.authenticatedContext('doc-emg-2b', { role: 'doctor' }).firestore();
    // created_by != auth.uid → intégrité non satisfaite → pas de bypass ;
    // l'abonnement étant expiré, la création est refusée.
    await assertFails(setDoc(doc(doctor, collection, 'PAT-EMG-2b'), {
      id: 'PAT-EMG-2b', firstname: 'A', lastname: 'B', establishmentId: 'HOSP-EMG-2b',
      created_by: 'quelqu-un-dautre', emergencyIntake: true,
    }));
  });

  // NB : on ne teste PAS le refus d'une fiche d'urgence SANS establishmentId
  // (orpheline) : ce cas reste volontairement permissif — le bloquer
  // casserait le médecin solo hors contexte hôpital (voir
  // mc-patients-create : création acceptée sans establishmentId). Le
  // durcissement C ne porte donc que sur la traçabilité (created_by).

  test(`${collection} : création NORMALE acceptée si l'abonnement est actif (défaut permissif sans document subscriptions)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    const doctor = env.authenticatedContext('doc-emg-3', { role: 'doctor' }).firestore();
    await assertSucceeds(setDoc(doc(doctor, collection, 'PAT-EMG-3'), {
      id: 'PAT-EMG-3', firstname: 'A', lastname: 'B', establishmentId: 'HOSP-EMG-3',
    }));
  });
}
