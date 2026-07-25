/* =====================================================
   Tests — Historique médical APPEND-ONLY (chantier 3, v2.9.42)

   Une consultation signée ne peut être ni réécrite ni supprimée par un
   rôle ordinaire ; le contenu MÉDICAL d'une ordonnance signée est immuable
   (seul le dispatch évolue) ; medical_records n'est jamais supprimé par un
   rôle ordinaire. Seul l'admin plateforme peut supprimer (récupération
   exceptionnelle). Une correction = NOUVELLE entrée (create), jamais un
   écrasement.
   ===================================================== */
const { test } = require('node:test');
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const { getTestEnv, clearAll } = require('./helpers');

const H = 'HOSP-IM';
const DOC = 'doc-im';

async function seedAll(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'mc_consultations', 'CONS1'),
      { cid: 'CONS1', patient_id: 'MC-IM-1', establishmentId: H, doctor_uid: DOC, created_by: DOC, diagnosis: 'initial', sourceDevice: 'mobile' });
    await setDoc(doc(db, 'mc_prescriptions', 'RX1'),
      { pid: 'RX1', patient_id: 'MC-IM-1', establishmentId: H, doctor_uid: DOC, created_by: DOC, diagnosis: 'd', medicines: [{ name: 'A' }], status: 'draft', date: '2026-01-01', sourceDevice: 'mobile' });
    await setDoc(doc(db, 'medical_records', 'MR1'),
      { patient_id: 'MC-IM-1', establishmentId: H, doctor_uid: DOC, created_by: DOC });
  });
}
const asDoctor = (env) => env.authenticatedContext(DOC, { role: 'doctor' }).firestore();
const asAdmin = (env) => env.authenticatedContext('admin-im', { admin: true }).firestore();

/* ── Consultations ─────────────────────────────────── */
test('médecin NE PEUT PAS réécrire une consultation existante', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertFails(updateDoc(doc(asDoctor(env), 'mc_consultations', 'CONS1'), { diagnosis: 'réécrit' }));
});
test('médecin NE PEUT PAS supprimer une consultation', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertFails(deleteDoc(doc(asDoctor(env), 'mc_consultations', 'CONS1')));
});
test('admin plateforme PEUT supprimer une consultation (récupération exceptionnelle)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertSucceeds(deleteDoc(doc(asAdmin(env), 'mc_consultations', 'CONS1')));
});
test('correction = NOUVELLE consultation (create) autorisée, sans toucher l\'originale', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertSucceeds(setDoc(doc(asDoctor(env), 'mc_consultations', 'CONS1-COR'),
    { cid: 'CONS1-COR', patient_id: 'MC-IM-1', establishmentId: H, doctor_uid: DOC, created_by: DOC,
      diagnosis: 'corrigé', entryType: 'correction', correctsConsultationId: 'CONS1', correctionReason: 'erreur de saisie', sourceDevice: 'mobile' }));
});

/* ── Ordonnances ───────────────────────────────────── */
test('médecin PEUT mettre à jour le dispatch d\'une ordonnance (statut/pharmacie)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertSucceeds(updateDoc(doc(asDoctor(env), 'mc_prescriptions', 'RX1'), { status: 'sent', pharmacyUid: 'ph-1', pharmacyName: 'Pharmacie X' }));
});
test('médecin NE PEUT PAS modifier le contenu médical d\'une ordonnance (médicaments)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertFails(updateDoc(doc(asDoctor(env), 'mc_prescriptions', 'RX1'), { medicines: [{ name: 'B' }] }));
});
test('médecin NE PEUT PAS modifier le diagnostic d\'une ordonnance', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertFails(updateDoc(doc(asDoctor(env), 'mc_prescriptions', 'RX1'), { diagnosis: 'autre' }));
});

/* ── medical_records ───────────────────────────────── */
test('médecin NE PEUT PAS supprimer un medical_record (append-only)', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertFails(deleteDoc(doc(asDoctor(env), 'medical_records', 'MR1')));
});
test('admin plateforme PEUT supprimer un medical_record', async () => {
  const env = await getTestEnv(); await clearAll(env); await seedAll(env);
  await assertSucceeds(deleteDoc(doc(asAdmin(env), 'medical_records', 'MR1')));
});
