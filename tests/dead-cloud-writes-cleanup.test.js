/* =====================================================
   Tests — nettoyage d'écritures cloud mortes (audit complet)

   Trois collections étaient écrites par l'app SANS aucune règle
   Firestore correspondante — donc systématiquement rejetées par la
   clause catch-all (match /{document=**} { allow read, write: if false })
   et jamais relues côté cloud :
   - mc_transfers / transfers (js/transfer_ui_patch.js syncTransferToCloud) :
     le message part réellement via Network.notify → mc_messages ; la page
     Transferts lit emergencyTransfers ; getTransfers lit le localStorage.
   - mc_settings (js/db.js saveSettings) : getSettings lit le localStorage,
     aucune sync mc_settings.
   Écritures mortes retirées (même motif que les écritures mc_affiliations
   supprimées précédemment). Vérifié par lecture de source.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

test("transfer_ui_patch.js n'écrit plus vers mc_transfers ni transfers (collections sans règles)", () => {
  const src = read('js/transfer_ui_patch.js');
  assert.ok(!/collection\('mc_transfers'\)/.test(src), "plus aucune écriture vers mc_transfers");
  assert.ok(!/collection\('transfers'\)/.test(src), "plus aucune écriture vers transfers");
  assert.ok(!/syncTransferToCloud\s*\(/.test(src), "syncTransferToCloud ne doit plus être appelée");
});

test("transfer_ui_patch.js délivre toujours le message (createNotificationForTransfer / Network.notify)", () => {
  const src = read('js/transfer_ui_patch.js');
  assert.match(src, /createNotificationForTransfer\(/, "la notification/message doit toujours être créée");
  assert.match(src, /Network\.notify\(/, "le chemin de repli Network.notify doit rester présent");
});

test("db.js saveSettings ne pousse plus vers mc_settings (cloud) mais persiste toujours en local", () => {
  const src = read('js/db.js');
  const start = src.indexOf('function saveSettings(');
  const end = src.indexOf('\n  function ', start + 1);
  const body = src.slice(start, end);
  assert.ok(!/_push\('mc_settings'/.test(body), "plus de _push('mc_settings') (écriture morte)");
  assert.match(body, /store\('mc_settings'/, "les réglages doivent toujours être stockés en local");
});
