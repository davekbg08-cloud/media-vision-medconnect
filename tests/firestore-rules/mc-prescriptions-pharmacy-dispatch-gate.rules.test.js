/* =====================================================
   Tests — règles Firestore : dispatch d'ordonnance vers une
   pharmacie soumis à l'abonnement desktop (mc_prescriptions +
   collection jumelle /prescriptions).

   Découvert en auditant le dépôt : la collection canonique
   mc_prescriptions (la seule réellement lue) autorisait le médecin
   auteur à mettre à jour une ordonnance SANS aucun contrôle
   d'abonnement, alors que la collection jumelle /prescriptions gate
   déjà cette écriture (hospitalCanWriteFromDevice) — dérive
   canonique/legacy. Correctif : on aligne les deux, mais le contrôle
   ne s'applique QUE lorsqu'une pharmacie précise est ciblée
   (pharmacyUid non nul). L'envoi au patient (pharmacyUid null) reste
   toujours ouvert : le soin du patient n'est jamais coupé pour une
   facture desktop impayée. js/network.js pose désormais aussi
   sourceDevice sur le dispatch pour que la règle voie le device réel.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedExpiredSubscription(env, hospitalId) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'subscriptions', hospitalId), { status: 'expired' });
  });
}

async function seedRx(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

// Les deux collections doivent se comporter à l'identique.
for (const collection of ['mc_prescriptions', 'prescriptions']) {
  test(`${collection} : dispatch vers une pharmacie REFUSÉ sur desktop si l'abonnement hôpital est expiré`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-RXD-1');
    await seedRx(env, collection, 'RXD-1', {
      patient_id: 'MC-RXD-1', doctor_uid: 'doc-rxd-1', establishmentId: 'HOSP-RXD-1',
      status: 'draft', medicines: [],
    });
    const doctor = env.authenticatedContext('doc-rxd-1', { role: 'doctor' }).firestore();
    await assertFails(updateDoc(doc(doctor, collection, 'RXD-1'), {
      pharmacyUid: 'pharma-1', pharmacyName: 'Pharma Un', status: 'sent', sourceDevice: 'desktop',
    }));
  });

  test(`${collection} : dispatch vers une pharmacie ACCEPTÉ sur mobile même abonnement expiré (le soin n'est jamais coupé)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-RXD-2');
    await seedRx(env, collection, 'RXD-2', {
      patient_id: 'MC-RXD-2', doctor_uid: 'doc-rxd-2', establishmentId: 'HOSP-RXD-2',
      status: 'draft', medicines: [],
    });
    const doctor = env.authenticatedContext('doc-rxd-2', { role: 'doctor' }).firestore();
    await assertSucceeds(updateDoc(doc(doctor, collection, 'RXD-2'), {
      pharmacyUid: 'pharma-2', pharmacyName: 'Pharma Deux', status: 'sent', sourceDevice: 'mobile',
    }));
  });

  test(`${collection} : dispatch vers une pharmacie ACCEPTÉ sur desktop si l'abonnement est actif (défaut permissif sans document subscriptions)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedRx(env, collection, 'RXD-3', {
      patient_id: 'MC-RXD-3', doctor_uid: 'doc-rxd-3', establishmentId: 'HOSP-RXD-3',
      status: 'draft', medicines: [],
    });
    const doctor = env.authenticatedContext('doc-rxd-3', { role: 'doctor' }).firestore();
    await assertSucceeds(updateDoc(doc(doctor, collection, 'RXD-3'), {
      pharmacyUid: 'pharma-3', pharmacyName: 'Pharma Trois', status: 'sent', sourceDevice: 'desktop',
    }));
  });

  test(`${collection} : envoi au patient (pharmacyUid null) ACCEPTÉ sur desktop même abonnement expiré (chemin patient jamais coupé)`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-RXD-4');
    await seedRx(env, collection, 'RXD-4', {
      patient_id: 'MC-RXD-4', doctor_uid: 'doc-rxd-4', establishmentId: 'HOSP-RXD-4',
      status: 'draft', medicines: [],
    });
    const doctor = env.authenticatedContext('doc-rxd-4', { role: 'doctor' }).firestore();
    await assertSucceeds(updateDoc(doc(doctor, collection, 'RXD-4'), {
      pharmacyUid: null, pharmacyName: null, status: 'sent', sourceDevice: 'desktop',
    }));
  });
}
