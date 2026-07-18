/* =====================================================
   Tests — garde structurelle firestore.rules (PARTIE E/N)

   Verrouille à moindre coût (sans émulateur, exécuté par npm test)
   ce que tests/firestore-rules/*.rules.test.js vérifie en profondeur
   avec l'émulateur pour quelques collections représentatives : aucune
   clause "allow read" ne doit réintroduire un accès à toute la
   collection via currentRoleIs('doctor')/currentRoleIs('nurse') SANS
   filtre d'établissement (belongsToSameEstablishment) — c'était la
   fuite inter-hôpitaux corrigée dans ce chantier.
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');

function readClauses(source) {
  // Découpe grossièrement sur "allow read" jusqu'au point-virgule
  // suivant — suffisant ici (pas besoin d'un vrai parseur des règles).
  const clauses = [];
  const regex = /allow read[\s\S]*?;/g;
  let m;
  while ((m = regex.exec(source))) clauses.push(m[0]);
  return clauses;
}

// Isole le bloc "match /collection/{...} { ... }" jusqu'au PROCHAIN
// "match /" — plus robuste qu'une fenêtre de caractères fixe (les
// commentaires explicatifs varient beaucoup en longueur d'un bloc à
// l'autre).
function matchBlock(source, collection) {
  const start = source.indexOf(`match /${collection}/`);
  if (start === -1) return null;
  const rest = source.slice(start + `match /${collection}/`.length);
  const next = rest.indexOf('\n    match /');
  return next === -1 ? source.slice(start) : source.slice(start, start + `match /${collection}/`.length + next);
}

test('firestore.rules : au moins une clause "allow read" existe (garde anti-régression du test lui-même)', () => {
  const clauses = readClauses(rules);
  assert.ok(clauses.length > 10, 'le fichier de règles doit contenir de nombreuses clauses allow read');
});

test("firestore.rules : aucune clause de lecture n'accorde currentRoleIs('doctor')/currentRoleIs('nurse') SANS belongsToSameEstablishment à proximité", () => {
  const clauses = readClauses(rules);
  const offenders = clauses.filter(c =>
    c.includes("currentRoleIs('doctor')") &&
    c.includes("currentRoleIs('nurse')") &&
    !c.includes('belongsToSameEstablishment')
  );
  assert.deepStrictEqual(
    Array.from(offenders),
    [],
    `clause(s) de lecture élargie sans filtre établissement détectée(s) :\n${offenders.join('\n---\n')}`
  );
});

test('firestore.rules : belongsToSameEstablishment/isHospitalMember sont bien définis', () => {
  assert.match(rules, /function isHospitalMember\(hospitalId\)/);
  assert.match(rules, /function belongsToSameEstablishment\(data\)/);
});

test('firestore.rules : belongsToSameEstablishment est appliqué sur les collections médicales attendues', () => {
  const expected = [
    'mc_patients', 'mc_consultations', 'mc_prescriptions', 'labRequests',
    'admissions', 'receptionVisits', 'emergencyCases', 'maternityCases',
    'auditLogs', 'establishment_documents',
  ];
  for (const collection of expected) {
    const block = matchBlock(rules, collection);
    assert.ok(block, `collection ${collection} introuvable dans firestore.rules`);
    assert.match(block, /belongsToSameEstablishment/, `${collection} doit référencer belongsToSameEstablishment`);
  }
});

test('firestore.rules : hasNoSecretFields interdit password/pin/passwordHash/admin', () => {
  const m = rules.match(/function hasNoSecretFields\(data\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(m, 'hasNoSecretFields doit exister');
  for (const field of ['admin', 'password', 'passwordHash', 'pin']) {
    assert.match(m[1], new RegExp(`'${field}'`), `hasNoSecretFields doit interdire le champ ${field}`);
  }
});

test('firestore.rules : mc_accounts applique hasNoSecretFields en create ET en update', () => {
  const block = matchBlock(rules, 'mc_accounts');
  assert.ok(block);
  // Chantier sécurité (section 2) : la clause "allow create" n'appelle
  // plus directement hasNoSecretFields — chacun des 3 chemins de
  // self-create non-admin (validMcAccountSelfCreate/
  // legacyDegradedProfessionalCreate/validPatientAccountSelfCreate,
  // fonctions imbriquées dans ce même bloc match) l'appelle désormais
  // individuellement. On vérifie donc la garantie sur le bloc entier
  // plutôt que sur le seul texte de la clause "allow create".
  const updateClause = block.match(/allow update:[\s\S]*?;/)[0];
  for (const helper of ['validMcAccountSelfCreate', 'legacyDegradedProfessionalCreate', 'validPatientAccountSelfCreate']) {
    const fnMatch = block.match(new RegExp(`function ${helper}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.ok(fnMatch, `${helper} doit exister dans le bloc mc_accounts`);
    assert.match(fnMatch[1], /hasNoSecretFields/, `${helper} doit vérifier hasNoSecretFields`);
  }
  assert.match(updateClause, /hasNoSecretFields/, 'update doit vérifier hasNoSecretFields');
});

test('firestore.rules : mc_consents ne permet jamais au médecin demandeur de s\'auto-approuver', () => {
  const block = matchBlock(rules, 'mc_consents');
  assert.ok(block);
  // La clause dédiée au médecin (doctor_id == auth.uid) ne doit
  // autoriser que le statut 'revoked', jamais 'approved'.
  const doctorClause = block.slice(block.indexOf('resource.data.doctor_id == request.auth.uid'));
  assert.match(doctorClause, /status == 'revoked'/);
  assert.doesNotMatch(doctorClause.slice(0, 200), /status == 'approved'/);
});

test('firestore.rules : le pharmacien ne peut modifier que le statut et ses métadonnées, jamais le contenu médical', () => {
  for (const collection of ['prescriptions', 'mc_prescriptions']) {
    const block = matchBlock(rules, collection);
    assert.ok(block, `${collection} introuvable`);
    const updateClause = block.match(/allow update:[\s\S]*?;/)[0];
    assert.match(updateClause, /pharmacyCanReadPrescription/);
    assert.match(updateClause, /hasOnly\(\['status'/, `${collection} : le pharmacien doit être restreint via hasOnly(['status', ...])`);
    assert.doesNotMatch(updateClause, /hasOnly\(\[[^\]]*diagnosis/, 'diagnosis ne doit jamais être dans les champs autorisés au pharmacien');
  }
});
