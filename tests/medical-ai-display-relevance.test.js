/* =====================================================
   Tests — IA médicale : affichage français, pertinence, sources
   originales conservées (chantier fix/medical-ai-display-relevance)

   Couvre les 10 points de l'audit :
   1. Le titre original reste conservé.
   2. La traduction est identifiée comme automatique.
   3. Sans clé Claude, aucune fausse traduction n'est affichée.
   4. Avec une synthèse simulée, le texte français est affiché.
   5. "quinine" classe un article clinique avant un article de
      chromatographie.
   6. Les balises HTML brutes d'un résumé Europe PMC ne sont jamais
      affichées.
   7. Les liens originaux restent intacts.
   8. Aucune donnée patient n'est transmise dans la requête.
   9. Une erreur de traduction n'empêche jamais l'affichage des
      sources originales.
   10. Fonctionne dans MedConnect Desktop et dans la PWA (container
       reçu en paramètre, jamais un id figé).
   ===================================================== */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'js/medical-ai.js'), 'utf8');

function fakeElement(extra = {}) {
  return Object.assign({ value: '', innerHTML: '', style: {}, disabled: false, textContent: '' }, extra);
}

/* Sandbox complet exécutant le VRAI js/medical-ai.js, avec fetch/
   localStorage/dépendances hôte simulées. europePmcResults et
   claudeResponseText sont injectables par test. */
function setup({ apiKey = '', europePmcResults = [], claudeImpl = null, claudeStatus = 200 } = {}) {
  const domElements = new Map();
  const getEl = (id) => {
    if (!domElements.has(id)) domElements.set(id, fakeElement());
    return domElements.get(id);
  };

  const localStore = new Map();
  if (apiKey) localStore.set('mc_ai_claude_key', apiKey);
  const localStorageImpl = {
    getItem: k => (localStore.has(k) ? localStore.get(k) : null),
    setItem: (k, v) => localStore.set(k, String(v)),
    removeItem: k => localStore.delete(k),
  };

  const toasts = [];
  const createdDocs = [];
  const fetchCalls = [];

  async function fetchImpl(url, options) {
    fetchCalls.push({ url, options });
    if (String(url).includes('ebi.ac.uk')) {
      return { ok: true, status: 200, json: async () => ({ resultList: { result: europePmcResults } }) };
    }
    if (String(url).includes('api.anthropic.com')) {
      if (claudeStatus !== 200) return { ok: false, status: claudeStatus, json: async () => ({}) };
      const text = typeof claudeImpl === 'function' ? claudeImpl(options) : (claudeImpl || '');
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }) };
    }
    throw new Error('URL non simulée : ' + url);
  }

  const win = {
    HospitalPermissions: { requireRoute: () => true },
    CloudDB: {
      subscriptionAllowsWrite: async () => ({ allowed: true }),
      requireWritableSubscription: async () => true,
      getActiveHospitalId: async () => 'EST1',
      getCurrentUserProfile: async () => ({ uid: 'doc-1', role: 'doctor' }),
      createDoc: async (col, data) => { createdDocs.push({ col, data }); return { id: 'x', ...data }; },
    },
    App: { toast: (msg, type) => toasts.push({ msg, type }) },
    HospitalAuth: { getSession: () => null },
    Auth: { getUser: () => ({ role: 'doctor' }) },
    HospitalDesktopUI: { navigate: () => {} },
  };
  win.window = win;

  const sandbox = {
    window: win,
    document: { getElementById: getEl, body: { contains: () => true } },
    localStorage: localStorageImpl,
    fetch: fetchImpl,
    console,
    // Bare globals (le module y accède sans préfixe "window.", comme
    // dans un vrai navigateur où window EST le global) :
    HospitalPermissions: win.HospitalPermissions,
    CloudDB: win.CloudDB,
    App: win.App,
    HospitalDesktopUI: win.HospitalDesktopUI,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'js/medical-ai.js' });

  return { win: sandbox.window, getEl, toasts, createdDocs, fetchCalls };
}

async function runSearch(ctx, query) {
  ctx.getEl('ai-query').value = query;
  const submitBtn = fakeElement({ textContent: '🔎 Rechercher dans la littérature' });
  const fakeEvent = { preventDefault(){}, target: { querySelector: () => submitBtn } };
  await ctx.win.MedicalAIModule.ask(fakeEvent);
  return ctx.getEl('ai-response');
}

