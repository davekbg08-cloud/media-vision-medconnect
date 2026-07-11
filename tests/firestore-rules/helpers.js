/* =====================================================
   Helpers — tests de règles Firestore (émulateur)

   Nécessite l'émulateur Firestore en cours d'exécution (voir
   npm run test:rules, qui lance `firebase emulators:exec`).
   Utilise l'API modulaire firebase/firestore (doc/getDoc/setDoc/...),
   comme documenté par @firebase/rules-unit-testing.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

// Module-level singleton : `node --test tests/firestore-rules/*.rules.test.js`
// exécute tous les fichiers correspondants dans le MÊME processus (donc le
// même cache require) — un seul environnement d'émulateur est partagé entre
// tous les fichiers de tests, sans le recréer ni le nettoyer entre chacun
// (un cleanup() prématuré appelé après le premier fichier casserait tous
// les suivants avec "RulesTestEnvironment has already been cleaned up").
// L'émulateur (processus Java) est arrêté par `firebase emulators:exec`
// une fois `node --test` terminé — pas besoin de cleanup() explicite ici.
let envPromise = null;

function getTestEnv() {
  if (!envPromise) {
    envPromise = initializeTestEnvironment({
      projectId: 'demo-medconnect',
      firestore: {
        rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      },
    });
  }
  return envPromise;
}

/** Écrit des documents en contournant les règles (préparation de scénario). */
async function seed(env, writer) {
  await env.withSecurityRulesDisabled(async (context) => {
    const { getFirestore, doc, setDoc } = require('firebase/firestore');
    const db = context.firestore ? context.firestore() : getFirestore();
    await writer(db, doc, setDoc);
  });
}

async function clearAll(env) {
  await env.clearFirestore();
}

module.exports = { getTestEnv, seed, clearAll };
