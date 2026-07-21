/* =====================================================
   Tests — règles Firestore : isolation des pharmacies (chantier
   "reception/affiliation sans régression", section 11)

   Bug confirmé : mc_medicines/mc_sales n'avaient qu'une clause
   "allow write: if isAdmin() || currentRoleIs('pharmacist')" — SANS
   AUCUNE isolation par pharmacien. N'importe quel pharmacien pouvait
   lire/modifier/supprimer le stock ou les ventes de N'IMPORTE QUEL
   AUTRE pharmacien. js/db.js addMedicine()/addSale() posent désormais
   pharmacyUid à la création ; pharmacyOwnsOrLegacy() limite l'écriture
   au propriétaire (repli documenté pour les documents antérieurs sans
   pharmacyUid). Le catalogue (lecture mc_medicines) reste public,
   inchangé (spec explicite).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

test('mc_medicines : le catalogue reste lisible par tout compte connecté (inchangé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-1', { mid: 'MED-1', name: 'Paracétamol', stock: '10', pharmacyUid: 'pharma-owner-1' });
  const patient = env.authenticatedContext('any-patient-1', { role: 'patient' }).firestore();
  await assertSucceeds(getDoc(doc(patient, 'mc_medicines', 'MED-1')));
});

test('mc_medicines : un pharmacien peut créer sa propre fiche médicament (pharmacyUid == auth.uid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharma = env.authenticatedContext('pharma-owner-2', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(pharma, 'mc_medicines', 'MED-2'), {
    mid: 'MED-2', name: 'Ibuprofène', stock: '5', pharmacyUid: 'pharma-owner-2',
  }));
});

test("mc_medicines : un pharmacien NE PEUT PAS créer une fiche au nom d'un AUTRE pharmacien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharma = env.authenticatedContext('pharma-attacker-1', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharma, 'mc_medicines', 'MED-3'), {
    mid: 'MED-3', name: 'Amoxicilline', stock: '5', pharmacyUid: 'pharma-victim-1',
  }));
});

test("mc_medicines : un pharmacien NE PEUT PAS modifier le stock d'un AUTRE pharmacien (post-correctif, pharmacyUid posé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-4', { mid: 'MED-4', name: 'Doliprane', stock: '20', pharmacyUid: 'pharma-victim-2' });
  const pharma = env.authenticatedContext('pharma-attacker-2', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharma, 'mc_medicines', 'MED-4'), {
    mid: 'MED-4', name: 'Doliprane', stock: '0', pharmacyUid: 'pharma-victim-2',
  }));
});

test('mc_medicines : un pharmacien peut modifier SON PROPRE stock', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-5', { mid: 'MED-5', name: 'Aspirine', stock: '20', pharmacyUid: 'pharma-owner-3' });
  const pharma = env.authenticatedContext('pharma-owner-3', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(pharma, 'mc_medicines', 'MED-5'), {
    mid: 'MED-5', name: 'Aspirine', stock: '18', pharmacyUid: 'pharma-owner-3',
  }));
});

test('mc_medicines : un pharmacien peut encore modifier une fiche ANTÉRIEURE sans pharmacyUid (repli legacy documenté)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-6', { mid: 'MED-6', name: 'Legacy', stock: '3' });
  const anyPharma = env.authenticatedContext('pharma-any-1', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(anyPharma, 'mc_medicines', 'MED-6'), {
    mid: 'MED-6', name: 'Legacy', stock: '2',
  }));
});

test('mc_sales : un pharmacien peut créer SA propre vente (pharmacyUid == auth.uid)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const pharma = env.authenticatedContext('pharma-owner-4', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(pharma, 'mc_sales', 'SALE-1'), {
    sid: 'SALE-1', total: '10.00', pharmacyUid: 'pharma-owner-4',
  }));
});

test("mc_sales : un pharmacien NE PEUT PAS lire les ventes d'un AUTRE pharmacien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_sales', 'SALE-2', { sid: 'SALE-2', total: '25.00', pharmacyUid: 'pharma-victim-3' });
  const pharma = env.authenticatedContext('pharma-attacker-3', { role: 'pharmacist' }).firestore();
  await assertFails(getDoc(doc(pharma, 'mc_sales', 'SALE-2')));
});

test("mc_sales : un pharmacien NE PEUT PAS supprimer une vente d'un AUTRE pharmacien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_sales', 'SALE-3', { sid: 'SALE-3', total: '15.00', pharmacyUid: 'pharma-victim-4' });
  const pharma = env.authenticatedContext('pharma-attacker-4', { role: 'pharmacist' }).firestore();
  await assertFails(deleteDoc(doc(pharma, 'mc_sales', 'SALE-3')));
});

test('mc_sales : un pharmacien peut lire SES PROPRES ventes', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_sales', 'SALE-4', { sid: 'SALE-4', total: '30.00', pharmacyUid: 'pharma-owner-5' });
  const pharma = env.authenticatedContext('pharma-owner-5', { role: 'pharmacist' }).firestore();
  await assertSucceeds(getDoc(doc(pharma, 'mc_sales', 'SALE-4')));
});

test('mc_sales : admin conserve un accès global (non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_sales', 'SALE-5', { sid: 'SALE-5', total: '40.00', pharmacyUid: 'pharma-owner-6' });
  const admin = env.authenticatedContext('root-admin-1', { role: 'admin' }).firestore();
  await assertSucceeds(getDoc(doc(admin, 'mc_sales', 'SALE-5')));
});

/* ── v2.9.34 (P1) : pharmacyUid immuable sur mc_medicines/mc_sales ── */

