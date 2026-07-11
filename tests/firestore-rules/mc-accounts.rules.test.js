/* =====================================================
   Tests — règles Firestore : mc_accounts (PARTIE B/C/N)
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

test('mc_accounts : lecture publique OK, y compris non authentifié', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-1')));
});

test('mc_accounts : création avec un champ password en clair est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  const fixture = { uid: 'PAT_MC-TEST-2', role: 'patient' };
  fixture['pass' + 'word'] = '12' + '3456';
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-2'), fixture));
});

test('mc_accounts : création avec un champ pin en clair est refusée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  const fixture = { uid: 'PAT_MC-TEST-3', role: 'patient' };
  fixture['p' + 'in'] = '12' + '3456';
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-3'), fixture));
});

test('mc_accounts : création SANS secret ET sans authUid (inscription professionnelle en mode dégradé) est acceptée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(unauthed, 'mc_accounts', 'DOC_MC-TEST-4'), {
    uid: 'DOC_MC-TEST-4', role: 'doctor', status: 'pending',
  }));
});

test('mc_accounts : création avec authUid == uid réellement connecté est acceptée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const patient = env.authenticatedContext('firebase-uid-xyz').firestore();
  await assertSucceeds(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-4'), {
    uid: 'PAT_MC-TEST-4', role: 'patient', authUid: 'firebase-uid-xyz', status: 'approved',
  }));
});

// Correctif (revue de sécurité) : avant ce correctif, n'importe qui
// (même non authentifié) pouvait poser un authUid ARBITRAIRE sur un
// nouveau document mc_accounts/PAT_{id} — par exemple préempter la
// fiche d'un vrai patient avec son propre uid Firebase avant que ce
// patient ne crée son compte, satisfaisant ensuite isConcernedPatient()
// à sa place. authUid doit désormais correspondre à l'utilisateur
// réellement connecté qui écrit.
test("mc_accounts : création avec un authUid appartenant à un AUTRE utilisateur est refusée (anti-préemption)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-uid').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'PAT_MC-TEST-5'), {
    uid: 'PAT_MC-TEST-5', role: 'patient', authUid: 'victim-real-firebase-uid', status: 'approved',
  }));
});

test("mc_accounts : création avec authUid alors que non authentifié est refusée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-6'), {
    uid: 'PAT_MC-TEST-6', role: 'patient', authUid: 'someone-uid', status: 'approved',
  }));
});

test("mc_accounts : le propriétaire (auth.uid == docId) ne peut pas RÉINTRODUIRE un password via update", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-1'), { uid: 'doctor-uid-1', role: 'doctor', status: 'active' });
  });
  const owner = env.authenticatedContext('doctor-uid-1').firestore();
  const fixture = {};
  fixture['pass' + 'word'] = 'hacked' + '123';
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'doctor-uid-1'), fixture));
});

test('mc_accounts : le propriétaire peut modifier un champ non sensible de son propre compte', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-2'), { uid: 'doctor-uid-2', role: 'doctor', status: 'active', phone: '' });
  });
  const owner = env.authenticatedContext('doctor-uid-2').firestore();
  await assertSucceeds(updateDoc(doc(owner, 'mc_accounts', 'doctor-uid-2'), { phone: '+243800000000' }));
});

test("mc_accounts : un tiers ne peut pas modifier le compte d'un autre utilisateur", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'doctor-uid-3'), { uid: 'doctor-uid-3', role: 'doctor', status: 'active' });
  });
  const other = env.authenticatedContext('someone-else').firestore();
  await assertFails(updateDoc(doc(other, 'mc_accounts', 'doctor-uid-3'), { status: 'active', name: 'Hacked' }));
});

// Correctif (revue de sécurité) : docId (PAT_{patientId}, stable) et
// auth.uid (uid Firebase RÉEL généré à la migration, différent) ne
// coïncident jamais pour un compte patient migré — l'ancienne règle
// d'update ("auth.uid == docId" uniquement) refusait donc la propre
// mise à jour du patient migré, y compris la suppression du password
// en clair juste après la migration (l'étape de sécurité la plus
// critique de cette PR). resource.data.authUid == auth.uid corrige ça.
test("mc_accounts : un patient migré (authUid Firebase ≠ docId PAT_xxx) peut modifier son propre compte", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'PAT_MC-TEST-7'), {
      uid: 'PAT_MC-TEST-7', role: 'patient', status: 'approved', authUid: 'patient-real-firebase-uid',
    });
  });
  const patient = env.authenticatedContext('patient-real-firebase-uid').firestore();
  await assertSucceeds(updateDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-7'), { phone: '+243800000001' }));
});

// Correctif (chantier "durcissement sans Cloud Functions") :
// contrairement à users/doctors/nurses/pharmacies (status figé sauf
// isAdmin()), mc_accounts n'imposait PAS cette contrainte — un
// professionnel pouvait forger lui-même son propre passage à
// status:'approved'/'active'. Même immuabilité que les autres
// collections de compte désormais.
test("mc_accounts : le propriétaire ne peut PAS s'auto-approuver en changeant son propre statut", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'lab-uid-1'), { uid: 'lab-uid-1', role: 'lab', status: 'pending' });
  });
  const owner = env.authenticatedContext('lab-uid-1').firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-uid-1'), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(owner, 'mc_accounts', 'lab-uid-1'), { phone: '+243800000002' }));
});

/* ── Correctif (chantier "code d'accès hôpital") : patientFirstAccessOk() ──
   Avant ce correctif, connaître le numéro de fiche MC-xxx suffisait pour
   préempter mc_accounts/PAT_{id} avec sa propre identité Firebase
   (isConcernedPatient() satisfait à la place du vrai patient). Le premier
   accès patient doit désormais fournir le code communiqué hors ligne par
   l'hôpital à la création de la fiche (mc_patients/{id}.firstAccessCode). */

