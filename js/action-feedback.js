/* =====================================================
   MedConnect 2.0 — ActionFeedback (chantier "workflows
   mobile/desktop", section 14)

   Bug confirmé : chaque écran critique (envoi de message,
   création de patient, admission…) réimplémentait à la main son
   propre verrou de réentrance + état du bouton + toast
   confirmé/en attente/échec (voir js/hospital-messages.js send(),
   js/network.js sendMessage(), js/hospital-reception.js
   saveIntake()…) — du code dupliqué, avec des variations
   involontaires d'un écran à l'autre (parfois pas de verrou,
   parfois pas de distinction confirmé/en file).

   ActionFeedback centralise ce SEUL comportement, sans rien
   décider à la place de l'appelant : c'est un helper d'affichage
   et de verrouillage, jamais une logique métier. Réutilise le
   contrat déjà établi ailleurs dans ce chantier
   ({ ok, state: 'confirmed'|'queued', cloudConfirmed }, voir
   js/network.js notify()/markRead()/markUnread()).

   API :
   - start(btn, label)    : verrouille le bouton (busy), retourne
                            false si déjà en cours (réentrance).
   - reset(btn)            : restaure le bouton (label + enabled).
   - progress(btn, label)  : change juste le texte pendant l'action
                            (sans re-verrouiller).
   - confirmed(message)    : toast succès plein (✅).
   - queued(message)       : toast succès partiel (📶 en attente).
   - failed(message)       : toast erreur (❌ implicite via App.toast).
   - withAction(btn, opts, fn) : orchestre tout le cycle pour une
     action async retournant { ok, state, cloudConfirmed } —
     start → fn() → confirmed/queued/failed → reset, dans un
     try/finally (reset toujours appelé, même en cas d'exception).
   ===================================================== */
const ActionFeedback = (() => {
  function start(btn, label) {
    if (!btn) return true;
    if (btn.dataset.processing === 'true') return false;
    btn.dataset.processing = 'true';
    btn.dataset.originalLabel = btn.textContent;
    btn.disabled = true;
    if (label) btn.textContent = label;
    return true;
  }

  function progress(btn, label) {
    if (btn && label) btn.textContent = label;
  }

  function reset(btn) {
    if (!btn) return;
    btn.disabled = false;
    if (btn.dataset.originalLabel != null) btn.textContent = btn.dataset.originalLabel;
    delete btn.dataset.processing;
    delete btn.dataset.originalLabel;
  }

  function confirmed(message) {
    window.App?.toast?.(message);
  }

  function queued(message) {
    window.App?.toast?.(message);
  }

  function failed(message) {
    window.App?.toast?.(message || 'Action impossible.', 'error');
  }

  /* Orchestration complète d'une action async critique.
     opts:
       - startLabel   : texte affiché pendant l'exécution (ex. '⏳ Envoi…').
       - confirmedMsg : texte du toast si result.state === 'confirmed'.
       - queuedMsg    : texte du toast si result.state === 'queued'.
       - failedMsg    : texte de repli si l'exception n'a pas de .message.
     fn() doit retourner { ok, state: 'confirmed'|'queued', ... } (le
     contrat déjà établi par notify()/markRead()/markUnread()) — ou
     lever une exception, auquel cas failed() est appelé avec son
     message. Ne fait JAMAIS d'hypothèse sur ce que fn() fait
     réellement : withAction() ne remplace aucune logique métier. */
  async function withAction(btn, opts, fn) {
    const { startLabel, confirmedMsg, queuedMsg, failedMsg } = opts || {};
    if (!start(btn, startLabel)) return { ok: false, state: 'busy' };
    try {
      const result = await fn();
      if (result?.state === 'confirmed' || (result?.cloudConfirmed === true && result?.state == null)) {
        confirmed(confirmedMsg || '✅ Action effectuée.');
      } else if (result?.state === 'queued' || (result?.cloudConfirmed === false && result?.state == null)) {
        queued(queuedMsg || '📶 Enregistré localement — synchronisation en attente.');
      }
      return result;
    } catch (e) {
      failed(e?.message || failedMsg);
      throw e;
    } finally {
      reset(btn);
    }
  }

  return { start, reset, progress, confirmed, queued, failed, withAction };
})();

if (typeof window !== 'undefined') window.ActionFeedback = ActionFeedback;
if (typeof module !== 'undefined' && module.exports) module.exports = ActionFeedback;