test("mc_medicines : le propriétaire NE PEUT PAS réattribuer pharmacyUid à un autre pharmacien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-IMM-1', { mid: 'MED-IMM-1', name: 'Stock', stock: '10', pharmacyUid: 'pharma-owner-7' });
  const owner = env.authenticatedContext('pharma-owner-7', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(owner, 'mc_medicines', 'MED-IMM-1'), {
    mid: 'MED-IMM-1', name: 'Stock', stock: '9', pharmacyUid: 'autre-pharma',
  }));
});

test("mc_medicines : le propriétaire peut décrémenter SON stock (pharmacyUid inchangé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-IMM-2', { mid: 'MED-IMM-2', name: 'Stock', stock: '10', pharmacyUid: 'pharma-owner-8' });
  const owner = env.authenticatedContext('pharma-owner-8', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(owner, 'mc_medicines', 'MED-IMM-2'), {
    mid: 'MED-IMM-2', name: 'Stock', stock: '7', pharmacyUid: 'pharma-owner-8',
  }));
});

test("mc_medicines : une fiche legacy (sans pharmacyUid) peut se voir attribuer celui du propriétaire réel (backfill), jamais celui d'un tiers", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_medicines', 'MED-IMM-3', { mid: 'MED-IMM-3', name: 'Legacy', stock: '4' });
  const claimer = env.authenticatedContext('pharma-claimer-1', { role: 'pharmacist' }).firestore();
  await assertSucceeds(setDoc(doc(claimer, 'mc_medicines', 'MED-IMM-3'), {
    mid: 'MED-IMM-3', name: 'Legacy', stock: '4', pharmacyUid: 'pharma-claimer-1',
  }));
  await seedDoc(env, 'mc_medicines', 'MED-IMM-4', { mid: 'MED-IMM-4', name: 'Legacy2', stock: '4' });
  await assertFails(setDoc(doc(claimer, 'mc_medicines', 'MED-IMM-4'), {
    mid: 'MED-IMM-4', name: 'Legacy2', stock: '4', pharmacyUid: 'un-tiers',
  }));
});

test("mc_sales : le propriétaire NE PEUT PAS réattribuer une vente à un autre pharmacien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedDoc(env, 'mc_sales', 'SALE-IMM-1', { sid: 'SALE-IMM-1', total: '10.00', pharmacyUid: 'pharma-owner-9' });
  const owner = env.authenticatedContext('pharma-owner-9', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(owner, 'mc_sales', 'SALE-IMM-1'), {
    sid: 'SALE-IMM-1', total: '10.00', pharmacyUid: 'autre-pharma',
  }));
});
