/* =====================================================
   Icônes MedConnect (refonte « socle visuel »)

   Remplace progressivement les emojis par de vraies icônes au trait
   (sous-ensemble Tabler Icons, MIT) servies depuis vendor/icons/ :
   rendu net et identique sur tous les téléphones, couleur héritée du
   texte (currentColor), aucune ressource externe (CSP respectée).
   ===================================================== */
(function () {
  'use strict';
  const SPRITE = './vendor/icons/medconnect-icons-v4.svg';

  /** Icône par nom Tabler (ex. 'stethoscope'). */
  function icon(name, extraClass) {
    const cls = extraClass ? `mc-icon ${extraClass}` : 'mc-icon';
    return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="${SPRITE}#i-${name}"></use></svg>`;
  }

  /* Rubrique de navigation → icône + couleur de catégorie.
     Chaque service garde sa couleur partout dans l'app. */
  const SECTIONS = {
    dashboard:     ['layout-dashboard', 'blue'],
    patients:      ['users', 'blue'],
    my_record:     ['id-badge-2', 'blue'],
    consultations: ['stethoscope', 'violet'],
    timeline:      ['timeline', 'violet'],
    history:       ['history', 'violet'],
    prescriptions: ['pill', 'green'],
    pharmacy_rx:   ['prescription', 'green'],
    pharmacy_map:  ['map-pin', 'green'],
    pos:           ['shopping-cart', 'green'],
    lab:           ['flask', 'orange'],
    inventory:     ['package', 'orange'],
    vaccinations:  ['vaccine', 'magenta'],
    appointments:  ['calendar-event', 'aqua'],
    map:           ['map-2', 'aqua'],
    transfers:     ['ambulance', 'red'],
    hospitals:     ['building-hospital', 'aqua'],
    inbox:         ['mail', 'yellow'],
    sales:         ['chart-line', 'violet'],
    settings:      ['settings', 'gray'],
  };

  /** Icône colorée d'une rubrique, ou null si la rubrique est inconnue. */
  function sectionIcon(section) {
    const entry = SECTIONS[section];
    if (!entry) return null;
    return `<span class="mc-tint mc-tint-${entry[1]}">${icon(entry[0])}</span>`;
  }

  /* Rôles : icône + couleur (écran de connexion, profil). */
  const ROLES = {
    patient:    ['user', 'blue'],
    doctor:     ['stethoscope', 'violet'],
    pharmacist: ['pill', 'green'],
    nurse:      ['heartbeat', 'magenta'],
    lab:        ['microscope', 'orange'],
    reception:  ['building-hospital', 'aqua'],
    admin:      ['shield-lock', 'gray'],
  };

  function roleIcon(role, extraClass) {
    const entry = ROLES[role] || ['user', 'gray'];
    const cls = extraClass ? `mc-tint mc-tint-${entry[1]} ${extraClass}` : `mc-tint mc-tint-${entry[1]}`;
    return `<span class="${cls}">${icon(entry[0])}</span>`;
  }

  /* En-têtes de page : chaque page affiche automatiquement l'icône
     colorée de sa rubrique, à la place de l'emoji du titre. Fonctionne
     pour toutes les pages sans modifier chaque module : un observateur
     décore le premier titre `.page-header h2` à chaque rendu. */
  const EMOJI_PREFIX = /^[\s\p{Extended_Pictographic}\u200D\uFE0F]+/u;

  function currentSection() {
    return document.querySelector('.nav-item.active')?.dataset?.section || null;
  }

  function decoratePageHeader(root) {
    const title = root?.querySelector?.('.page-header h2');
    if (!title || title.querySelector('.mc-page-icon')) return false;
    const tint = sectionIcon(currentSection());
    if (!tint) return false;
    const first = title.firstChild;
    if (first && first.nodeType === 3) first.textContent = first.textContent.replace(EMOJI_PREFIX, '');
    title.insertAdjacentHTML('afterbegin', tint.replace('class="mc-tint ', 'class="mc-tint mc-page-icon '));
    title.classList.add('mc-page-title');
    return true;
  }

  /* Cartes de statistiques : l'emoji de `.stat-icon` devient une icône
     colorée (même correspondance que la navigation). */
  const STAT_EMOJI = {
    '👥': ['users', 'blue'], '👤': ['user', 'blue'], '🩺': ['stethoscope', 'violet'],
    '👨\u200d⚕️': ['stethoscope', 'violet'], '👩\u200d⚕️': ['stethoscope', 'violet'],
    '📅': ['calendar-event', 'aqua'], '🗓️': ['calendar-event', 'aqua'], '📨': ['mail', 'yellow'],
    '💊': ['pill', 'green'], '🧪': ['flask', 'orange'], '💉': ['vaccine', 'magenta'],
    '🚑': ['ambulance', 'red'], '🏥': ['building-hospital', 'aqua'], '📋': ['history', 'violet'],
    '⏳': ['clock', 'yellow'], '📦': ['package', 'orange'], '📈': ['chart-line', 'violet'],
    '🛒': ['shopping-cart', 'green'], '🩹': ['heartbeat', 'magenta'], '📍': ['map-pin', 'aqua'],
    '⚠️': ['alert-triangle', 'red'], '🛏️': ['bed', 'aqua'], '👶': ['baby-carriage', 'magenta'],
    '🔬': ['microscope', 'orange'], '⚙️': ['settings', 'gray'],
  };

  function decorateStatIcons(root) {
    root?.querySelectorAll?.('.stat-icon:not([data-mc])').forEach((el) => {
      el.setAttribute('data-mc', '1');
      const entry = STAT_EMOJI[el.textContent.trim()];
      if (!entry) return;
      el.innerHTML = `<span class="mc-tint mc-tint-${entry[1]} mc-stat-tile">${icon(entry[0])}</span>`;
      el.closest('.stat-card')?.classList.add(`mc-stat-${entry[1]}`);
    });
  }

  function watchMainContent() {
    const main = document.getElementById('main-content');
    if (!main || typeof MutationObserver === 'undefined') return;
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; decoratePageHeader(main); decorateStatIcons(main); });
    }).observe(main, { childList: true, subtree: true });
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchMainContent);
    else watchMainContent();
  }

  window.McIcons = { icon, sectionIcon, roleIcon, decoratePageHeader, decorateStatIcons, SECTIONS, ROLES, STAT_EMOJI };
})();
