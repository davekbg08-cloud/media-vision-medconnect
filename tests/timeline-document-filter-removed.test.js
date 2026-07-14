/* =====================================================
   Tests — le filtre décoratif "📄 Document" est retiré de la Timeline
   (js/timeline.js)

   Découvert en audit : le chip de filtre "Document" existait dans
   l'interface mais buildEvents() ne produisait JAMAIS d'événement de
   type 'document' — la seule source (establishment_documents) ne
   contient que des copies d'audit de consultations/ordonnances déjà
   affichées sous leur propre type. Filtre purement décoratif (jamais
   alimenté), qui aurait créé des doublons s'il l'était. Retiré des
   chips ; 'document' reste dans TYPE_META uniquement comme repli de
   rendu (renderEvents : TYPE_META[ev.type] || TYPE_META.document).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/timeline.js'), 'utf8');

test("'document' reste défini dans TYPE_META (repli de rendu)", () => {
  const metaIdx = src.indexOf('const TYPE_META');
  const metaBlock = src.slice(metaIdx, src.indexOf('};', metaIdx));
  assert.match(metaBlock, /document:\s*\{/, "TYPE_META.document doit rester défini comme repli");
});

test("le rendu des chips de filtre exclut explicitement 'document'", () => {
  assert.match(src, /Object\.entries\(TYPE_META\)\.filter\(\(\[k\]\) => k !== 'document'\)/,
    "les chips de filtre doivent exclure le type 'document'");
});

test("buildEvents ne pousse jamais d'événement de type 'document' (aucune régression de câblage)", () => {
  const start = src.indexOf('function buildEvents(');
  const end = src.indexOf('function renderEvents(', start);
  const body = src.slice(start, end);
  assert.ok(!/type:\s*'document'/.test(body),
    "buildEvents ne doit produire aucun événement de type 'document'");
});
