/* =====================================================
   Tests — blocage d'abonnement INFALSIFIABLE des workflows desktop
   (desktopWorkflowCanWrite, firestore.rules)

   Limite documentée jusqu'ici : sourceDevice est déclaré par le
   client — un desktop pouvait envoyer sourceDevice:'mobile' pour
   contourner le blocage d'abonnement (hospitalCanWriteFromDevice).
   Correctif : les collections des workflows desktop (beds, admissions,
   receptionVisits, labRequests, labResults, emergencyCases,
   maternityCases, aiQueries) ne sont JAMAIS écrites par la version
   mobile — pour elles, l'abonnement est désormais exigé
   inconditionnellement, sans lire sourceDevice : le spoof ne sert
   plus à rien sur tout le cœur du produit desktop payant.
   Le risque résiduel ne concerne plus que les collections partagées
   avec le mobile (consultations, ordonnances, RDV, messages), où le
   principe « mobile jamais coupé » impose de garder le champ déclaré.
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

// [collection, rôle autorisé par la clause de rôle, données minimales]
const CASES = [
  ['beds',            'doctor',    { label: 'Lit A1', ward: 'Médecine', status: 'free' }],
  ['admissions',      'doctor',    { patientMc: 'MC-X', status: 'admitted' }],
  ['receptionVisits', 'reception', { patientMc: 'MC-X', status: 'waiting' }],
  ['labRequests',     'doctor',    { patientMc: 'MC-X', status: 'pending' }],
  ['labResults',      'lab',       { patientMc: 'MC-X', result: 'ok' }],
  ['emergencyCases',  'reception', { patientMc: 'MC-X', status: 'waiting' }],
  ['maternityCases',  'reception', { patientMc: 'MC-X', status: 'prenatal' }],
  ['aiQueries',       'doctor',    { userId: 'u-spoof', query: 'q' }],
];

for (const [collection, role, data] of CASES) {
  test(`${collection} : abonnement expiré → création REFUSÉE même avec sourceDevice:'mobile' falsifié`, async () => {
    const env = await getTestEnv();
    await clearAll(env);
    await seedExpiredSubscription(env, 'HOSP-HARD-1');
    const user = env.authenticatedContext('u-spoof', { role }).firestore();
    await assertFails(setDoc(doc(user, collection, `SPOOF-${collection}`), {
      ...data, establishmentId: 'HOSP-HARD-1', hospitalId: 'HOSP-HARD-1',
      sourceDevice: 'mobile', // falsifié — ne doit plus rien débloquer
    }));
  });
}

test("beds : abonnement actif (défaut permissif sans document subscriptions) → création acceptée (non-régression du flux normal)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const user = env.authenticatedContext('u-ok', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(user, 'beds', 'BED-OK'), {
    label: 'Lit B1', ward: 'Médecine', status: 'free',
    establishmentId: 'HOSP-HARD-2', hospitalId: 'HOSP-HARD-2',
    sourceDevice: 'desktop',
  }));
});

test("non-régression : mc_consultations (collection PARTAGÉE) mobile + abonnement expiré reste ACCEPTÉE (mobile jamais coupé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-HARD-3');
  const docteur = env.authenticatedContext('doc-hard-3', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(docteur, 'mc_consultations', 'CONS-HARD-3'), {
    cid: 'CONS-HARD-3', patient_id: 'MC-H3', establishmentId: 'HOSP-HARD-3', sourceDevice: 'mobile',
  }));
});
