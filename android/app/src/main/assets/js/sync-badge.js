/* =====================================================
   MedConnect 2.0 — SyncBadge
   Indicateur vivant de l'état de synchronisation cloud.

   Objectif : après les pertes de données passées, l'utilisateur
   doit VOIR à tout moment si son travail est sauvegardé dans le
   cloud ou encore en attente. S'appuie sur la file d'écriture
   persistante (DB.outboxCount) et l'état réseau.

   Trois états :
   - hors-ligne          → 📡 orange, « Hors ligne »
   - file non vide       → ⏳ orange, « N en attente de sync »
   - tout envoyé + online → ☁️ vert,  « Sauvegardé »
   ===================================================== */
const SyncBadge = (() => {
  let _timer = null;

  function pendingCount() {
    try { return window.DB?.outboxCount?.() || 0; } catch (_) { return 0; }
  }

  function render() {
    const el = document.getElementById('sync-badge-container');
    if (!el) return;

    const online = navigator.onLine !== false;
    const pending = pendingCount();

    let icon, text, color;
    if (!online) {
      icon = '📡'; text = 'Hors ligne'; color = 'var(--accent, #f59e0b)';
    } else if (pending > 0) {
      icon = '⏳'; text = `${pending} en attente de sync`; color = 'var(--accent, #f59e0b)';
    } else {
      icon = '☁️'; text = 'Sauvegardé'; color = 'var(--secondary, #10b981)';
    }

    el.innerHTML = `
      <div class="sync-badge-live" style="color:${color}"
           title="${online ? 'Connexion active' : 'Aucune connexion'} · ${pending} écriture(s) en file"
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
      await window.DB?.flushOutbox?.();
      render();
      const left = pendingCount();
      window.App?.toast?.(left ? `${left} écriture(s) encore en attente.` : '✅ Tout est synchronisé.');
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
