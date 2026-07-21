/* =====================================================
   MedConnect 2.0 — SyncBadge
   Indicateur vivant de l'état de synchronisation cloud.

   Objectif : après les pertes de données passées, l'utilisateur
   doit VOIR à tout moment si son travail est sauvegardé dans le
   cloud ou encore en attente. S'appuie sur la file d'écriture
   persistante (DB.outboxCount) et l'état réseau.

   États :
   - hors-ligne                     → 📡 orange, « Hors ligne »
   - file non vide, dont bloquée(s) → ⚠️ rouge,  « N en attente (dont M bloquée(s)) »
   - file non vide, purement retryable → ⏳ orange, « N en attente de sync »
   - tout envoyé + online            → ☁️ vert,  « Sauvegardé »

   Correctif (chantier "workflows mobile/desktop", sections 1-2) : bug
   confirmé — le badge ne distinguait jamais une écriture transitoire
   (réseau, se corrigera seule) d'une écriture structurellement
   bloquée (permission Firestore refusée — ne se corrigera JAMAIS
   automatiquement) : les deux affichaient le même ⏳ "en attente",
   masquant un vrai problème de configuration indéfiniment. Le
   nouvel état ⚠️ (DB.getOutboxSummary().blocked > 0) le rend visible ;
   voir aussi js/settings.js renderSyncInspectorSection() pour le détail
   par écriture. */
const SyncBadge = (() => {
  let _timer = null;

  function pendingCount() {
    try { return window.DB?.outboxCount?.() || 0; } catch (_) { return 0; }
  }

  function summary() {
    try { return window.DB?.getOutboxSummary?.() || { total: pendingCount(), retryable: pendingCount(), blocked: 0 }; }
    catch (_) { return { total: 0, retryable: 0, blocked: 0 }; }
  }

  function render() {
    const el = document.getElementById('sync-badge-container');
    if (!el) return;

    const online = navigator.onLine !== false;
    const { total: pending, blocked } = summary();

    let icon, text, color;
    if (!online) {
      icon = '📡'; text = 'Hors ligne'; color = 'var(--accent, #f59e0b)';
    } else if (blocked > 0) {
      icon = '⚠️'; text = `${pending} en attente (dont ${blocked} bloquée(s))`; color = 'var(--danger, #ef4444)';
    } else if (pending > 0) {
      icon = '⏳'; text = `${pending} en attente de sync`; color = 'var(--accent, #f59e0b)';
    } else {
      icon = '☁️'; text = 'Sauvegardé'; color = 'var(--secondary, #10b981)';
    }

    el.innerHTML = `
      <div class="sync-badge-live" style="color:${color}"
           title="${online ? 'Connexion active' : 'Aucune connexion'} · ${pending} écriture(s) en file${blocked ? ` · ${blocked} bloquée(s)` : ''}"
           onclick="SyncBadge.forceSync()">
        <span>${icon}</span> ${text}
      </div>`;
  }

  async function forceSync() {
    // Rejeu manuel à la demande de l'utilisateur.
    if (navigator.onLine === false) {
      window.App?.toast?.('Aucune connexion — la synchronisation reprendra automatiquement.', 'warning');
      return;
    }
    try {
      // Correctif (chantier "workflows mobile/desktop", sections 1-2) :
      // un clic explicite de l'utilisateur doit rejouer MAINTENANT,
      // même les entrées dont le délai d'attente exponentiel
      // (nextRetryAt) n'est pas encore écoulé — c'est justement le but
      // d'un rejeu manuel (vérifier si la situation a changé).
      // Chantier v2.9.34 (P0) : ne rejoue JAMAIS les entrées bloquées —
      // seuls les boutons explicites de Paramètres → Synchronisation
      // (« Vérifier les bloquées », « Réessayer cette opération ») le
      // font, en connaissance de cause.
      await window.DB?.flushOutbox?.({ force: true });
      render();
      const { total: left, blocked } = summary();
      window.App?.toast?.(!left
        ? '✅ Tout est synchronisé.'
        : blocked
          ? `⚠️ ${blocked} écriture(s) bloquée(s) — voir Paramètres pour le détail.`
          : `${left} écriture(s) encore en attente.`);
    } catch (e) {
      console.warn('[SyncBadge] forceSync :', e);
    }
  }

  function start() {
    render();
    if (_timer) clearInterval(_timer);
    _timer = setInterval(render, 5000);
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
  }

  if (typeof window !== 'undefined') {
    if (document.readyState !== 'loading') setTimeout(start, 500);
    else window.addEventListener('DOMContentLoaded', () => setTimeout(start, 500));
  }

  return { render, forceSync, start };
})();

window.SyncBadge = SyncBadge;