function pmcArticle(overrides = {}) {
  return {
    id: '123', source: 'MED',
    title: 'Article title', authorString: 'Doe J', pubYear: '2024',
    journalInfo: { journal: { title: 'J Med' } },
    abstractText: 'Abstract text.',
    doi: '10.1234/example',
    pubTypeList: { pubType: ['Journal Article'] },
    ...overrides,
  };
}

/* ── Fonctions pures ─────────────────────────────────────────── */

test('_stripHtml() supprime les balises HTML brutes (ex. <h4>ABSTRACT</h4>) sans les afficher telles quelles', () => {
  const { win } = setup();
  const cleaned = win.MedicalAIModule._stripHtml('<h4>ABSTRACT</h4>Some <b>text</b> here.<p>More.</p>');
  assert.doesNotMatch(cleaned, /<[^>]+>/, 'aucune balise ne doit subsister');
  assert.match(cleaned, /ABSTRACT/);
  assert.match(cleaned, /Some/);
  assert.match(cleaned, /More/);
});

test('_isBareDrugQuery()/_buildSearchQuery() : élargit une recherche courte sur un médicament sans exclure d\'études', () => {
  const { win } = setup();
  assert.strictEqual(win.MedicalAIModule._isBareDrugQuery('QUININE'), true);
  assert.strictEqual(win.MedicalAIModule._isBareDrugQuery('interaction amoxicilline ibuprofène pendant la grossesse'), false);
  const built = win.MedicalAIModule._buildSearchQuery('QUININE');
  assert.match(built, /TITLE:"QUININE"/);
  assert.match(built, /PUB_TYPE:"Clinical Trial"/);
  assert.doesNotMatch(built, /\bNOT\b/, 'ne doit jamais exclure via NOT — seul le tri (score) écarte la non-pertinence');
});

test('_scoreArticle()/_relevanceLabel() : un article clinique humain sur le paludisme est mieux classé qu\'un article de chromatographie', () => {
  const { win } = setup();
  const clinical = {
    originalTitle: 'Quinine for treatment of severe malaria: a randomized clinical trial in human patients',
    originalAbstract: 'This randomized clinical trial evaluated quinine treatment efficacy in human patients with malaria infection.',
    pubTypes: ['Clinical Trial'], isHuman: true,
  };
  const chromatography = {
    originalTitle: 'Determination of quinine in pharmaceutical formulations by high performance liquid chromatography',
    originalAbstract: 'A chromatography method was developed for the analytical determination of quinine.',
    pubTypes: ['Journal Article'],
  };
  const scoreClinical = win.MedicalAIModule._scoreArticle(clinical);
  const scoreChromato = win.MedicalAIModule._scoreArticle(chromatography);
  assert.ok(scoreClinical > scoreChromato, `attendu score clinique (${scoreClinical}) > score chromatographie (${scoreChromato})`);
  assert.strictEqual(win.MedicalAIModule._relevanceLabel(scoreClinical), 'Très pertinent');
});

test('_parseStructuredResponse() : extrait la synthèse et les traductions par index, tolère un format partiellement invalide', () => {
  const { win } = setup();
  const text = '[SYNTHESE]\nTexte de synthèse en français [1].\n[/SYNTHESE]\n[TRADUCTIONS]\n1|Titre traduit|Résumé français court.\nligne invalide sans pipe\n[/TRADUCTIONS]';
  const { synthesis, translations } = win.MedicalAIModule._parseStructuredResponse(text, 1);
  assert.match(synthesis, /Texte de synthèse en français/);
  assert.strictEqual(translations.get(1).translatedTitle, 'Titre traduit');
  assert.strictEqual(translations.get(1).translatedAbstract, 'Résumé français court.');
});

