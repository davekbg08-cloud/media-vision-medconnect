/* =====================================================
   MedConnect 2.0 — MedicalAIModule (bundle desktop, adapté)
   Assistant de recherche médicale (desktop, sous abonnement).

   ADAPTATIONS vs bundle d'origine :
   - Gating abonnement via ExchangeBridge ('use_medical_ai',
     déjà dans DESKTOP_BLOCKED_ACTIONS), pas via le champ
     hospital.subscriptionStatus (non source de vérité) ;
   - Échappement HTML de la requête utilisateur avant
     ré-affichage (XSS possible dans la version d'origine) ;
   - Réponse mock conservée : le module reste volontairement
     inerte tant qu'aucune API IA n'est configurée. Aucune
     réponse n'est présentée comme un avis médical.
   ===================================================== */
const MedicalAIModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const SAFETY_NOTICE =
    "Cette IA fournit une aide à la recherche médicale. La décision finale appartient au professionnel de santé.";

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

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>IA médicale</h1><p>Assistant de recherche médicale MedConnect</p></div>
      </div>

      <div class="alert-box">
        ⚠️ ${SAFETY_NOTICE}
      </div>

      <div class="card">
        <form onsubmit="MedicalAIModule.ask(event)">
          <div class="form-group">
            <label>Recherche médicale générale</label>
            <textarea id="ai-query" rows="5" required
              placeholder="Exemple : interaction générale entre amoxicilline et ibuprofène..."></textarea>
          </div>
          <button class="btn btn-primary btn-full">Rechercher</button>
        </form>
      </div>

      <div id="ai-response" class="card" style="display:none"></div>
    `;
  }

  async function ask(e) {
    e.preventDefault();
    try {
      await CloudDB.requireWritableSubscription('use_medical_ai');

      const query = document.getElementById('ai-query').value.trim();
      if (!query) return;
      const hospitalId = await CloudDB.getActiveHospitalId();
      const profile = await CloudDB.getCurrentUserProfile();

      const response = mockSafeResponse(query);

      await CloudDB.createDoc('aiQueries', {
        establishmentId: hospitalId,
        hospitalId, // alias — resolveHospitalId() accepte les deux
        userId: profile.uid,
        role: profile.role || '',
        query,
        responseSummary: response,
        safetyNoticeAccepted: true,
      });

      const el = document.getElementById('ai-response');
      el.style.display = 'block';
      el.innerHTML = `
        <h3>Réponse de recherche</h3>
        <p>${esc(response)}</p>
        <hr>
        <small>${SAFETY_NOTICE}</small>
      `;
    } catch (err) {
      console.error('[MedicalAI] ask :', err);
      App.toast(err.message || 'Erreur lors de la recherche.', 'error');
    }
  }

  function mockSafeResponse(query) {
    return `Recherche reçue : "${query}". Module IA sécurisé en attente de configuration API. Ne pas utiliser comme diagnostic final.`;
  }

  return { render, ask };
})();

window.MedicalAIModule = MedicalAIModule;
