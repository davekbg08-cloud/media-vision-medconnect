/* =====================================================
   Tests — règles Firestore : approbation d'affiliation par
   admin_hospital (chantier "sécurité/réception/affiliation sans
   régression", section 8-9)

   Bug confirmé avant correctif : le tableau de bord desktop hôpital
   affichait les boutons "Approuver"/"Refuser" à admin_hospital, mais
   affiliation_requests.update était réservé à isAdmin() seul — la
   décision échouait toujours silencieusement pour admin_hospital.
   Ces tests verrouillent canManageAffiliation(), la restriction des
   champs modifiables (affiliationDecisionFieldsOk), l'exigence
   decidedByUid/decidedByRole, ainsi que le branchement admin_hospital
   ajouté à hospitalMembers pour activer le membre approuvé.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seed(env, collectionName, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collectionName, id), data);
  });
}

// admin_hospital de HOSP-A : users/{uid}.role = admin_hospital, statut
// approuvé, et lui-même membre actif de HOSP-A (isHospitalMember).
async function seedAdminHospital(env, uid, hospitalId) {
  await seed(env, 'users', uid, { role: 'admin_hospital', status: 'approved' });
  await seed(env, 'hospitalMembers', `${hospitalId}_${uid}`, { hospitalId, uid, status: 'active' });
}

test("affiliation_requests : admin_hospital lit les demandes pending de SON établissement", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-1', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-1_HOSP-A', {
    requesterUid: 'doc-1', establishmentId: 'HOSP-A', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-1').firestore();
  await assertSucceeds(getDoc(doc(ah, 'affiliation_requests', 'AFF_doc-1_HOSP-A')));
});

test("affiliation_requests : admin_hospital NE lit PAS les demandes d'un AUTRE établissement", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-2', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-2_HOSP-B', {
    requesterUid: 'doc-2', establishmentId: 'HOSP-B', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-2').firestore();
  await assertFails(getDoc(doc(ah, 'affiliation_requests', 'AFF_doc-2_HOSP-B')));
});

test("affiliation_requests : admin_hospital APPROUVE une demande pending de son établissement (champs de décision uniquement)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-3', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-3_HOSP-A', {
    requesterUid: 'doc-3', requesterRole: 'doctor', establishmentId: 'HOSP-A',
    professionalNumber: 'MED-123', status: 'pending', createdAt: '2026-01-01',
  });
  const ah = env.authenticatedContext('ah-3').firestore();
  await assertSucceeds(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-3_HOSP-A'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'ah-3', decidedByRole: 'admin_hospital',
  }));
});

test("affiliation_requests : admin_hospital REFUSE une demande pending d'un AUTRE établissement (anti-élévation inter-établissement)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-4', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-4_HOSP-B', {
    requesterUid: 'doc-4', establishmentId: 'HOSP-B', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-4').firestore();
  await assertFails(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-4_HOSP-B'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'ah-4', decidedByRole: 'admin_hospital',
  }));
});

test("affiliation_requests : admin_hospital NE PEUT PAS redécider une demande déjà tranchée (transition depuis 'approved' refusée)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-5', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-5_HOSP-A', {
    requesterUid: 'doc-5', establishmentId: 'HOSP-A', status: 'approved',
  });
  const ah = env.authenticatedContext('ah-5').firestore();
  await assertFails(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-5_HOSP-A'), {
    status: 'rejected', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'ah-5', decidedByRole: 'admin_hospital',
  }));
});

test("affiliation_requests : admin_hospital NE PEUT PAS modifier requesterUid/establishmentId/professionalNumber lors de la décision", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-6', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-6_HOSP-A', {
    requesterUid: 'doc-6', establishmentId: 'HOSP-A', professionalNumber: 'MED-1', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-6').firestore();
  await assertFails(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-6_HOSP-A'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'ah-6', decidedByRole: 'admin_hospital',
    professionalNumber: 'MED-999',
  }));
});

test("affiliation_requests : admin_hospital NE PEUT PAS s'attribuer la décision d'un AUTRE acteur (decidedByUid usurpé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-7', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-7_HOSP-A', {
    requesterUid: 'doc-7', establishmentId: 'HOSP-A', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-7').firestore();
  await assertFails(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-7_HOSP-A'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'someone-else', decidedByRole: 'admin_hospital',
  }));
});

test("affiliation_requests : admin_hospital NE PEUT PAS mentir sur decidedByRole (rôle réel toujours admin_hospital)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-8', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-8_HOSP-A', {
    requesterUid: 'doc-8', establishmentId: 'HOSP-A', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-8').firestore();
  await assertFails(updateDoc(doc(ah, 'affiliation_requests', 'AFF_doc-8_HOSP-A'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
    decidedByUid: 'ah-8', decidedByRole: 'admin',
  }));
});

test('affiliation_requests : admin plateforme conserve son accès global (déjà existant, non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seed(env, 'users', 'root-admin', { role: 'admin', status: 'approved' });
  await seed(env, 'affiliation_requests', 'AFF_doc-9_HOSP-Z', {
    requesterUid: 'doc-9', establishmentId: 'HOSP-Z', status: 'pending',
  });
  const admin = env.authenticatedContext('root-admin').firestore();
  await assertSucceeds(updateDoc(doc(admin, 'affiliation_requests', 'AFF_doc-9_HOSP-Z'), {
    status: 'approved', updatedAt: '2026-01-02', decided_at: '2026-01-02',
  }));
});

/* ── hospitalMembers : activation par admin_hospital après approbation ── */

