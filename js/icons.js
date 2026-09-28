/* =====================================================
   Icônes MedConnect (refonte « socle visuel »)

   Remplace progressivement les emojis par de vraies icônes au trait
   (sous-ensemble Tabler Icons, MIT) servies depuis vendor/icons/ :
   rendu net et identique sur tous les téléphones, couleur héritée du
   texte (currentColor), aucune ressource externe (CSP respectée).
   ===================================================== */
(function () {
  'use strict';
  const SPRITE = './vendor/icons/medconnect-icons.svg';

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

  window.McIcons = { icon, sectionIcon, SECTIONS };
})();
