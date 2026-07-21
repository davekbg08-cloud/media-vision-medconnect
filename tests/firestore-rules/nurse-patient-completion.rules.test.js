/* =====================================================
   Tests — règles Firestore : complétion médicale d'une fiche créée par
   une infirmière (chantier v2.9.36)

   Le médecin n'a AUCUN droit update général sur mc_patients. La seule
   exception est la transition ULTRA-limitée awaiting_doctor/pending →
   active/completed (doctorCanCompleteNurseCreatedPatient) : elle ne peut
   changer QUE les champs de complétion, exige une consultation réelle
   confirmée appartenant au médecin pour ce patient et cet établissement,
   et préserve l'identité, la traçabilité infirmière et l'historique.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

const DOCTOR = 'doc-1';
const EST = 'EST-1';
const PID = 'MC-P1';

function basePatient(over = {}) {
  return {
    id: PID, firstname: 'Awa', lastname: 'Diallo', allergies: 'Pénicilline',
    created_by: 'nurse-1', created_by_role: 'nurse',
    nurse_uid: 'nurse-1', nurse_name: 'Inf. Kalala', nurse_registration_number: 'N123',
    establishmentId: EST, hospital_id: EST,
    status: 'awaiting_doctor', medical_completion_status: 'pending',
    ...over,
  };
}
function completionPatch(uid = DOCTOR, extra = {}) {
  return {
    status: 'active', medical_completion_status: 'completed',
    completed_by_doctor_uid: uid, completed_by_doctor_name: 'Dr House',
    completed_at: '2026-07-21T00:00:00.000Z',
    completed_by_consultation_id: 'C-1',
    updated_at: '2026-07-21T00:00:00.000Z',
    ...extra,
  };
}

// Prépare users(doctor)+hospitalMembers+consultation+patient (avec overrides).
async function seedScenario(env, { member = { hospitalId: EST, uid: DOCTOR, role: 'doctor', status: 'active' },
                                   consult = { patient_id: PID, doctor_uid: DOCTOR, establishmentId: EST },
                                   patient = basePatient(), consultId = 'C-1',
                                   seedConsult = true } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', DOCTOR), { uid: DOCTOR, role: 'doctor', status: 'approved' });
    if (member) await setDoc(doc(db, 'hospitalMembers', `${member.hospitalId}_${member.uid}`), member);
    if (seedConsult && consult) await setDoc(doc(db, 'mc_consultations', consultId), consult);
    await setDoc(doc(db, 'mc_patients', PID), patient);
  });
}
function docCtx(env, uid = DOCTOR) {
  return env.authenticatedContext(uid, { role: 'doctor' }).firestore();
}

/* ── Cas acceptés ── */

test('21/23. pending/awaiting_doctor → completed/active par un médecin autorisé avec consultation valide : accepté', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertSucceeds(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

/* ── Transitions refusées ── */

test('22. completed → pending : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { patient: basePatient({ status: 'active', medical_completion_status: 'completed' }) });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), {
    status: 'awaiting_doctor', medical_completion_status: 'pending', updated_at: '2026-07-21T01:00:00.000Z',
  }));
});

/* ── Champs interdits pendant la transition ── */

test('24. modifier le prénom pendant la transition : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { firstname: 'Piraté' })));
});

test('25. modifier les allergies pendant la transition : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { allergies: 'aucune' })));
});

test('26. modifier le numéro MC (id) : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { id: 'MC-AUTRE' })));
});

test('27. modifier created_by : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { created_by: DOCTOR })));
});

test('28. modifier nurse_uid : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { nurse_uid: DOCTOR })));
});

test('37. un champ hors liste de complétion change : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch(DOCTOR, { diagnosis: 'x' })));
});

/* ── Usurpation / cohérence ── */

test('29. completed_by_doctor_uid usurpé (≠ auth.uid) : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch('un-autre-medecin')));
});

test('30. médecin membre d\'un AUTRE établissement : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { member: { hospitalId: 'EST-2', uid: DOCTOR, role: 'doctor', status: 'active' } });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

test('31. consultation inexistante : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { seedConsult: false });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

test('32. consultation pour un AUTRE patient : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { consult: { patient_id: 'MC-AUTRE', doctor_uid: DOCTOR, establishmentId: EST } });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

test('33. consultation créée par un AUTRE médecin : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { consult: { patient_id: PID, doctor_uid: 'autre-doc', establishmentId: EST } });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

/* ── Rôles / authentification ── */

test('34. utilisateur non authentifié : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'mc_patients', PID), completionPatch()));
});

for (const role of ['nurse', 'reception', 'lab', 'pharmacist']) {
  test(`35. rôle ${role} ne peut pas compléter la fiche : refusé`, async () => {
    const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
    // uid DIFFÉRENT du médecin (dont le doc users est semé role:doctor) —
    // ce compte a le rôle non-médecin dans son jeton et aucun doc users.
    const otherUid = `agent-${role}`;
    const ctx = env.authenticatedContext(otherUid, { role }).firestore();
    await assertFails(updateDoc(doc(ctx, 'mc_patients', PID), completionPatch(otherUid)));
  });
}

test('19/36. admin_hospital ne peut pas compléter médicalement / fiche créée par médecin : refusé', async () => {
  const env = await getTestEnv(); await clearAll(env);
  await seedScenario(env, { patient: basePatient({ created_by_role: 'doctor' }) });
  await assertFails(updateDoc(doc(docCtx(env), 'mc_patients', PID), completionPatch()));
});

test('20. admin plateforme conserve son accès technique (update accepté)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedScenario(env);
  const admin = env.authenticatedContext('root-admin', { admin: true, role: 'admin' }).firestore();
  await assertSucceeds(updateDoc(doc(admin, 'mc_patients', PID), { status: 'active', updated_at: '2026-07-21T02:00:00.000Z' }));
});
