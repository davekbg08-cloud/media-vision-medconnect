/* =====================================================
   MedConnect 2.0 — MedicalAIModule (recherche médicale RÉELLE)

   Deux niveaux :
   1. RECHERCHE DOCUMENTAIRE (toujours active, sans clé) — Europe PMC
      (littérature biomédicale mondiale : PubMed, essais cliniques,
      prépublications). API REST publique, gratuite, CORS, sans clé.
   2. SYNTHÈSE IA (optionnelle) — si l'établissement configure SA
      PROPRE clé API Claude, une synthèse en français est générée à
      partir des articles trouvés (citations [n]), et les titres/
      résumés nécessaires sont traduits. La clé est saisie par
      l'administration de l'établissement et stockée UNIQUEMENT sur cet
      appareil (localStorage) — jamais dans le code, jamais dans
      Firestore, jamais synchronisée.

   Correctif (audit affichage/pertinence) :
   - Les titres/résumés originaux (langue de publication) sont
     TOUJOURS conservés (originalTitle/originalAbstract/sourceLanguage)
     — la traduction (quand une clé est configurée) s'affiche par
     défaut, mais l'original reste accessible via "Voir le texte
     original", clairement identifié comme traduction automatique.
     Sans clé, aucune traduction n'est inventée : message explicite.
   - Une recherche courte portant sur un seul médicament (ex.
     "QUININE") est élargie vers la littérature clinique pertinente
     (essais, revues) SANS exclure aucune étude — un score de
     pertinence documenté (scoreArticle) trie ensuite du plus au moins
     pertinent (chimie analytique/expérimentation animale sans lien
     clinique : score bas, jamais supprimées).
   - Filtres visibles (études humaines, essais cliniques, revues
     systématiques, effets indésirables, interactions, résistance,
     année) + option "Privilégier les résultats cliniquement
     pertinents" (cochée par défaut).
   - Nettoyage des balises HTML brutes que renvoie parfois Europe PMC
     dans les résumés structurés (ex. <h4>Background</h4>).

   Invariants conservés :
   - Gating abonnement ('use_medical_ai', DESKTOP_BLOCKED_ACTIONS) ;
   - Journal aiQueries (audit, jamais la clé, jamais de donnée patient) ;
   - Échappement HTML de tout contenu affiché (XSS) ;
   - Aucune réponse présentée comme un avis médical ;
   - Aucune donnée d'identité patient n'est envoyée à Europe PMC ni à
     Claude — la recherche porte uniquement sur la question libre
     saisie par le professionnel.
   ===================================================== */
const MedicalAIModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const SAFETY_NOTICE =
    "Cette IA fournit une aide à la recherche médicale. La décision finale appartient au professionnel de santé.";
  const RELEVANCE_DISCLAIMER =
    "Le libellé de pertinence est indicatif (tri automatique) — il ne constitue pas une validation scientifique.";
  const NO_KEY_NOTICE =
    "Les articles sont affichés dans leur langue de publication. Configurez la synthèse IA pour obtenir un résumé français.";

  /* Clé API Claude de l'établissement — locale à CET appareil. */
  const AI_KEY_STORAGE = 'mc_ai_claude_key';
  function getApiKey()    { try { return localStorage.getItem(AI_KEY_STORAGE) || ''; } catch { return ''; } }
  function setApiKey(k)   { try { k ? localStorage.setItem(AI_KEY_STORAGE, k) : localStorage.removeItem(AI_KEY_STORAGE); } catch {} }

  /* ── H. Nettoyage HTML ─────────────────────────────────
     Europe PMC renvoie parfois des résumés structurés avec des
     balises brutes (ex. "<h4>Background</h4>..."). On supprime TOUTE
     balise avant stockage — jamais affichée telle quelle — en gardant
     le texte des sections sur des lignes séparées (lisibilité). */
  function stripHtml(raw) {
    return String(raw || '')
      .replace(/<\/(h[1-6]|p|div|br|li)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  /* ── Langue source (Europe PMC : code ISO 639-2, ex. "eng") ── */
  const LANG_CODE_MAP = { eng:'en', fre:'fr', fra:'fr', ger:'de', deu:'de', spa:'es', ita:'it', por:'pt', dut:'nl', nld:'nl', chi:'zh', zho:'zh', jpn:'ja', rus:'ru' };
  const LANG_LABELS   = { en:'anglais', fr:'français', de:'allemand', es:'espagnol', it:'italien', pt:'portugais', nl:'néerlandais', zh:'chinois', ja:'japonais', ru:'russe' };
  function normalizeLanguage(code) {
    const c = String(code || '').toLowerCase();
    if (LANG_CODE_MAP[c]) return LANG_CODE_MAP[c];
    // Europe PMC omet parfois le champ : l'essentiel de la littérature
    // indexée est en anglais, on ne prétend jamais une langue non fournie.
    return c.length === 2 ? c : 'en';
  }
  function languageLabel(code) { return LANG_LABELS[code] || code || 'inconnue'; }

  /* ── E. Détection d'une recherche courte sur un seul médicament ──
     Ex. "QUININE" : peu de mots, aucun indice de question clinique
     développée (dose, interaction, grossesse...). */
  const CLINICAL_QUERY_HINTS = /(interaction|effet|treatment|traitement|dose|dosage|contre-indication|grossesse|enceinte|allergie|posologie|essai|trial)/i;
  function isBareDrugQuery(q) {
    const words = String(q || '').trim().split(/\s+/).filter(Boolean);
    return words.length > 0 && words.length <= 3 && !CLINICAL_QUERY_HINTS.test(q);
  }

  /* Construit une requête Europe PMC plus précise pour une recherche
     "nom de médicament seul" — élargit vers la littérature clinique
     pertinente (essais, revues) SANS exclure aucune étude : le tri par
     pertinence (scoreArticle, ci-dessous) fait le reste. Syntaxe
     officielle Europe PMC (champs + booléens) :
     https://europepmc.org/Help#syntax
     La requête ORIGINALE est toujours conservée par l'appelant (ask())
     pour l'audit et pour la synthèse Claude — seule la requête envoyée
     à Europe PMC est élargie ici. */
  function buildSearchQuery(rawQuery) {
    const trimmed = String(rawQuery || '').trim();
    if (!trimmed || !isBareDrugQuery(trimmed)) return trimmed;
    const q = trimmed.replace(/"/g, '');
    return `(${q}) AND (TITLE:"${q}" OR ABSTRACT:"${q}" OR PUB_TYPE:"Clinical Trial" OR PUB_TYPE:"Review" OR PUB_TYPE:"Systematic Review" OR PUB_TYPE:"Meta-Analysis")`;
  }

  /* ── E. Score de pertinence clinique — documenté, jamais utilisé
     pour supprimer une étude, uniquement pour trier l'affichage. ── */
  const POSITIVE_TERMS = [
    'clinical trial','randomized','randomised','systematic review','meta-analysis',
    'treatment','therapy','efficacy','indication','dosage','resistance','resistant',
    'adverse','interaction','pharmacokinetic','pharmacodynamic','patient','patients',
    'human','humans','therapeutic','malaria','infection',
  ];
  const NEGATIVE_TERMS = [
    'chromatography','spectrometry','spectroscopy','synthesis','synthetic route',
    'analytical method','crystal structure','rat','rats','mice','mouse','rodent','in vitro assay',
  ];

  function scoreArticle(article) {
    let score = 0;
    const pubTypes = (article.pubTypes || []).map(t => String(t).toLowerCase());
    const title = String(article.originalTitle || '').toLowerCase();
    const abstract = String(article.originalAbstract || '').toLowerCase();

    if (pubTypes.some(t => /clinical trial|randomized|randomised controlled/.test(t))) score += 4;
    if (pubTypes.some(t => /systematic review|meta-analysis/.test(t))) score += 3;
    if (pubTypes.some(t => /\breview\b/.test(t))) score += 1;
    if (article.isHuman === true) score += 3;
    if (article.isHuman === false) score -= 2;

    for (const term of POSITIVE_TERMS) {
      if (title.includes(term)) score += 2;
      else if (abstract.includes(term)) score += 1;
    }
    for (const term of NEGATIVE_TERMS) {
      if (title.includes(term)) score -= 3;
      else if (abstract.includes(term)) score -= 1;
    }
    return score;
  }

  function relevanceLabel(score) {
    if (score >= 5) return 'Très pertinent';
    if (score >= 1) return 'Pertinent';
    return 'Connexe';
  }

  /* ── F/G. Catégorisation pour les filtres et badges d'information ── */
  function categorizeArticle(article) {
    const pubTypes = (article.pubTypes || []).map(t => String(t).toLowerCase());
    const text = `${article.originalTitle || ''} ${article.originalAbstract || ''}`.toLowerCase();
    return {
      isHumanStudy:       article.isHuman === true,
      isClinicalTrial:    pubTypes.some(t => /clinical trial|randomized|randomised controlled/.test(t)),
      isSystematicReview: pubTypes.some(t => /systematic review|meta-analysis/.test(t)),
      mentionsAdverseEffects: /(adverse|side effect|toxicit)/.test(text),
      mentionsInteractions:   /interaction/.test(text),
      mentionsResistance:     /resistan/.test(text),
    };
  }

  /* ── 1. Recherche documentaire — Europe PMC (sans clé) ────────
     API publique : https://europepmc.org/RestfulWebService
     CORS ouvert, aucun secret. resultType=core inclut le résumé,
     les types de publication et les vedettes MeSH (humain/animal).
     AUCUNE donnée patient n'est incluse dans cet appel : "query" est
     la question libre du professionnel, jamais un identifiant/dossier. */
  async function searchEuropePMC(query) {
    const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
      + '?query=' + encodeURIComponent(query)
      + '&format=json&pageSize=25&resultType=core';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Recherche documentaire indisponible (HTTP ${res.status}).`);
    const data = await res.json();

    const articles = (data?.resultList?.result || []).map((r, pmcRank) => {
      const pubTypes = r.pubTypeList?.pubType || [];
      const meshNames = (r.meshHeadingList?.meshHeading || []).map(m => String(m.descriptorName || '').toLowerCase());
      let isHuman;
      if (meshNames.includes('humans')) isHuman = true;
      else if (meshNames.includes('animals')) isHuman = false;

      const article = {
        id: r.id || '', source: r.source || '',
        originalTitle:    r.title || '(sans titre)',
        originalAbstract: stripHtml(r.abstractText || ''),
        sourceLanguage:   normalizeLanguage(r.language),
        authors:  r.authorString || '',
        journal:  r.journalInfo?.journal?.title || r.journalTitle || r.bookOrReportDetails?.publisher || '',
        year:     r.pubYear || '',
        pubTypes,
        isHuman,
        pmcRank,
        link: r.doi ? `https://doi.org/${r.doi}`
              : (r.id && r.source ? `https://europepmc.org/abstract/${r.source}/${r.id}` : ''),
        // Renseignés seulement si une synthèse Claude réussit — jamais
        // une valeur inventée en son absence (voir claudeSynthesis).
        translatedTitle: null,
        translatedAbstract: null,
      };
      article.relevanceScore = scoreArticle(article);
      Object.assign(article, categorizeArticle(article));
      return article;
    });

    // Tri par pertinence clinique — AUCUNE suppression, uniquement un
    // ordre d'affichage par défaut (voir aussi le bouton "Privilégier
    // les résultats cliniquement pertinents" dans l'interface).
    articles.sort((a, b) => b.relevanceScore - a.relevanceScore);
    articles.forEach((a, i) => { a.citationIndex = i + 1; });
    return articles;
  }

  /* ── 2. Synthèse Claude (optionnelle, clé de l'établissement) ──
     Appel direct navigateur à l'API Anthropic (en-tête CORS dédié).
     La synthèse est FONDÉE sur les articles trouvés (passés en
     contexte, jamais de donnée patient) et doit citer ses sources [n].
     Réponse structurée (synthèse + traductions par article) via un
     format texte délimité simple — plus robuste qu'un JSON strict face
     à une réponse partiellement mal formée (voir parseStructuredResponse,
     qui ne bloque jamais l'affichage des sources originales en cas
     d'échec de parsing). */
  const SYNTHESIS_SYSTEM_PROMPT =
    "Tu es un assistant de recherche médicale pour professionnels de santé. " +
    "Réponds UNIQUEMENT en français, de façon structurée et concise, en te fondant EXCLUSIVEMENT sur les articles fournis. " +
    "Cite chaque affirmation avec le numéro de sa source entre crochets, ex. [1], [2]. " +
    "Structure la synthèse en sections explicites : Indications médicales, Efficacité, Risques et effets indésirables, Résistances (si pertinent), Niveau de preuve. " +
    "Ne pose jamais de diagnostic, ne rédige jamais de prescription ni de posologie finale — rappelle que la décision clinique appartient au professionnel de santé. " +
    "Réponds STRICTEMENT dans ce format, sans texte avant ni après :\n" +
    "[SYNTHESE]\n(la synthèse structurée ci-dessus)\n[/SYNTHESE]\n" +
    "[TRADUCTIONS]\n" +
    "(une ligne par article fourni, au format exact : NUMERO|Titre traduit en français|Résumé français en 2-3 phrases — jamais de balise HTML)\n" +
    "[/TRADUCTIONS]";

  function parseStructuredResponse(text, articleCount) {
    const synthMatch = text.match(/\[SYNTHESE\]([\s\S]*?)\[\/SYNTHESE\]/);
    const synthesis = (synthMatch ? synthMatch[1] : text).trim() || null;

    const translations = new Map();
    const transMatch = text.match(/\[TRADUCTIONS\]([\s\S]*?)\[\/TRADUCTIONS\]/);
    if (transMatch) {
      for (const line of transMatch[1].split('\n')) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const parts = trimmedLine.split('|');
        if (parts.length < 3) continue;
        const idx = parseInt(parts[0].trim(), 10);
        if (!Number.isInteger(idx) || idx < 1 || idx > articleCount) continue;
        translations.set(idx, {
          translatedTitle: parts[1].trim(),
          translatedAbstract: parts.slice(2).join('|').trim(),
        });
      }
    }
    return { synthesis, translations };
  }

  async function claudeSynthesis(query, articles) {
    const apiKey = getApiKey();
    if (!apiKey || !articles.length) return null;

    const sourcesText = articles.map(a =>
      `[${a.citationIndex}] ${a.originalTitle} — ${a.authors} (${a.journal}, ${a.year})\nRésumé original (${languageLabel(a.sourceLanguage)}) : ${(a.originalAbstract || '(non disponible)').slice(0, 1500)}`
    ).join('\n\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Requis pour un appel direct depuis un navigateur (choix
        // assumé : la clé appartient à l'établissement et reste sur
        // son poste — pas de backend dans cette application).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        system: SYNTHESIS_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Question du professionnel : ${query}\n\nArticles trouvés (Europe PMC) :\n\n${sourcesText}`,
        }],
      }),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Clé API Claude invalide ou révoquée — vérifiez la configuration.');
      if (res.status === 429) throw new Error('Quota IA atteint — réessayez dans quelques instants.');
      throw new Error(`Synthèse IA indisponible (HTTP ${res.status}).`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') return null;
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return null;
    return parseStructuredResponse(text, articles.length);
  }

  /* ── État d'affichage (filtres, bascules) — réinitialisé à chaque
     nouvelle recherche (sauf la préférence "prioritize", conservée). ── */
  const _uiState = { filter: 'all', year: '', prioritize: true, openOriginal: new Set(), expandedAbstract: new Set() };
  let _lastState = { query: '', articles: [], synthesis: null, synthesisError: null };

  const FILTER_DEFS = [
    { key:'all',          label:'Tous les résultats' },
    { key:'human',        label:'Études humaines' },
    { key:'trials',        label:'Essais cliniques' },
    { key:'reviews',       label:'Revues systématiques' },
    { key:'adverse',       label:'Effets indésirables' },
    { key:'interactions',  label:'Interactions' },
    { key:'resistance',    label:'Résistance' },
  ];

  function matchesFilter(article, key) {
    switch (key) {
      case 'human':        return article.isHumanStudy;
      case 'trials':        return article.isClinicalTrial;
      case 'reviews':       return article.isSystematicReview;
      case 'adverse':       return article.mentionsAdverseEffects;
      case 'interactions':  return article.mentionsInteractions;
      case 'resistance':    return article.mentionsResistance;
      default:              return true;
    }
  }

  function renderFilterBar(articles) {
    const years = Array.from(new Set(articles.map(a => a.year).filter(Boolean))).sort((a, b) => b - a);
    return `
      <div class="header-actions" style="margin-bottom:.6rem">
        ${FILTER_DEFS.map(f => `
          <button class="chip-filter ${_uiState.filter === f.key ? 'active' : ''}" onclick="MedicalAIModule.setFilter('${f.key}')">${esc(f.label)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-bottom:.6rem;font-size:.82rem">
        <label>Année :
          <select onchange="MedicalAIModule.setYearFilter(this.value)">
            <option value="">Toutes</option>
            ${years.map(y => `<option value="${esc(y)}" ${_uiState.year === String(y) ? 'selected' : ''}>${esc(y)}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:.35rem">
          <input type="checkbox" ${_uiState.prioritize ? 'checked' : ''} onchange="MedicalAIModule.togglePrioritize()">
          Privilégier les résultats cliniquement pertinents
        </label>
      </div>`;
  }

  const ABSTRACT_TRUNCATE_LEN = 320;

  function renderArticleCard(article) {
    const idx = article.citationIndex;
    const hasTranslation = !!(article.translatedTitle || article.translatedAbstract);
    const displayTitle = article.translatedTitle || article.originalTitle;
    const displayAbstract = article.translatedAbstract || article.originalAbstract || '';
    const expanded = _uiState.expandedAbstract.has(idx);
    const truncated = displayAbstract.length > ABSTRACT_TRUNCATE_LEN && !expanded
      ? displayAbstract.slice(0, ABSTRACT_TRUNCATE_LEN) + '…' : displayAbstract;
    const showOriginal = _uiState.openOriginal.has(idx);

    const pubTypeLabel = (article.pubTypes && article.pubTypes[0]) || 'Article';
    const originKind = article.isHuman === true ? 'Étude humaine'
      : article.isHuman === false ? 'Étude animale/laboratoire' : null;

    return `
      <div class="record-card ai-result-card">
        <div class="record-header">
          <span class="chip" title="${esc(RELEVANCE_DISCLAIMER)}">${esc(relevanceLabel(article.relevanceScore))}</span>
          ${article.year ? `<span class="record-date">${esc(article.year)}</span>` : ''}
        </div>
        <p><strong>[${idx}] ${esc(displayTitle)}</strong>${hasTranslation ? ' <small class="muted">(traduction automatique)</small>' : ''}</p>
        <p class="muted" style="font-size:.78rem">
          ${esc(article.authors)}${article.journal ? ' · ' + esc(article.journal) : ''}
          ${pubTypeLabel ? ' · ' + esc(pubTypeLabel) : ''}${originKind ? ' · ' + esc(originKind) : ''}
          · Résumé ${article.originalAbstract ? 'disponible' : 'non disponible'}
        </p>
        ${truncated ? `
          <p style="font-size:.8rem;white-space:pre-wrap">${esc(truncated)}</p>
          ${displayAbstract.length > ABSTRACT_TRUNCATE_LEN ? `<button class="btn btn-ghost btn-xs" onclick="MedicalAIModule.toggleAbstract(${idx})">${expanded ? 'Lire moins' : 'Lire davantage'}</button>` : ''}
        ` : ''}
        ${hasTranslation ? `
          <div style="margin-top:.4rem">
            <button class="btn btn-ghost btn-xs" onclick="MedicalAIModule.toggleOriginal(${idx})">
              ${showOriginal ? '🔽 Masquer le texte original' : '🔼 Voir le texte original'}
            </button>
            ${showOriginal ? `
              <div style="margin-top:.4rem;padding:.5rem;border-left:2px solid var(--border);font-size:.78rem">
                <p class="muted">Texte original (${esc(languageLabel(article.sourceLanguage))}) :</p>
                <p><strong>${esc(article.originalTitle)}</strong></p>
                ${article.originalAbstract ? `<p style="white-space:pre-wrap">${esc(article.originalAbstract)}</p>` : ''}
              </div>` : ''}
          </div>` : ''}
        ${article.link ? `<p style="margin-top:.4rem"><a href="${esc(article.link)}" target="_blank" rel="noopener noreferrer">Lire l'article original ↗</a></p>` : ''}
      </div>`;
  }

  /* ── Rendu des résultats (relit _lastState + _uiState à chaque
     appel — permet aux filtres/bascules de se rafraîchir sans
     relancer de recherche réseau). ── */
  function renderResults(el) {
    if (!el) return;
    const { query, articles, synthesis, synthesisError } = _lastState;

    let list = articles.filter(a => matchesFilter(a, _uiState.filter));
    if (_uiState.year) list = list.filter(a => String(a.year) === _uiState.year);
    list = list.slice().sort((a, b) => _uiState.prioritize
      ? b.relevanceScore - a.relevanceScore
      : a.pmcRank - b.pmcRank);

    const hasKey = !!getApiKey();
    const hasAnyTranslation = articles.some(a => a.translatedTitle || a.translatedAbstract);

    const noticeHtml = !hasKey
      ? `<div class="alert-box" style="margin-bottom:.6rem">${esc(NO_KEY_NOTICE)}</div>`
      : (synthesisError && !hasAnyTranslation
          ? `<div class="alert-box" style="margin-bottom:.6rem">La traduction n'a pas pu être générée pour cette recherche (${esc(synthesisError)}). Les articles sont affichés dans leur langue de publication.</div>`
          : '');

    const sourcesHtml = list.length ? `
      <h3 style="margin-top:${synthesis ? '1rem' : '0'}">📚 Articles trouvés (${list.length}${list.length !== articles.length ? ` sur ${articles.length}` : ''})</h3>
      ${renderFilterBar(articles)}
      <div class="ai-results-grid">
        ${list.map(a => renderArticleCard(a)).join('')}
      </div>` : (articles.length
        ? `<p>Aucun résultat pour ce filtre. <button class="btn btn-ghost btn-xs" onclick="MedicalAIModule.setFilter('all')">Réinitialiser les filtres</button></p>`
        : `<p>Aucun article trouvé pour « ${esc(query)} ». Essayez des termes médicaux en anglais.</p>`);

    el.style.display = 'block';
    el.innerHTML = `
      ${noticeHtml}
      ${synthesis ? `<h3>🧠 Synthèse (IA — fondée sur les articles ci-dessous, traduction automatique)</h3>
      <div style="white-space:pre-wrap;font-size:.85rem">${esc(synthesis)}</div>` : ''}
      ${sourcesHtml}
      <hr>
      <small>${SAFETY_NOTICE}</small><br>
      <small class="muted">${RELEVANCE_DISCLAIMER}</small>
    `;
  }

  function setFilter(key)     { _uiState.filter = key; renderResults(document.getElementById('ai-response')); }
  function setYearFilter(y)   { _uiState.year = y || ''; renderResults(document.getElementById('ai-response')); }
  function togglePrioritize() { _uiState.prioritize = !_uiState.prioritize; renderResults(document.getElementById('ai-response')); }
  function toggleOriginal(idx) {
    if (_uiState.openOriginal.has(idx)) _uiState.openOriginal.delete(idx); else _uiState.openOriginal.add(idx);
    renderResults(document.getElementById('ai-response'));
  }
  function toggleAbstract(idx) {
    if (_uiState.expandedAbstract.has(idx)) _uiState.expandedAbstract.delete(idx); else _uiState.expandedAbstract.add(idx);
    renderResults(document.getElementById('ai-response'));
  }

  async function render(container) {
    HospitalPermissions.requireRoute('ai');

    const gate = await CloudDB.subscriptionAllowsWrite('use_medical_ai');
    if (!gate.allowed) {
      container.innerHTML = `
        <div class="card empty-state">
          <h3>IA désactivée</h3>
          <p>${esc(gate.message || "Votre abonnement ne permet pas actuellement d'utiliser l'IA médicale.")}</p>
        </div>
      `;
      return;
    }

    const session = window.HospitalAuth?.getSession?.();
    const canConfigureKey = ['admin_hospital', 'admin'].includes(session?.role || '') ||
      (window.Auth?.getUser?.()?.role === 'admin');
    const hasKey = !!getApiKey();

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>IA médicale</h1><p>Recherche dans la littérature médicale mondiale (Europe PMC / PubMed)${hasKey ? ' + synthèse en français' : ''}</p></div>
      </div>

      <div class="alert-box">
        ⚠️ ${SAFETY_NOTICE}
      </div>

      <div class="card">
        <form onsubmit="MedicalAIModule.ask(event)">
          <div class="form-group">
            <label>Recherche médicale</label>
            <textarea id="ai-query" rows="4" required
              placeholder="Exemple : interaction entre amoxicilline et ibuprofène — de préférence en anglais (littérature internationale), le français est accepté"></textarea>
          </div>
          <button class="btn btn-primary btn-full">🔎 Rechercher dans la littérature</button>
        </form>
        <p class="muted" style="margin-top:.5rem;font-size:.75rem">
          Sources : Europe PMC (PubMed, essais cliniques, prépublications) — littérature majoritairement en anglais.
          ${hasKey ? 'Une synthèse en français est générée par IA à partir des articles trouvés, avec traduction des titres/résumés.' : NO_KEY_NOTICE}
        </p>
      </div>

      <div id="ai-response" class="card" style="display:none"></div>

      ${canConfigureKey ? `
      <div class="card">
        <h3>⚙️ Synthèse IA (optionnel)</h3>
        <p class="muted" style="font-size:.78rem">
          Avec une clé API Claude (Anthropic) fournie par votre établissement, les résultats sont accompagnés
          d'une synthèse en français citant ses sources, et les titres/résumés sont traduits. La clé reste
          <strong>uniquement sur cet appareil</strong> — elle n'est jamais envoyée à MedConnect ni stockée dans le cloud.
        </p>
        <div class="form-group">
          <label>Clé API Claude ${hasKey ? '(configurée sur cet appareil ✅)' : '(non configurée)'}</label>
          <input type="password" id="ai-key-input" class="inp" placeholder="Collez la clé API de votre établissement" autocomplete="off">
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="MedicalAIModule.saveKey()">Enregistrer sur cet appareil</button>
          ${hasKey ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="MedicalAIModule.removeKey()">Retirer la clé</button>` : ''}
        </div>
      </div>` : ''}
    `;
  }

  function saveKey() {
    const v = document.getElementById('ai-key-input')?.value?.trim();
    if (!v) { App.toast('Collez une clé API avant d\'enregistrer.', 'error'); return; }
    setApiKey(v);
    App.toast('✅ Clé enregistrée sur cet appareil.');
    HospitalDesktopUI.navigate('ai');
  }

  function removeKey() {
    setApiKey('');
    App.toast('Clé retirée de cet appareil.');
    HospitalDesktopUI.navigate('ai');
  }

  // Anti double-appui : recherche + synthèse durent plusieurs secondes.
  let _asking = false;
  async function ask(e) {
    e.preventDefault();
    if (_asking) return;
    _asking = true;
    const submitBtn = e.target?.querySelector?.('button');
    const label = submitBtn?.textContent || '';
    try {
      await CloudDB.requireWritableSubscription('use_medical_ai');

      const rawQuery = document.getElementById('ai-query').value.trim();
      if (!rawQuery) return;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Recherche en cours…'; }
      const hospitalId = await CloudDB.getActiveHospitalId();
      const profile = await CloudDB.getCurrentUserProfile();

      // 1. Recherche documentaire réelle (sans clé). AUCUNE donnée
      // patient n'entre dans cette requête — uniquement la question
      // libre du professionnel (éventuellement élargie, jamais
      // remplacée — voir buildSearchQuery).
      const searchQuery = buildSearchQuery(rawQuery);
      const articles = await searchEuropePMC(searchQuery);

      // 2. Synthèse IA optionnelle — un échec de synthèse/traduction
      //    n'empêche JAMAIS d'afficher les articles (sources originales
      //    toujours visibles).
      let synthesis = null;
      let synthesisError = null;
      if (getApiKey() && articles.length) {
        if (submitBtn) submitBtn.textContent = '⏳ Synthèse IA…';
        try {
          const result = await claudeSynthesis(rawQuery, articles);
          if (result) {
            synthesis = result.synthesis;
            result.translations.forEach((t, idx) => {
              const article = articles.find(a => a.citationIndex === idx);
              if (article) {
                article.translatedTitle = t.translatedTitle || null;
                article.translatedAbstract = t.translatedAbstract || null;
              }
            });
          }
        } catch (err) { synthesisError = err.message; console.warn('[MedicalAI] Synthèse :', err); }
      }

      // Journal d'audit — résumé court, jamais le texte intégral, jamais
      // la clé, jamais de donnée patient (la question elle-même ne doit
      // pas en contenir, mais rien ici ne pourrait de toute façon en
      // ajouter).
      await CloudDB.createDoc('aiQueries', {
        establishmentId: hospitalId,
        hospitalId, // alias — resolveHospitalId() accepte les deux
        userId: profile.uid,
        role: profile.role || '',
        query: rawQuery,
        responseSummary: `${articles.length} article(s) Europe PMC${synthesis ? ' + synthèse IA' : ''}`,
        safetyNoticeAccepted: true,
      });

      _lastState = { query: rawQuery, articles, synthesis, synthesisError };
      _uiState.filter = 'all'; _uiState.year = '';
      _uiState.openOriginal = new Set(); _uiState.expandedAbstract = new Set();
      renderResults(document.getElementById('ai-response'));
      if (synthesisError) App.toast(`Articles affichés — synthèse IA indisponible : ${synthesisError}`, 'warning');
    } catch (err) {
      console.error('[MedicalAI] ask :', err);
      App.toast(err.message || 'Erreur lors de la recherche.', 'error');
    } finally {
      _asking = false;
      if (submitBtn && document.body.contains(submitBtn)) {
        submitBtn.disabled = false; submitBtn.textContent = label;
      }
    }
  }

  return {
    render, ask, saveKey, removeKey,
    setFilter, setYearFilter, togglePrioritize, toggleOriginal, toggleAbstract,
    // Exposées pour les tests (fonctions pures, aucun effet de bord) :
    _stripHtml: stripHtml, _normalizeLanguage: normalizeLanguage, _languageLabel: languageLabel,
    _isBareDrugQuery: isBareDrugQuery, _buildSearchQuery: buildSearchQuery,
    _scoreArticle: scoreArticle, _relevanceLabel: relevanceLabel, _categorizeArticle: categorizeArticle,
    _parseStructuredResponse: parseStructuredResponse,
  };
})();

window.MedicalAIModule = MedicalAIModule;