test("hospitalMembers : admin_hospital active hospitalMembers du requérant APRÈS approbation (demande approved pour SON établissement)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-10', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-10_HOSP-A', {
    requesterUid: 'doc-10', establishmentId: 'HOSP-A', status: 'approved',
  });
  const ah = env.authenticatedContext('ah-10').firestore();
  await assertSucceeds(setDoc(doc(ah, 'hospitalMembers', 'HOSP-A_doc-10'), {
    hospitalId: 'HOSP-A', uid: 'doc-10', status: 'active',
  }));
});

test("hospitalMembers : admin_hospital active hospitalMembers du requérant AVANT même l'écriture du statut approved (lecture pré-batch pending acceptée)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-11', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-11_HOSP-A', {
    requesterUid: 'doc-11', establishmentId: 'HOSP-A', status: 'pending',
  });
  const ah = env.authenticatedContext('ah-11').firestore();
  await assertSucceeds(setDoc(doc(ah, 'hospitalMembers', 'HOSP-A_doc-11'), {
    hospitalId: 'HOSP-A', uid: 'doc-11', status: 'active',
  }));
});

test("hospitalMembers : admin_hospital NE PEUT PAS activer un membre SANS demande d'affiliation existante (anti-élévation d'un tiers)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-12', 'HOSP-A');
  const ah = env.authenticatedContext('ah-12').firestore();
  await assertFails(setDoc(doc(ah, 'hospitalMembers', 'HOSP-A_stranger-uid'), {
    hospitalId: 'HOSP-A', uid: 'stranger-uid', status: 'active',
  }));
});

test("hospitalMembers : admin_hospital NE PEUT PAS activer un membre pour un AUTRE établissement que le sien", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-13', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-13_HOSP-B', {
    requesterUid: 'doc-13', establishmentId: 'HOSP-B', status: 'approved',
  });
  const ah = env.authenticatedContext('ah-13').firestore();
  await assertFails(setDoc(doc(ah, 'hospitalMembers', 'HOSP-B_doc-13'), {
    hospitalId: 'HOSP-B', uid: 'doc-13', status: 'active',
  }));
});

test("hospitalMembers : admin_hospital NE PEUT PAS activer un membre dont la demande a été REJETÉE", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-14', 'HOSP-A');
  await seed(env, 'affiliation_requests', 'AFF_doc-14_HOSP-A', {
    requesterUid: 'doc-14', establishmentId: 'HOSP-A', status: 'rejected',
  });
  const ah = env.authenticatedContext('ah-14').firestore();
  await assertFails(setDoc(doc(ah, 'hospitalMembers', 'HOSP-A_doc-14'), {
    hospitalId: 'HOSP-A', uid: 'doc-14', status: 'active',
  }));
});

test("hospitalMembers : admin_hospital lit les membres de SON établissement même sans en être le titulaire", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-15', 'HOSP-A');
  await seed(env, 'hospitalMembers', 'HOSP-A_doc-15', { hospitalId: 'HOSP-A', uid: 'doc-15', status: 'active' });
  const ah = env.authenticatedContext('ah-15').firestore();
  await assertSucceeds(getDoc(doc(ah, 'hospitalMembers', 'HOSP-A_doc-15')));
});

test("hospitalMembers : admin_hospital NE lit PAS les membres d'un AUTRE établissement", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedAdminHospital(env, 'ah-16', 'HOSP-A');
  await seed(env, 'hospitalMembers', 'HOSP-B_doc-16', { hospitalId: 'HOSP-B', uid: 'doc-16', status: 'active' });
  const ah = env.authenticatedContext('ah-16').firestore();
  await assertFails(getDoc(doc(ah, 'hospitalMembers', 'HOSP-B_doc-16')));
});
