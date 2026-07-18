/* =====================================================
   Tests — règles Firestore : séparation stricte des capacités
   lab/reception (chantier fix/lab-reception-auth-affiliation,
   section 11 "RÈGLES" du cahier des charges, points 43-50)

   Ces règles existaient déjà (hasRole(), canEnterLabResult(),
   canRegisterPatient(), canPrescribe(), accountStatusOk(),
   belongsToSameEstablishment()) — ce fichier les verrouille
   explicitement pour lab/reception, sans aucune modification de
   firestore.rules : seule la couverture de test était incomplète.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

// 43. lab pending ne peut pas écrire de résultat.
test('43. lab pending : ne peut pas écrire un résultat de laboratoire (mc_lab_results)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  // accountStatusOk() lit users/{uid}.status : un compte pending n'est
  // jamais "actif" côté règles, même avec le bon rôle dans le token.
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'lab-pending-1'), { uid: 'lab-pending-1', role: 'lab', status: 'pending' });
  });
  const lab = env.authenticatedContext('lab-pending-1', { role: 'lab' }).firestore();
  await assertFails(setDoc(doc(lab, 'mc_lab_results', 'LABR-P1'), {
    lid: 'LABR-P1', patient_id: 'MC-LABR-P1', type: 'Glycémie', value: '1.0',
  }));
});

// 44. lab approved ET affilié à l'établissement de la fiche peut écrire
// un résultat (isolation par établissement, chantier "modales
// laboratoire" : hospitalMembers + created_by désormais exigés).
test('44. lab approved et affilié : peut écrire un résultat de laboratoire', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'lab-approved-1'), { uid: 'lab-approved-1', role: 'lab', status: 'approved' });
    await setDoc(doc(db, 'hospitalMembers', 'EST-44_lab-approved-1'), {
      hospitalId: 'EST-44', uid: 'lab-approved-1', role: 'lab', status: 'active',
    });
  });
  const lab = env.authenticatedContext('lab-approved-1', { role: 'lab' }).firestore();
  await assertSucceeds(setDoc(doc(lab, 'mc_lab_results', 'LABR-A1'), {
    lid: 'LABR-A1', patient_id: 'MC-LABR-A1', type: 'Glycémie', value: '0.95',
    establishmentId: 'EST-44', created_by: 'lab-approved-1',
  }));
});

// 45. reception approved peut créer une visite d'accueil autorisée
// (mc_admissions — enregistrement d'arrivée, capacité canRegisterPatient()).
test("45. reception approved : peut créer une admission (visite d'accueil)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'reception-approved-1'), { uid: 'reception-approved-1', role: 'reception', status: 'approved' });
    // Correctif (audit sécurité) : mc_admissions exige désormais aussi
    // belongsToSameEstablishment (isolation inter-hôpitaux).
    await setDoc(doc(db, 'hospitalMembers', 'EST-45_reception-approved-1'), {
      hospitalId: 'EST-45', uid: 'reception-approved-1', role: 'reception', status: 'active',
    });
  });
  const reception = env.authenticatedContext('reception-approved-1', { role: 'reception' }).firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_admissions', 'ADM-R1'), {
    aid: 'ADM-R1', patient_id: 'MC-ADM-R1', bedId: 'B1', reason: 'Accueil', status: 'admitted',
    establishmentId: 'EST-45',
  }));
});

// reception pending : la même visite doit être refusée (statut vérifié
// côté serveur, pas seulement le rôle).
test("45bis. reception pending : ne peut pas créer d'admission", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'reception-pending-1'), { uid: 'reception-pending-1', role: 'reception', status: 'pending' });
  });
  const reception = env.authenticatedContext('reception-pending-1', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'mc_admissions', 'ADM-R2'), {
    aid: 'ADM-R2', patient_id: 'MC-ADM-R2', bedId: 'B2', reason: 'Accueil', status: 'admitted',
  }));
});

// 46. reception ne peut pas créer une ordonnance.
test('46. reception approved : ne peut pas créer une ordonnance (prescriptions)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'reception-approved-2'), { uid: 'reception-approved-2', role: 'reception', status: 'approved' });
  });
  const reception = env.authenticatedContext('reception-approved-2', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'prescriptions', 'RX-REC-1'), {
    patient_id: 'MC-RX-REC-1', doctor_uid: 'reception-approved-2', diagnosis: 'Test', medicines: [],
  }));
});

// 47. lab ne peut pas créer une ordonnance.
test('47. lab approved : ne peut pas créer une ordonnance (prescriptions)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'lab-approved-2'), { uid: 'lab-approved-2', role: 'lab', status: 'approved' });
  });
  const lab = env.authenticatedContext('lab-approved-2', { role: 'lab' }).firestore();
  await assertFails(setDoc(doc(lab, 'prescriptions', 'RX-LAB-1'), {
    patient_id: 'MC-RX-LAB-1', doctor_uid: 'lab-approved-2', diagnosis: 'Test', medicines: [],
  }));
});

// 48. Un agent (lab/reception) non affilié ne peut pas accéder aux
// données d'un établissement (hospitalMembers absent → belongsToSameEstablishment() faux).
test('48. lab approved mais NON affilié : ne peut pas lire une admission de l\'établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'lab-not-affiliated-1'), { uid: 'lab-not-affiliated-1', role: 'lab', status: 'approved' });
    // L'admission appartient à EST-OTHER ; aucun hospitalMembers pour
    // lab-not-affiliated-1 dans cet établissement.
    await setDoc(doc(db, 'admissions', 'ADM-ISO-1'), {
      aid: 'ADM-ISO-1', patient_id: 'MC-ADM-ISO-1', establishmentId: 'EST-OTHER', status: 'admitted',
    });
  });
  const lab = env.authenticatedContext('lab-not-affiliated-1', { role: 'lab' }).firestore();
  await assertFails(getDoc(doc(lab, 'admissions', 'ADM-ISO-1')));
});

test('48bis. lab approved ET affilié (hospitalMembers) : peut lire une admission de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'users', 'lab-affiliated-1'), { uid: 'lab-affiliated-1', role: 'lab', status: 'approved' });
    await setDoc(doc(db, 'hospitalMembers', 'EST-A_lab-affiliated-1'), {
      hospitalId: 'EST-A', uid: 'lab-affiliated-1', role: 'lab', status: 'active',
    });
    await setDoc(doc(db, 'admissions', 'ADM-ISO-2'), {
      aid: 'ADM-ISO-2', patient_id: 'MC-ADM-ISO-2', establishmentId: 'EST-A', status: 'admitted',
    });
  });
  const lab = env.authenticatedContext('lab-affiliated-1', { role: 'lab' }).firestore();
  await assertSucceeds(getDoc(doc(lab, 'admissions', 'ADM-ISO-2')));
});

// 49. Un utilisateur ne peut pas modifier son propre statut (lab/reception).
test('49. lab : ne peut pas passer son propre statut de pending à approved', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_accounts', 'lab-self-1'), { uid: 'lab-self-1', role: 'lab', status: 'pending' });
  });
  const owner = env.authenticatedContext('lab-self-1', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-self-1'), { status: 'approved' }));
});

test('49bis. reception : ne peut pas passer son propre statut de pending à approved', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_accounts', 'reception-self-1'), { uid: 'reception-self-1', role: 'reception', status: 'pending' });
  });
  const owner = env.authenticatedContext('reception-self-1', { role: 'reception' }).firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'reception-self-1'), { status: 'approved' }));
});

// 50. Un utilisateur ne peut pas modifier son propre rôle.
test('50. lab : ne peut pas changer son propre rôle vers doctor (élévation de privilège)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_accounts', 'lab-self-2'), { uid: 'lab-self-2', role: 'lab', status: 'approved' });
  });
  const owner = env.authenticatedContext('lab-self-2', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-self-2'), { role: 'doctor' }));
});

test('50bis. reception : ne peut pas changer son propre rôle vers lab (élévation de privilège)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'mc_accounts', 'reception-self-2'), { uid: 'reception-self-2', role: 'reception', status: 'approved' });
  });
  const owner = env.authenticatedContext('reception-self-2', { role: 'reception' }).firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'reception-self-2'), { role: 'lab' }));
});
