/* =====================================================
   MedConnect 2.0 — MedicalAIModule (recherche médicale RÉELLE)

   Remplace la réponse simulée (mock) par une vraie recherche
   médicale, en deux niveaux :

   1. RECHERCHE DOCUMENTAIRE (toujours active, sans clé) —
      Europe PMC (littérature biomédicale mondiale : PubMed,
      essais cliniques, prépublications). API REST publique,
      gratuite, CORS, sans clé. Résultats SOURCÉS : titre,
      auteurs, revue, année, résumé, lien vers l'article.

   2. SYNTHÈSE IA (optionnelle) — si l'établissement configure
      SA PROPRE clé API Claude (Anthropic), une synthèse en
      français est générée à partir des articles trouvés, avec
      citations [n]. La clé est saisie par l'administration de
      l'établissement et stockée UNIQUEMENT sur cet appareil
      (localStorage) — jamais dans le code, jamais dans
      Firestore, jamais synchronisée.

   Invariants conservés :
   - Gating abonnement ('use_medical_ai', DESKTOP_BLOCKED_ACTIONS) ;
   - Journal aiQueries (audit) ;
   - Échappement HTML de tout contenu affiché (XSS) ;
   - Aucune réponse présentée comme un avis médical.
   ===================================================== */
const MedicalAIModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const SAFETY_NOTICE =
    "Cette IA fournit une aide à la recherche médicale. La décision finale appartient au professionnel de santé.";

  /* Clé API Claude de l'établissement — locale à CET appareil. */
  const AI_KEY_STORAGE = 'mc_ai_claude_key';
  function getApiKey()    { try { return localStorage.getItem(AI_KEY_STORAGE) || ''; } catch { return ''; } }
  function setApiKey(k)   { try { k ? localStorage.setItem(AI_KEY_STORAGE, k) : localStorage.removeItem(AI_KEY_STORAGE); } catch {} }

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
        <div><h1>IA médicale</h1><p>Recherche dans la littérature médicale mondiale (Europe PMC / PubMed)${hasKey ? ' + synthèse IA' : ''}</p></div>
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
          ${hasKey ? 'Une synthèse en français est générée par IA à partir des articles trouvés.' : ''}
        </p>
      </div>

      <div id="ai-response" class="card" style="display:none"></div>

      ${canConfigureKey ? `
      <div class="card">
        <h3>⚙️ Synthèse IA (optionnel)</h3>
        <p class="muted" style="font-size:.78rem">
          Avec une clé API Claude (Anthropic) fournie par votre établissement, les résultats sont accompagnés
          d'une synthèse en français citant ses sources. La clé reste <strong>uniquement sur cet appareil</strong> —
          elle n'est jamais envoyée à MedConnect ni stockée dans le cloud.
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

  /* ── 1. Recherche documentaire — Europe PMC (sans clé) ────────
     API publique : https://europepmc.org/RestfulWebService
     CORS ouvert, aucun secret. resultType=core inclut le résumé. */
  async function searchEuropePMC(query) {
    const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
      + '?query=' + encodeURIComponent(query)
      + '&format=json&pageSize=8&resultType=core';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Recherche documentaire indisponible (HTTP ${res.status}).`);
    const data = await res.json();
    return (data?.resultList?.result || []).map(r => ({
      title:    r.title || '(sans titre)',
      authors:  r.authorString || '',
      journal:  r.journalInfo?.journal?.title || r.journalTitle || r.bookOrReportDetails?.publisher || '',
      year:     r.pubYear || '',
      abstract: r.abstractText || '',
      link:     r.doi ? `https://doi.org/${r.doi}`
              : (r.id && r.source ? `https://europepmc.org/abstract/${r.source}/${r.id}` : ''),
    }));
  }

  /* ── 2. Synthèse Claude (optionnelle, clé de l'établissement) ──
     Appel direct navigateur à l'API Anthropic (en-tête CORS dédié).
     La synthèse est FONDÉE sur les articles trouvés (passés en
     contexte) et doit citer ses sources [n]. */
  async function claudeSynthesis(query, articles) {
    const apiKey = getApiKey();
    if (!apiKey || !articles.length) return null;

    const sourcesText = articles.map((a, i) =>
      `[${i + 1}] ${a.title} — ${a.authors} (${a.journal}, ${a.year})\nRésumé : ${(a.abstract || '(non disponible)').slice(0, 1500)}`
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
        // Synthèse volontairement concise (réponse courte souhaitée).
        max_tokens: 4096,
        system: "Tu es un assistant de recherche médicale pour professionnels de santé. "
          + "Réponds en français, de façon structurée et concise. Fonde ta réponse UNIQUEMENT sur les articles fournis, "
          + "en citant les sources entre crochets [1], [2]… après chaque affirmation. Si les articles ne permettent pas de répondre, dis-le. "
          + "Termine par une phrase rappelant que la décision clinique appartient au professionnel de santé. "
          + "Ne pose jamais de diagnostic final et ne prescris rien.",
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
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || null;
  }

  /* ── Rendu des résultats ── */
  function renderResults(el, query, synthesis, articles) {
    const sourcesHtml = articles.length ? `
      <h3 style="margin-top:${synthesis ? '1rem' : '0'}">📚 Articles trouvés (${articles.length})</h3>
      <div class="records-list">
        ${articles.map((a, i) => `
          <div class="record-card">
            <p><strong>[${i + 1}] ${esc(a.title)}</strong></p>
            <p class="muted" style="font-size:.78rem">${esc(a.authors)}${a.journal ? ' · ' + esc(a.journal) : ''}${a.year ? ' · ' + esc(a.year) : ''}</p>
            ${a.abstract ? `<p style="font-size:.8rem">${esc(a.abstract.slice(0, 350))}${a.abstract.length > 350 ? '…' : ''}</p>` : ''}
            ${a.link ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Lire l'article ↗</a>` : ''}
          </div>`).join('')}
      </div>` : `<p>Aucun article trouvé pour « ${esc(query)} ». Essayez des termes médicaux en anglais.</p>`;

    el.style.display = 'block';
    el.innerHTML = `
      ${synthesis ? `<h3>🧠 Synthèse (IA — fondée sur les articles ci-dessous)</h3>
      <div style="white-space:pre-wrap;font-size:.85rem">${esc(synthesis)}</div>` : ''}
      ${sourcesHtml}
      <hr>
      <small>${SAFETY_NOTICE}</small>
    `;
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

      const query = document.getElementById('ai-query').value.trim();
      if (!query) return;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Recherche en cours…'; }
      const hospitalId = await CloudDB.getActiveHospitalId();
      const profile = await CloudDB.getCurrentUserProfile();

      // 1. Recherche documentaire réelle (sans clé).
      const articles = await searchEuropePMC(query);

      // 2. Synthèse IA optionnelle — un échec de synthèse n'empêche
      //    JAMAIS d'afficher les articles trouvés.
      let synthesis = null;
      let synthesisError = null;
      if (getApiKey() && articles.length) {
        if (submitBtn) submitBtn.textContent = '⏳ Synthèse IA…';
        try { synthesis = await claudeSynthesis(query, articles); }
        catch (err) { synthesisError = err.message; console.warn('[MedicalAI] Synthèse :', err); }
      }

      // Journal d'audit — résumé court, jamais le texte intégral.
      await CloudDB.createDoc('aiQueries', {
        establishmentId: hospitalId,
        hospitalId, // alias — resolveHospitalId() accepte les deux
        userId: profile.uid,
        role: profile.role || '',
        query,
        responseSummary: `${articles.length} article(s) Europe PMC${synthesis ? ' + synthèse IA' : ''}`,
        safetyNoticeAccepted: true,
      });

      renderResults(document.getElementById('ai-response'), query, synthesis, articles);
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

  return { render, ask, saveKey, removeKey };
})();

window.MedicalAIModule = MedicalAIModule;
