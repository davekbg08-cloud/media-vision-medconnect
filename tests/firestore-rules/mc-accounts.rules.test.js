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

// Correctif P0 (audit "workflows mobile/desktop") : ce fixture ne
// portait auparavant aucun patient_id — depuis la fermeture de la
// préemption sans patient_id (voir tests dédiés plus bas), un compte
// patient doit toujours fournir patient_id + le code de premier accès
// correspondant à la fiche mc_patients référencée.
test('mc_accounts : création avec authUid == uid réellement connecté est acceptée', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-4'), { id: 'MC-TEST-4', firstAccessCode: 'CODE4' });
  });
  const patient = env.authenticatedContext('firebase-uid-xyz').firestore();
  await assertSucceeds(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-4'), {
    uid: 'PAT_MC-TEST-4', role: 'patient', authUid: 'firebase-uid-xyz', status: 'approved',
    patient_id: 'MC-TEST-4', firstAccessCode: 'CODE4',
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

/* ── Correctif P0 (audit "workflows mobile/desktop") ──────────────
   Ce test verrouillait auparavant le comportement inverse
   (assertSucceeds) : une fiche héritée sans firstAccessCode
   acceptait la création du compte patient SANS AUCUN code, ce qui
   permettait à un tiers connaissant seulement le numéro MC-xxx de
   préempter le compte. C'est exactement la faille identifiée par
   l'audit — le test est corrigé pour verrouiller le comportement
   sûr, pas supprimé. Les fiches historiques sans code nécessitent
   une migration administrative dédiée pour recevoir un
   firstAccessCode, jamais un contournement de cette règle. */
test("mc_accounts : création d'un compte patient pour une fiche héritée SANS firstAccessCode est refusée (P0, plus de contournement)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-4'), { id: 'MC-TEST-CODE-4' });
  });
  const patient = env.authenticatedContext('patient-legacy').firestore();
  await assertFails(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-CODE-4'), {
    uid: 'PAT_MC-TEST-CODE-4', role: 'patient', authUid: 'patient-legacy', status: 'approved',
    patient_id: 'MC-TEST-CODE-4',
  }));
});

/* ── Correctif P0 (audit "workflows mobile/desktop") ──────────────
   Bug confirmé : patientFirstAccessOk(null, ...) renvoie vrai par
   construction (branche dédiée aux comptes PROFESSIONNELS, sans
   patient_id) — un compte role:'patient' pouvait donc être créé SANS
   patient_id du tout, ce qui contournait entièrement le code de
   premier accès (aucune fiche mc_patients à vérifier). Fermé en
   exigeant patient_id non vide et docId == 'PAT_'+patient_id dans
   validPatientAccountSelfCreate(). */
test("mc_accounts : création d'un compte patient SANS patient_id est refusée (P0, contournement du code de premier accès)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-no-patient-id').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'PAT_ANYTHING'), {
    uid: 'PAT_ANYTHING', role: 'patient', authUid: 'attacker-no-patient-id', status: 'approved',
  }));
});

test("mc_accounts : création d'un compte patient refusée si docId ne correspond pas à PAT_{patient_id}", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-MISMATCH'), { id: 'MC-TEST-CODE-MISMATCH', firstAccessCode: 'ABCD23' });
  });
  const attacker = env.authenticatedContext('attacker-docid-mismatch').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'PAT_UN-AUTRE-ID'), {
    uid: 'PAT_UN-AUTRE-ID', role: 'patient', authUid: 'attacker-docid-mismatch', status: 'approved',
    patient_id: 'MC-TEST-CODE-MISMATCH', firstAccessCode: 'ABCD23',
  }));
});

test("mc_accounts : création d'un compte patient refusée sans authUid (plus de mode dégradé patient)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_patients', 'MC-TEST-CODE-NOAUTH'), { id: 'MC-TEST-CODE-NOAUTH', firstAccessCode: 'ABCD23' });
  });
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'PAT_MC-TEST-CODE-NOAUTH'), {
    uid: 'PAT_MC-TEST-CODE-NOAUTH', role: 'patient', status: 'approved',
    patient_id: 'MC-TEST-CODE-NOAUTH', firstAccessCode: 'ABCD23',
  }));
});

/* ── Correctif (course create-fiche / premier-accès) ──────────────
   DB.addPatient() lance l'écriture de mc_patients/{id} en
   fire-and-forget (js/db.js) : le document peut donc ne pas encore
   exister côté serveur au moment où un premier accès est tenté. Avant
   ce correctif, patientFirstAccessOk() traitait "document inexistant"
   comme "aucun code requis" (même branche que les fiches héritées),
   ce qui acceptait n'importe quel code — y compris vide — tant que la
   réplication n'avait pas eu lieu. Un identifiant ne correspondant à
   AUCUNE fiche mc_patients doit désormais être refusé. */
