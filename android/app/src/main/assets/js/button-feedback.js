/* =====================================================
   MedConnect — Retour visuel + anti double-appui UNIVERSELS
   -----------------------------------------------------
   Demande client : TOUS les boutons de l'application doivent
   réagir visiblement quand on les presse (l'utilisateur sait
   que son action est passée) et ne jamais déclencher deux fois
   la même action sur un double appui.

   Principe (non invasif) :
   - Retour visuel : classe .btn-pressed posée au clic, retirée
     après l'animation (css/style.css).
   - Anti double-appui : un second clic sur le MÊME bouton dans
     la fenêtre de garde (600 ms) est avalé en phase de capture
     (stopImmediatePropagation + preventDefault) — le handler
     inline onclick et l'action par défaut (submit) ne se
     déclenchent pas une seconde fois.

   IMPORTANT — ce module ne touche JAMAIS à button.disabled :
   les systèmes dédiés existants (auth-ui-cleanup setBusy,
   registration-submit-flow setSubmitting, saveNewPatient…)
   gardent la main sans conflit. Il s'ajoute par-dessus, pour
   tous les boutons qui n'ont aucune protection propre.

   Opt-out ponctuel : data-no-guard="true" sur le bouton.
   ===================================================== */
(function () {
  'use strict';

  const GUARD_MS = 600;      // fenêtre anti double-appui
  const PRESS_ANIM_MS = 300; // durée du retour visuel

  const SELECTOR = 'button, .btn, .btn-p, .role-btn, [role="button"]';

  function onCaptureClick(ev) {
    const btn = ev.target?.closest?.(SELECTOR);
    if (!btn || btn.dataset.noGuard === 'true') return;

    const now = Date.now();
    const last = Number(btn.dataset.lastPress || 0);

    if (now - last < GUARD_MS) {
      // Double appui : on avale l'événement AVANT qu'il n'atteigne le
      // handler du bouton — aucune action relancée.
      ev.stopImmediatePropagation();
      ev.preventDefault();
      return;
    }
    btn.dataset.lastPress = String(now);

    // Retour visuel : le bouton « répond » à l'appui.
    btn.classList.remove('btn-pressed'); // relance propre si résiduel
    // Reflow pour réarmer l'animation CSS.
    void btn.offsetWidth;
    btn.classList.add('btn-pressed');
    setTimeout(() => {
      if (btn.isConnected) btn.classList.remove('btn-pressed');
    }, PRESS_ANIM_MS);
  }

  // Phase de capture sur document : passe avant tous les onclick inline.
  document.addEventListener('click', onCaptureClick, true);
})();