/* ── 5. Recherche "quinine" : tri de bout en bout ────────────── */
test('5. Une recherche "quinine" classe un article clinique sur le paludisme avant un article de chromatographie', async () => {
  const clinicalArticle = pmcArticle({
    id: '1', title: 'Quinine for treatment of severe malaria: a randomized clinical trial in human patients',
    abstractText: 'This randomized clinical trial evaluated quinine treatment efficacy in human patients with malaria infection.',
    pubTypeList: { pubType: ['Clinical Trial'] },
    meshHeadingList: { meshHeading: [{ descriptorName: 'Humans' }] },
  });
  const chromatographyArticle = pmcArticle({
    id: '2', title: 'Determination of quinine in pharmaceutical formulations by high performance liquid chromatography',
    abstractText: 'A chromatography method was developed for the analytical determination of quinine.',
    pubTypeList: { pubType: ['Journal Article'] },
  });
  const ctx = setup({ europePmcResults: [chromatographyArticle, clinicalArticle] }); // ordre PMC inversé exprès
  const el = await runSearch(ctx, 'QUININE');
  const clinicalPos = el.innerHTML.indexOf('randomized clinical trial in human patients');
  const chromatoPos = el.innerHTML.indexOf('high performance liquid chromatography');
  assert.ok(clinicalPos !== -1 && chromatoPos !== -1, 'les deux articles doivent être affichés (aucune suppression)');
  assert.ok(clinicalPos < chromatoPos, 'l\'article clinique doit apparaître avant l\'article de chromatographie');
});

/* ── 1/2/3. Original conservé, traduction identifiée, pas de fausse traduction sans clé ── */
test('1/3. Sans clé Claude : le titre original est affiché, aucune traduction n\'est inventée, message clair affiché', async () => {
  const ctx = setup({ europePmcResults: [pmcArticle({ title: 'Original English Title' })] });
  const el = await runSearch(ctx, 'amoxicillin dosage adult');
  assert.match(el.innerHTML, /Original English Title/, 'le titre original doit être affiché');
  assert.doesNotMatch(el.innerHTML, /traduction automatique/, 'aucun badge de traduction sans clé');
  assert.match(el.innerHTML, /Configurez la synthèse IA pour obtenir un résumé français/, 'message clair sans clé');
});

test('2. Avec une clé et une synthèse simulée : la traduction est clairement identifiée comme automatique, l\'original reste accessible', async () => {
  const claudeText = '[SYNTHESE]\nSynthèse en français [1].\n[/SYNTHESE]\n[TRADUCTIONS]\n1|Titre en français|Résumé en français court.\n[/TRADUCTIONS]';
  const ctx = setup({
    apiKey: 'sk-ant-test-key',
    europePmcResults: [pmcArticle({ title: 'Original English Title', abstractText: 'Original English abstract text.' })],
    claudeImpl: claudeText,
  });
  const el = await runSearch(ctx, 'amoxicillin dosage adult');
  assert.match(el.innerHTML, /Titre en français/, 'le titre traduit doit être affiché par défaut');
  assert.match(el.innerHTML, /traduction automatique/, 'la traduction doit être identifiée comme automatique');
  assert.match(el.innerHTML, /Voir le texte original/, 'un bouton doit permettre de voir le texte original');
  assert.doesNotMatch(el.innerHTML, /Original English Title/, 'le titre original ne doit pas apparaître avant d\'avoir cliqué sur "Voir le texte original"');

  // Bascule "Voir le texte original" : révèle le titre/résumé originaux.
  ctx.win.MedicalAIModule.toggleOriginal(1);
  assert.match(ctx.getEl('ai-response').innerHTML, /Original English Title/, 'le titre original doit rester accessible après bascule');
  assert.match(ctx.getEl('ai-response').innerHTML, /Masquer le texte original/);
});

/* ── 4. Synthèse simulée : texte français affiché ────────────── */
test('4. Avec une synthèse simulée dans les tests, le texte français de synthèse est affiché', async () => {
  const claudeText = '[SYNTHESE]\nIndications médicales : traitement du paludisme non compliqué [1].\nEfficacité : élevée en zone non résistante [1].\n[/SYNTHESE]\n[TRADUCTIONS]\n1|Titre|Résumé.\n[/TRADUCTIONS]';
  const ctx = setup({
    apiKey: 'sk-ant-test-key',
    europePmcResults: [pmcArticle()],
    claudeImpl: claudeText,
  });
  const el = await runSearch(ctx, 'quinine malaria');
  assert.match(el.innerHTML, /Indications médicales : traitement du paludisme/);
  assert.match(el.innerHTML, /Synthèse/);
});

