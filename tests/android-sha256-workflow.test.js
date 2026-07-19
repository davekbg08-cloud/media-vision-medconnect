/* =====================================================
   Tests — .github/workflows/print-android-signing-sha256.yml

   But : extraire l'empreinte SHA-256 du certificat de signature
   Android (nécessaire pour enregistrer l'app dans Firebase Console →
   App Check → Play Integrity) SANS jamais exposer le keystore ni ses
   mots de passe — seule l'empreinte (donnée publique par construction)
   est affichée dans les logs. Déclenchement manuel uniquement, ne
   construit rien, ne publie aucun artefact.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.resolve(__dirname, '..', '.github/workflows/print-android-signing-sha256.yml');
const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

test('print-android-signing-sha256.yml existe et se déclenche manuellement uniquement', () => {
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /schedule:/);
  assert.doesNotMatch(source, /push:/);
});

test('print-android-signing-sha256.yml réutilise les secrets de signature déjà configurés (pas de nouveau secret)', () => {
  assert.match(source, /KEYSTORE_BASE64/);
  assert.match(source, /KEYSTORE_PASSWORD/);
  assert.match(source, /KEYSTORE_ALIAS/);
});

test('print-android-signing-sha256.yml décode le keystore dans un fichier temporaire (jamais dans le dépôt)', () => {
  assert.match(source, /\/tmp\/keystore\.jks/);
  assert.doesNotMatch(source, /android\/keystore\.jks/);
});

test('print-android-signing-sha256.yml supprime le keystore décodé en fin de job (if: always())', () => {
  const cleanupIdx = source.indexOf('Supprimer le keystore décodé');
  assert.ok(cleanupIdx !== -1, 'étape de suppression manquante');
  const cleanupBlock = source.slice(cleanupIdx, cleanupIdx + 150);
  assert.match(cleanupBlock, /if: always\(\)/);
  assert.match(cleanupBlock, /rm -f \/tmp\/keystore\.jks/);
});

test("print-android-signing-sha256.yml n'affiche que l'empreinte (grep ciblé), jamais l'intégralité du keytool -list -v", () => {
  assert.match(source, /grep -E "SHA256:\|SHA1:"/);
});

test('print-android-signing-sha256.yml ne construit aucun APK et ne publie aucun artefact', () => {
  assert.doesNotMatch(source, /gradle assembleRelease/);
  assert.doesNotMatch(source, /upload-artifact/);
});
