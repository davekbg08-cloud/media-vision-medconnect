/* =====================================================
   Tests — règles Firestore : lecture clinique restreinte par RÔLE réel
   (chantier "sécurité/réception/affiliation sans régression", section
   9/10 du cahier des charges)

   Bug confirmé : belongsToSameEstablishment() (membre actif, N'IMPORTE
   QUEL rôle) était utilisée seule comme clause de lecture sur
   mc_consultations/mc_prescriptions/mc_lab_results/labRequests/
   labResults — donnant à reception ET lab un accès en lecture au
   contenu clinique complet, alors qu'aucune capacité client
   (js/hospital-capabilities.js MATRIX) ne le prévoit. isClinicalHospitalMember()
   (doctor/nurse/admin_hospital) et labCanReadLabData() (lab, données de
   labo uniquement) remplacent désormais ce branchement sur ces 5
   collections précises — jamais ailleurs (beds/admissions/
   receptionVisits restent inchangés, reception y garde son accès
   légitime).
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

async function seedMember(env, hospitalId, uid, role) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'hospitalMembers', `${hospitalId}_${uid}`),
      { hospitalId, uid, status: 'active', role });
  });
}
async function seedDoc(env, collection, id, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), collection, id), data);
  });
}

test('mc_consultations : reception NE PEUT PAS lire une consultation de son propre établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'reception-cl-1', 'reception');
  await seedDoc(env, 'mc_consultations', 'CONS-CL-1', { patient_id: 'MC-CL-1', establishmentId: 'HOSP-CL', doctor_uid: 'doc-x' });
  const reception = env.authenticatedContext('reception-cl-1', { role: 'reception' }).firestore();
  await assertFails(getDoc(doc(reception, 'mc_consultations', 'CONS-CL-1')));
});

test('mc_consultations : doctor du même établissement lit toujours (non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'doctor-cl-1', 'doctor');
  await seedDoc(env, 'mc_consultations', 'CONS-CL-2', { patient_id: 'MC-CL-2', establishmentId: 'HOSP-CL', doctor_uid: 'doc-y' });
  const doctor = env.authenticatedContext('doctor-cl-1', { role: 'doctor' }).firestore();
  await assertSucceeds(getDoc(doc(doctor, 'mc_consultations', 'CONS-CL-2')));
});

test('mc_consultations : admin_hospital du même établissement lit toujours (non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'ah-cl-1', 'admin_hospital');
  await seedDoc(env, 'mc_consultations', 'CONS-CL-3', { patient_id: 'MC-CL-3', establishmentId: 'HOSP-CL', doctor_uid: 'doc-z' });
  const ah = env.authenticatedContext('ah-cl-1', { role: 'admin_hospital' }).firestore();
  await assertSucceeds(getDoc(doc(ah, 'mc_consultations', 'CONS-CL-3')));
});

test('mc_consultations : lab NE PEUT PAS lire une consultation (jamais eu ce droit fonctionnellement)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'lab-cl-1', 'lab');
  await seedDoc(env, 'mc_consultations', 'CONS-CL-4', { patient_id: 'MC-CL-4', establishmentId: 'HOSP-CL', doctor_uid: 'doc-w' });
  const lab = env.authenticatedContext('lab-cl-1', { role: 'lab' }).firestore();
  await assertFails(getDoc(doc(lab, 'mc_consultations', 'CONS-CL-4')));
});

test('mc_prescriptions : reception NE PEUT PAS lire une ordonnance de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'reception-cl-2', 'reception');
  await seedDoc(env, 'mc_prescriptions', 'RX-CL-1', { patient_id: 'MC-CL-5', establishmentId: 'HOSP-CL', doctor_uid: 'doc-v' });
  const reception = env.authenticatedContext('reception-cl-2', { role: 'reception' }).firestore();
  await assertFails(getDoc(doc(reception, 'mc_prescriptions', 'RX-CL-1')));
});

test('mc_lab_results : reception NE PEUT PAS lire un résultat de labo de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'reception-cl-3', 'reception');
  await seedDoc(env, 'mc_lab_results', 'LABR-CL-1', { patient_id: 'MC-CL-6', establishmentId: 'HOSP-CL', created_by: 'lab-u' });
  const reception = env.authenticatedContext('reception-cl-3', { role: 'reception' }).firestore();
  await assertFails(getDoc(doc(reception, 'mc_lab_results', 'LABR-CL-1')));
});

test('mc_lab_results : lab du même établissement lit toujours (non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'lab-cl-2', 'lab');
  await seedDoc(env, 'mc_lab_results', 'LABR-CL-2', { patient_id: 'MC-CL-7', establishmentId: 'HOSP-CL', created_by: 'lab-cl-2' });
  const lab = env.authenticatedContext('lab-cl-2', { role: 'lab' }).firestore();
  await assertSucceeds(getDoc(doc(lab, 'mc_lab_results', 'LABR-CL-2')));
});

test('labRequests : reception NE PEUT PAS lire une demande d\'analyse de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'reception-cl-4', 'reception');
  await seedDoc(env, 'labRequests', 'LR-CL-1', { patient_id: 'MC-CL-8', establishmentId: 'HOSP-CL' });
  const reception = env.authenticatedContext('reception-cl-4', { role: 'reception' }).firestore();
  await assertFails(getDoc(doc(reception, 'labRequests', 'LR-CL-1')));
});

test('labRequests : lab du même établissement lit toujours (non régressé)', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'lab-cl-3', 'lab');
  await seedDoc(env, 'labRequests', 'LR-CL-2', { patient_id: 'MC-CL-9', establishmentId: 'HOSP-CL' });
  const lab = env.authenticatedContext('lab-cl-3', { role: 'lab' }).firestore();
  await assertSucceeds(getDoc(doc(lab, 'labRequests', 'LR-CL-2')));
});

test('labResults : reception NE PEUT PAS lire un résultat de labo (miroir desktop) de son établissement', async () => {
  const env = await getTestEnv();
  await clearAll(env);
  await seedMember(env, 'HOSP-CL', 'reception-cl-5', 'reception');
  await seedDoc(env, 'labResults', 'LRR-CL-1', { patient_id: 'MC-CL-10', establishmentId: 'HOSP-CL' });
  const reception = env.authenticatedContext('reception-cl-5', { role: 'reception' }).firestore();
  await assertFails(getDoc(doc(reception, 'labResults', 'LRR-CL-1')));
});