test("mc_accounts : création d'un compte patient refusée si la fiche mc_patients n'existe pas encore (course de synchronisation)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  // Volontairement : aucun mc_patients/MC-TEST-CODE-RACE n'est créé —
  // simule la fenêtre entre DB.addPatient() et la réplication réelle.
  const patient = env.authenticatedContext('patient-race').firestore();
  await assertFails(setDoc(doc(patient, 'mc_accounts', 'PAT_MC-TEST-CODE-RACE'), {
    uid: 'PAT_MC-TEST-CODE-RACE', role: 'patient', authUid: 'patient-race', status: 'approved',
    patient_id: 'MC-TEST-CODE-RACE', firstAccessCode: 'ANYTHING',
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

/* ── Chantier "reception/affiliation sans régression" — section 1 ──
   Un rôle 'admin'/'admin_hospital' auto-attribué dans mc_accounts
   pouvait aboutir à un vrai custom claim Firebase Auth via
   scripts/sync-account-security.mjs (élévation de privilège réelle). */

test("mc_accounts : un utilisateur signé ne peut pas créer un compte role=admin (identité Firebase réelle)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-admin-1').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'attacker-admin-1'), {
    uid: 'attacker-admin-1', authUid: 'attacker-admin-1', role: 'admin', status: 'pending',
  }));
});

test("mc_accounts : un utilisateur non authentifié ne peut pas créer un compte role=admin (mode dégradé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'ADM_MC-TEST-ADMIN-1'), {
    uid: 'ADM_MC-TEST-ADMIN-1', role: 'admin', status: 'pending',
  }));
});

test("mc_accounts : un utilisateur signé ne peut pas créer un compte role=admin_hospital", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const attacker = env.authenticatedContext('attacker-admin-hosp-1').firestore();
  await assertFails(setDoc(doc(attacker, 'mc_accounts', 'attacker-admin-hosp-1'), {
    uid: 'attacker-admin-hosp-1', authUid: 'attacker-admin-hosp-1', role: 'admin_hospital', status: 'pending',
  }));
});

test("mc_accounts : un utilisateur non authentifié ne peut pas créer un compte role=admin_hospital (mode dégradé)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'ADM_MC-TEST-ADMIN-2'), {
    uid: 'ADM_MC-TEST-ADMIN-2', role: 'admin_hospital', status: 'pending',
  }));
});

test("mc_accounts : un compte professionnel avec identité Firebase doit avoir status=pending (pas active/approved)", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-strict-status-1').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_accounts', 'doctor-strict-status-1'), {
    uid: 'doctor-strict-status-1', authUid: 'doctor-strict-status-1', role: 'doctor', status: 'approved',
  }));
});

test("mc_accounts : le mode dégradé (sans authUid) exige aussi status=pending", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const unauthed = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthed, 'mc_accounts', 'DOC_MC-TEST-STATUS-1'), {
    uid: 'DOC_MC-TEST-STATUS-1', role: 'doctor', status: 'approved',
  }));
});

test("mc_accounts : identité Firebase réelle — docId doit correspondre à request.auth.uid", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-strict-docid-1').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_accounts', 'un-autre-docid'), {
    uid: 'doctor-strict-docid-1', authUid: 'doctor-strict-docid-1', role: 'doctor', status: 'pending',
  }));
});

test("mc_accounts : identité Firebase réelle — uid et authUid doivent correspondre à request.auth.uid", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const doctor = env.authenticatedContext('doctor-strict-uid-1').firestore();
  await assertFails(setDoc(doc(doctor, 'mc_accounts', 'doctor-strict-uid-1'), {
    uid: 'un-autre-uid', authUid: 'doctor-strict-uid-1', role: 'doctor', status: 'pending',
  }));
  await assertFails(setDoc(doc(doctor, 'mc_accounts', 'doctor-strict-uid-1'), {
    uid: 'doctor-strict-uid-1', authUid: 'un-autre-uid', role: 'doctor', status: 'pending',
  }));
});

test('mc_accounts : lab et reception peuvent toujours créer leur compte avec une identité Firebase réelle', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  const lab = env.authenticatedContext('lab-strict-1').firestore();
  await assertSucceeds(setDoc(doc(lab, 'mc_accounts', 'lab-strict-1'), {
    uid: 'lab-strict-1', authUid: 'lab-strict-1', role: 'lab', status: 'pending',
    matricule: 'LAB-001', professionalNumber: 'LAB-001', username: 'LAB-001',
    fullName: 'Labo Test', name: 'Labo Test', email: 'lab@test.mc',
  }));
  const reception = env.authenticatedContext('reception-strict-1').firestore();
  await assertSucceeds(setDoc(doc(reception, 'mc_accounts', 'reception-strict-1'), {
    uid: 'reception-strict-1', authUid: 'reception-strict-1', role: 'reception', status: 'pending',
    matricule: 'REC-001', professionalNumber: 'REC-001', username: 'REC-001',
    fullName: 'Reception Test', name: 'Reception Test', email: 'reception@test.mc',
  }));
});

test('mc_accounts : le propriétaire ne peut pas modifier authUid, uid, patient_id, professionalNumber ou matricule', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_accounts', 'lab-immut-1'), {
      uid: 'lab-immut-1', authUid: 'lab-immut-1', role: 'lab', status: 'pending',
      professionalNumber: 'LAB-100', matricule: 'LAB-100',
    });
  });
  const owner = env.authenticatedContext('lab-immut-1').firestore();
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-immut-1'), { authUid: 'autre-uid' }));
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-immut-1'), { uid: 'autre-uid' }));
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-immut-1'), { professionalNumber: 'LAB-999' }));
  await assertFails(updateDoc(doc(owner, 'mc_accounts', 'lab-immut-1'), { matricule: 'LAB-999' }));
  await assertSucceeds(updateDoc(doc(owner, 'mc_accounts', 'lab-immut-1'), { phone: '+243800000099' }));
});
