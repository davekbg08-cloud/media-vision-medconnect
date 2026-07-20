/* =====================================================
   Tests — règles Firestore : messagerie professionnelle soumise à
   l'abonnement (mc_messages)

   Découvert en auditant le dépôt : une vraie fonctionnalité de
   messagerie pro→pro existe (js/transfer_ui_patch.js, "✉️ Nouveau
   message") et était accessible depuis le desktop hôpital sans AUCUN
   contrôle d'abonnement — la règle mc_messages.create était
   `if signedIn();` seul. Correctif : seuls les messages qui portent
   explicitement un hospitalId (posé uniquement par la messagerie
   pro→pro) sont désormais soumis à hospitalCanWriteFromDevice — les
   8 autres types de notification système (rendez-vous, ordonnance,
   labo, affiliation...) ne posent jamais ce champ et restent donc
   toujours autorisés, sans régression.
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

// Chantier sécurité (section 12) : mc_messages.create exige désormais
// que l'expéditeur d'un message hospitalId-tagué soit RÉELLEMENT membre
// actif de cet établissement (avant ce correctif, seul l'abonnement
// était vérifié) — ces tests envoyaient un message "pro→pro" sans
// jamais affilier l'expéditeur, un cas non représentatif d'un vrai
// médecin (toujours membre de son propre établissement en production).
async function seedMember(env, hospitalId, uid) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalMembers', `${hospitalId}_${uid}`),
      { hospitalId, uid, status: 'active' });
  });
}

test("mc_messages : message pro→pro refusé pour un desktop dont l'abonnement hôpital est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-MSG-1');
  await seedMember(env, 'HOSP-MSG-1', 'doctor-msg-1');
  const doctor = env.authenticatedContext('doctor-msg-1', { role: 'doctor' }).firestore();
  await assertFails(setDoc(doc(doctor, 'mc_messages', 'MSG-1'), {
    to_role: 'nurse', to_id: 'nurse-msg-1', type: 'message', subject: 'Test', body: 'Test',
    hospitalId: 'HOSP-MSG-1', sourceDevice: 'desktop', fromUid: 'doctor-msg-1',
  }));
});

test("mc_messages : message pro→pro accepté pour un mobile même si l'abonnement hôpital est expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-MSG-2');
  await seedMember(env, 'HOSP-MSG-2', 'doctor-msg-2');
  const doctor = env.authenticatedContext('doctor-msg-2', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_messages', 'MSG-2'), {
    to_role: 'nurse', to_id: 'nurse-msg-2', type: 'message', subject: 'Test', body: 'Test',
    hospitalId: 'HOSP-MSG-2', sourceDevice: 'mobile', fromUid: 'doctor-msg-2',
  }));
});

test("mc_messages : message pro→pro accepté pour un desktop dont l'abonnement est actif", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-MSG-3', 'doctor-msg-3');
  const doctor = env.authenticatedContext('doctor-msg-3', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_messages', 'MSG-3'), {
    to_role: 'nurse', to_id: 'nurse-msg-3', type: 'message', subject: 'Test', body: 'Test',
    hospitalId: 'HOSP-MSG-3', sourceDevice: 'desktop', fromUid: 'doctor-msg-3',
  }));
});

test("mc_messages : notification système SANS hospitalId reste toujours autorisée (non-régression), même desktop + abonnement expiré", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-MSG-4');
  const doctor = env.authenticatedContext('doctor-msg-4', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_messages', 'MSG-4'), {
    to_role: 'patient', to_id: 'MC-MSG-4', type: 'appointment', subject: 'RDV', body: 'RDV demain',
    sourceDevice: 'desktop', fromUid: 'doctor-msg-4',
  }));
});

test("mc_messages : notification système avec hospitalId vide ('') reste toujours autorisée", async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedExpiredSubscription(env, 'HOSP-MSG-5');
  const doctor = env.authenticatedContext('doctor-msg-5', { role: 'doctor' }).firestore();
  await assertSucceeds(setDoc(doc(doctor, 'mc_messages', 'MSG-5'), {
    to_role: 'patient', to_id: 'MC-MSG-5', type: 'prescription', subject: 'Ordonnance', body: 'Prête',
    hospitalId: '', sourceDevice: 'desktop', fromUid: 'doctor-msg-5',
  }));
});