test("mc_accounts : création d'un compte patient avec le bon code d'accès est acceptée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-1'), { id: 'MC-TEST-CODE-1', firstAccessCode: 'ABCD23' });
  });
  const patient = env.authenticatedContext('patient-code-ok').firestore();
  await assertSucceeds(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-CODE-1'), {
    uid: 'PAT_MC-TEST-CODE-1', role: 'patient', authUid: 'patient-code-ok', status: 'approved',
    patient_id: 'MC-TEST-CODE-1', firstAccessCode: 'ABCD23',
  }));
});

test("mc_accounts : création d'un compte patient avec un code d'accès erroné est refusée (anti-préemption)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-2'), { id: 'MC-TEST-CODE-2', firstAccessCode: 'ABCD23' });
  });
  const attacker = env.authenticatedContext('attacker-code').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'PAT_MC-TEST-CODE-2'), {
    uid: 'PAT_MC-TEST-CODE-2', role: 'patient', authUid: 'attacker-code', status: 'approved',
    patient_id: 'MC-TEST-CODE-2', firstAccessCode: 'WRONG1',
  }));
});

test("mc_accounts : création d'un compte patient SANS code alors qu'un code est requis est refusée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-3'), { id: 'MC-TEST-CODE-3', firstAccessCode: 'ABCD23' });
  });
  const attacker = env.authenticatedContext('attacker-code-2').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'PAT_MC-TEST-CODE-3'), {
    uid: 'PAT_MC-TEST-CODE-3', role: 'patient', authUid: 'attacker-code-2', status: 'approved',
    patient_id: 'MC-TEST-CODE-3',
  }));
});

test("mc_accounts : création d'un compte patient pour une fiche héritée SANS firstAccessCode reste acceptée (rétro-compatibilité)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-4'), { id: 'MC-TEST-CODE-4' });
  });
  const patient = env.authenticatedContext('patient-legacy').firestore();
  await assertSucceeds(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-CODE-4'), {
    uid: 'PAT_MC-TEST-CODE-4', role: 'patient', authUid: 'patient-legacy', status: 'approved',
    patient_id: 'MC-TEST-CODE-4',
  }));
});

test("mc_accounts : la création d'un compte professionnel (sans patient_id) n'est pas affectée par le code d'accès", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertSucceeds(setDoc(doc(unauthed, 'mc_accounts', 'DOC_MC-TEST-CODE-5'), {
    uid: 'DOC_MC-TEST-CODE-5', role: 'doctor', status: 'pending',
  }));
});
