/* =====================================================
   Tests — règles Firestore : durcissement du workflow laboratoire
   (chantier "modales laboratoire", fix/desktop-lab-modal-workflow)

   Avant ce chantier :
   - labRequests.create n'exigeait AUCUN rôle (n'importe quel compte
     signé, y compris un laborantin ou un patient, pouvait créer une
     demande d'analyse) ;
   - labRequests.update n'exigeait NI rôle, NI établissement, NI
     restriction de champs (un laborantin non affilié pouvait modifier
     N'IMPORTE QUELLE demande de N'IMPORTE QUEL hôpital, y compris ses
     champs d'identification) ;
   - labResults.update utilisait la même clause permissive que create
     (canEnterLabResult() seul), sans isolation par établissement.

   Ces tests verrouillent le nouveau contrat : canRequestLab()/
   canEnterLabResult() + belongsToSameEstablishment() + champs/
   transitions restreints (labRequestUpdateKeysOk/labStatusTransitionOk).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc } = require('firebase/firestore');
const { getTestEnv, clearAll, seed } = require('./helpers');

async function seedMember(env, hospitalId, uid, role, status = 'active') {
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'hospitalMembers', `${hospitalId}_${uid}`), { hospitalId, uid, role, status });
  });
}

async function seedRequest(env, id, data) {
  await seed(env, async (db, doc, setDoc) => {
    await setDoc(doc(db, 'labRequests', id), data);
  });
}

// 23. lab non affilié ne peut pas lire les demandes d'un hôpital.
test("23. labRequests : lab NON affilié à l'établissement ne peut pas lire une demande", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-OTHER', 'lab-23', 'lab');
  await seedRequest(env, 'LR-23', { patientMc: 'MC-23', establishmentId: 'HOSP-23', status: 'requested' });
  const lab = env.authenticatedContext('lab-23', { role: 'lab' }).firestore();
  await assertFails(getDoc(doc(lab, 'labRequests', 'LR-23')));
});

// 24. lab affilié peut lire les demandes de son hôpital.
test("24. labRequests : lab affilié à l'établissement peut lire ses demandes", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-24', 'lab-24', 'lab');
  await seedRequest(env, 'LR-24', { patientMc: 'MC-24', establishmentId: 'HOSP-24', status: 'requested' });
  const lab = env.authenticatedContext('lab-24', { role: 'lab' }).firestore();
  await assertSucceeds(getDoc(doc(lab, 'labRequests', 'LR-24')));
});

// 25. lab affilié à un établissement ne peut pas écrire (mettre à jour)
// une demande d'un AUTRE établissement.
test("25. labRequests : lab affilié à HOSP-A ne peut pas modifier une demande de HOSP-B", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-A', 'lab-25', 'lab');
  await seedRequest(env, 'LR-25', {
    patientMc: 'MC-25', establishmentId: 'HOSP-B', status: 'requested',
    requestedByUid: 'doctor-25', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-25', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(lab, 'labRequests', 'LR-25'), { status: 'in_progress' }));
});

// 26. reception ne peut ni créer ni modifier labRequests.
test('26. labRequests : reception ne peut pas créer une demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-26', 'reception-26', 'reception');
  const reception = env.authenticatedContext('reception-26', { role: 'reception' }).firestore();
  await assertFails(setDoc(doc(reception, 'labRequests', 'LR-26'), {
    patientMc: 'MC-26', establishmentId: 'HOSP-26', status: 'requested',
    requestedByUid: 'reception-26', requestedByRole: 'reception',
  }));
});

test('26bis. labRequests : reception ne peut pas modifier une demande existante', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-26B', 'reception-26b', 'reception');
  await seedRequest(env, 'LR-26B', {
    patientMc: 'MC-26B', establishmentId: 'HOSP-26B', status: 'requested',
    requestedByUid: 'doctor-26b', requestedByRole: 'doctor',
  });
  const reception = env.authenticatedContext('reception-26b', { role: 'reception' }).firestore();
  await assertFails(updateDoc(doc(reception, 'labRequests', 'LR-26B'), { status: 'in_progress' }));
});

// 27. pharmacist ne peut ni créer ni modifier labRequests.
test('27. labRequests : pharmacist ne peut pas créer une demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-27', 'pharma-27', 'pharmacist');
  const pharmacist = env.authenticatedContext('pharma-27', { role: 'pharmacist' }).firestore();
  await assertFails(setDoc(doc(pharmacist, 'labRequests', 'LR-27'), {
    patientMc: 'MC-27', establishmentId: 'HOSP-27', status: 'requested',
    requestedByUid: 'pharma-27', requestedByRole: 'pharmacist',
  }));
});

test('27bis. labRequests : pharmacist ne peut pas modifier une demande existante', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-27B', 'pharma-27b', 'pharmacist');
  await seedRequest(env, 'LR-27B', {
    patientMc: 'MC-27B', establishmentId: 'HOSP-27B', status: 'requested',
    requestedByUid: 'doctor-27b', requestedByRole: 'doctor',
  });
  const pharmacist = env.authenticatedContext('pharma-27b', { role: 'pharmacist' }).firestore();
  await assertFails(updateDoc(doc(pharmacist, 'labRequests', 'LR-27B'), { status: 'in_progress' }));
});

// 28. patient ne peut pas modifier une demande.
test('28. labRequests : un patient ne peut pas modifier une demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedRequest(env, 'LR-28', {
    patientMc: 'MC-28', establishmentId: 'HOSP-28', status: 'requested',
    requestedByUid: 'doctor-28', requestedByRole: 'doctor',
  });
  const patient = env.authenticatedContext('patient-28').firestore();
  await assertFails(updateDoc(doc(patient, 'labRequests', 'LR-28'), { status: 'in_progress' }));
});

// 29. doctor/nurse affilié peut créer une demande.
test('29. labRequests : doctor affilié peut créer une demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-29', 'doctor-29', 'doctor');
  const doctor = env.authenticatedContext('doctor-29', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'labRequests', 'LR-29'), {
    patientMc: 'MC-29', establishmentId: 'HOSP-29', status: 'requested',
    requestedByUid: 'doctor-29', requestedByRole: 'doctor',
  }));
});

test('29bis. labRequests : nurse affilié peut créer une demande', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-29B', 'nurse-29b', 'nurse');
  const nurse = env.authenticatedContext('nurse-29b', { role: 'nurse' }).firestore();
  await assertSucceeds(setDoc(doc(nurse, 'labRequests', 'LR-29B'), {
    patientMc: 'MC-29B', establishmentId: 'HOSP-29B', status: 'requested',
    requestedByUid: 'nurse-29b', requestedByRole: 'nurse',
  }));
});

// 30. le statut initial doit être requested.
test("30. labRequests : une création avec un statut initial différent de 'requested' est refusée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-30', 'doctor-30', 'doctor');
  const doctor = env.authenticatedContext('doctor-30', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'labRequests', 'LR-30'), {
    patientMc: 'MC-30', establishmentId: 'HOSP-30', status: 'completed',
    requestedByUid: 'doctor-30', requestedByRole: 'doctor',
  }));
});

// 31. patientMc et establishmentId deviennent immuables après création.
test('31. labRequests : patientMc ne peut pas être modifié après création', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-31', 'lab-31', 'lab');
  await seedRequest(env, 'LR-31', {
    patientMc: 'MC-31', establishmentId: 'HOSP-31', status: 'requested',
    requestedByUid: 'doctor-31', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-31', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(lab, 'labRequests', 'LR-31'), { patientMc: 'MC-31-ALTERED' }));
});

test('31bis. labRequests : establishmentId ne peut pas être modifié après création', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-31B', 'lab-31b', 'lab');
  await seedRequest(env, 'LR-31B', {
    patientMc: 'MC-31B', establishmentId: 'HOSP-31B', status: 'requested',
    requestedByUid: 'doctor-31b', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-31b', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(lab, 'labRequests', 'LR-31B'), { establishmentId: 'HOSP-STOLEN' }));
});

// 32. seules les transitions de statut autorisées sont acceptées.
test('32. labRequests : la transition requested -> in_progress est acceptée (laborantin affilié)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-32', 'lab-32', 'lab');
  await seedRequest(env, 'LR-32', {
    patientMc: 'MC-32', establishmentId: 'HOSP-32', status: 'requested',
    requestedByUid: 'doctor-32', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-32', { role: 'lab' }).firestore();
  await assertSucceeds(updateDoc(doc(lab, 'labRequests', 'LR-32'), { status: 'in_progress' }));
});

test('32bis. labRequests : la transition completed -> requested est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-32B', 'lab-32b', 'lab');
  await seedRequest(env, 'LR-32B', {
    patientMc: 'MC-32B', establishmentId: 'HOSP-32B', status: 'completed',
    requestedByUid: 'doctor-32b', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-32b', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(lab, 'labRequests', 'LR-32B'), { status: 'requested' }));
});

test('32ter. labRequests : la transition requested -> completed (en sautant in_progress) est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-32C', 'lab-32c', 'lab');
  await seedRequest(env, 'LR-32C', {
    patientMc: 'MC-32C', establishmentId: 'HOSP-32C', status: 'requested',
    requestedByUid: 'doctor-32c', requestedByRole: 'doctor',
  });
  const lab = env.authenticatedContext('lab-32c', { role: 'lab' }).firestore();
  await assertFails(updateDoc(doc(lab, 'labRequests', 'LR-32C'), {
    status: 'completed', value: '1.0', completedByUid: 'lab-32c',
  }));
});
