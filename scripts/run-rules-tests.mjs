#!/usr/bin/env node
/* =====================================================
   Orchestrateur — tests/firestore-rules/*.rules.test.js

   Bug réel n°1 (corrigé) : lancer tous ces fichiers en une seule
   invocation `node --test tests/firestore-rules/*.rules.test.js` les
   exécute CONCURREMMENT (comportement par défaut du test runner Node)
   alors qu'ils partagent le MÊME environnement d'émulateur Firestore
   (singleton dans helpers.js). Des appels concurrents à
   clearFirestore() depuis des fichiers différents s'écrasaient entre
   eux, causant des échecs et blocages intermittents très difficiles à
   diagnostiquer. Solution : exécuter chaque fichier dans son PROPRE
   process Node, l'un après l'autre.

   Bug réel n°2 (corrigé) : chaque process `node --test <fichier>` ne
   se termine JAMAIS de lui-même après ses tests (connexions
   Firestore/gRPC persistantes qui empêchent l'event loop de devenir
   inactif), même après plusieurs minutes d'attente naturelle — vérifié
   empiriquement (processus encore vivants après 4+ minutes). Le
   récapitulatif TAP final ("# pass"/"# fail") est émis par le test
   runner sur l'événement `beforeExit`, qui ne se déclenche donc lui
   non plus JAMAIS — ces lignes n'apparaissent pas, peu importe le
   temps qu'on attend. Solution : ne jamais dépendre du récapitulatif ;
   compter directement les lignes TAP par test ("ok N - ..." /
   "not ok N - ...") qui, elles, s'écrivent normalement au fil de
   l'exécution.

   Bug réel n°3 (corrigé) : un délai de grâce fixe avant de tuer le
   process est fragile (trop court = tests coupés avant la fin, trop
   long = suite lente). Solution : sortie redirigée vers un fichier
   (pas un pipe : aucun risque de blocage par backpressure), et on
   sonde périodiquement sa taille — dès qu'elle n'a plus grossi pendant
   une fenêtre de stabilité, on considère les tests terminés et on tue
   le process de force (son propre code de sortie n'est plus fiable,
   voir bug n°2 : on se base uniquement sur le contenu du fichier).

   Bug réel n°4 (corrigé) : juste après que `firebase emulators:exec`
   annonce l'émulateur Firestore "prêt", ses toutes premières connexions
   réelles peuvent être instables (JIT/warmup du process Java) — observé
   empiriquement (erreur gRPC "UNKNOWN: Application error processing
   RPC" puis échec d'évaluation de règle sur le tout premier test lancé
   juste après le démarrage). De même, tuer un process de force
   (SIGKILL) laisse parfois une connexion gRPC dans un état transitoire
   qui perturbe la connexion suivante. Solution : un court délai de
   chauffe avant le premier fichier, et un court délai avant chaque
   nouvelle tentative après un faux départ.
   ===================================================== */
import { spawn } from 'node:child_process';
import { readdirSync, openSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.resolve(new URL('.', import.meta.url).pathname, '../tests/firestore-rules');
const POLL_MS = 250;
const STABLE_MS = 1500;
const MAX_MS = 90000;
const MAX_ATTEMPTS = 3;
const WARMUP_MS = 4000;
const RETRY_DELAY_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.rules.test.js'))
  .sort()
  .map((f) => path.join(DIR, f));

if (files.length === 0) {
  console.error('Aucun fichier tests/firestore-rules/*.rules.test.js trouvé.');
  process.exit(1);
}

function runFile(file) {
  return new Promise((resolve) => {
    const outPath = path.join(os.tmpdir(), `rules-test-${path.basename(file)}-${Date.now()}.log`);
    const fd = openSync(outPath, 'w');
    const child = spawn(process.execPath, ['--test', file], { stdio: ['ignore', fd, fd] });

    const start = Date.now();
    let lastSize = -1;
    let stableSince = Date.now();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      try { closeSync(fd); } catch { /* ignore */ }
      let output = '';
      try { output = readFileSync(outPath, 'utf8'); } catch { /* ignore */ }
      try { unlinkSync(outPath); } catch { /* ignore */ }
      const pass = (output.match(/^ok \d+ /gm) || []).length;
      const fail = (output.match(/^not ok \d+ /gm) || []).length;
      resolve({ output, pass, fail });
    };

    const poller = setInterval(() => {
      let size = 0;
      try { size = statSync(outPath).size; } catch { /* ignore */ }
      const now = Date.now();
      if (size !== lastSize) {
        lastSize = size;
        stableSince = now;
        return;
      }
      if (size > 0 && now - stableSince >= STABLE_MS) {
        finish();
      } else if (now - start >= MAX_MS) {
        finish();
      }
    }, POLL_MS);

    child.on('exit', finish);
  });
}

async function main() {
  let totalPass = 0;
  let totalFail = 0;
  let anyFailed = false;

  await sleep(WARMUP_MS);

  for (const file of files) {
    const name = path.basename(file);
    process.stdout.write(`\n=== ${name} ===\n`);
    let result = await runFile(file);
    let attempts = 1;
    // 0 pass + 0 fail n'est jamais un résultat légitime (chaque fichier a
    // au moins un test) : c'est le signe d'un faux départ (latence de
    // démarrage de l'émulateur juste après "ready"), pas d'une suite
    // vide. On retente avant d'abandonner.
    while (result.pass === 0 && result.fail === 0 && attempts < MAX_ATTEMPTS) {
      attempts += 1;
      process.stdout.write(`${name} : 0 test détecté (faux départ probable), nouvelle tentative (${attempts}/${MAX_ATTEMPTS})...\n`);
      await sleep(RETRY_DELAY_MS);
      result = await runFile(file);
    }
    if (result.pass === 0 && result.fail === 0) {
      anyFailed = true;
      process.stdout.write(`${name} : ÉCHEC — aucun test détecté après ${MAX_ATTEMPTS} tentatives.\n`);
      process.stdout.write(result.output);
      continue;
    }
    totalPass += result.pass;
    totalFail += result.fail;
    if (result.fail > 0) {
      anyFailed = true;
      process.stdout.write(result.output);
    }
    process.stdout.write(`${name} : ${result.pass} pass, ${result.fail} fail\n`);
  }

  console.log(`\nTotal : ${totalPass} pass, ${totalFail} fail sur ${files.length} fichier(s).`);
  process.exit(anyFailed ? 1 : 0);
}

main();