/* ── 6. Pas de balises HTML brutes affichées ─────────────────── */
test('6. Les balises HTML brutes d\'un résumé Europe PMC ne sont jamais affichées', async () => {
  const ctx = setup({
    europePmcResults: [pmcArticle({ abstractText: '<h4>ABSTRACT</h4>Some findings.<p>Conclusion here.</p>' })],
  });
  const el = await runSearch(ctx, 'amoxicillin dosage adult');
  assert.doesNotMatch(el.innerHTML, /&lt;h4&gt;|<h4>/, 'ni la balise brute ni sa version échappée ne doivent apparaître de façon visible pour l\'utilisateur en tant que balise');
  assert.match(el.innerHTML, /ABSTRACT/);
  assert.match(el.innerHTML, /Conclusion here/);
});

/* ── 7. Les liens originaux restent intacts ──────────────────── */
test('7. Le lien "Lire l\'article original" pointe vers la publication originale (DOI), inchangé', async () => {
  const ctx = setup({ europePmcResults: [pmcArticle({ doi: '10.9999/real-doi' })] });
  const el = await runSearch(ctx, 'amoxicillin dosage adult');
  assert.match(el.innerHTML, /https:\/\/doi\.org\/10\.9999\/real-doi/);
});

/* ── 8. Aucune donnée patient transmise ──────────────────────── */
test('8. Aucune donnée patient n\'est transmise à Europe PMC ni à Claude — seule la question libre est envoyée', async () => {
  const claudeText = '[SYNTHESE]\nOK [1].\n[/SYNTHESE]\n[TRADUCTIONS]\n1|T|R\n[/TRADUCTIONS]';
  const ctx = setup({ apiKey: 'sk-ant-test-key', europePmcResults: [pmcArticle()], claudeImpl: claudeText });
  await runSearch(ctx, 'amoxicillin dosage adult');
  assert.ok(ctx.fetchCalls.length >= 2, 'Europe PMC et Claude doivent tous deux être appelés');
  for (const call of ctx.fetchCalls) {
    const body = call.options?.body || '';
    assert.doesNotMatch(String(call.url) + String(body), /patient_id|MC-\d{4}|dossier|firstname|lastname/i,
      'aucune requête réseau ne doit contenir un identifiant ou un champ patient');
  }
  // Le journal d'audit lui-même ne doit contenir aucun champ patient.
  const auditDoc = ctx.createdDocs.find(d => d.col === 'aiQueries');
  assert.ok(auditDoc);
  assert.ok(!('patientId' in auditDoc.data) && !('patient_id' in auditDoc.data));
});

/* ── 9. Une erreur de traduction n'empêche jamais l'affichage des sources ── */
test('9. Une erreur de synthèse/traduction (ex. clé invalide) n\'empêche jamais l\'affichage des articles originaux', async () => {
  const ctx = setup({
    apiKey: 'sk-ant-invalid-key',
    europePmcResults: [pmcArticle({ title: 'Original English Title' })],
    claudeStatus: 401,
  });
  const el = await runSearch(ctx, 'amoxicillin dosage adult');
  assert.match(el.innerHTML, /Original English Title/, 'les articles restent affichés malgré l\'échec de la synthèse');
  assert.ok(ctx.toasts.some(t => /synthèse IA indisponible/i.test(t.msg)), 'un avertissement doit informer sans bloquer l\'affichage');
});

/* ── 10. Fonctionne dans MedConnect Desktop et dans la PWA ───────
   render(container) écrit dans le container REÇU, jamais un id figé
   (#main-content) — vérifié en passant deux containers différents. */
test('10. render(container) fonctionne avec n\'importe quel container (desktop #hospital-content ou mobile #main-content)', async () => {
  const ctx = setup();
  const desktopContainer = fakeElement();
  const mobileContainer = fakeElement();
  await ctx.win.MedicalAIModule.render(desktopContainer);
  await ctx.win.MedicalAIModule.render(mobileContainer);
  assert.match(desktopContainer.innerHTML, /IA médicale/);
  assert.match(mobileContainer.innerHTML, /IA médicale/);
});

test('render() ne référence jamais document.getElementById(\'main-content\') en dur', () => {
  const renderIdx = src.indexOf('async function render(container)');
  const nextFnIdx = src.indexOf('function saveKey');
  const block = src.slice(renderIdx, nextFnIdx);
  assert.doesNotMatch(block, /getElementById\('main-content'\)/);
});
