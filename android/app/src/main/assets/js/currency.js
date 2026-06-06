/* =====================================================
   MedConnect 2.0 — Currency Module
   150+ devises · Symboles · Format par pays
   ===================================================== */
const Currency = (() => {

  /* ── TOUTES LES DEVISES MONDIALES ─────────────────
     ISO 4217 · Symbole · Nom · Pays associés
  ──────────────────────────────────────────────────── */
  const CURRENCIES = {
    // ─── AFRIQUE ───────────────────────────────────
    CDF: { symbol:'FC',   name:'Franc Congolais',          countries:['CD'],         decimals:2, position:'after'  },
    XAF: { symbol:'FCFA', name:'Franc CFA BEAC',           countries:['CM','CG','CF','GA','GQ','TD'], decimals:0, position:'after' },
    XOF: { symbol:'CFA',  name:'Franc CFA BCEAO',          countries:['BJ','BF','CI','GW','ML','MR','NE','SN','TG'], decimals:0, position:'after' },
    NGN: { symbol:'₦',    name:'Naira Nigérian',           countries:['NG'],         decimals:2, position:'before' },
    KES: { symbol:'KSh',  name:'Shilling Kényan',          countries:['KE'],         decimals:2, position:'before' },
    GHS: { symbol:'₵',    name:'Cedi Ghanéen',             countries:['GH'],         decimals:2, position:'before' },
    ZAR: { symbol:'R',    name:'Rand Sud-Africain',        countries:['ZA'],         decimals:2, position:'before' },
    EGP: { symbol:'£',    name:'Livre Égyptienne',         countries:['EG'],         decimals:2, position:'before' },
    ETB: { symbol:'Br',   name:'Birr Éthiopien',           countries:['ET'],         decimals:2, position:'before' },
    TZS: { symbol:'TSh',  name:'Shilling Tanzanien',       countries:['TZ'],         decimals:2, position:'before' },
    UGX: { symbol:'USh',  name:'Shilling Ougandais',       countries:['UG'],         decimals:0, position:'before' },
    RWF: { symbol:'Fr',   name:'Franc Rwandais',           countries:['RW'],         decimals:0, position:'before' },
    MGA: { symbol:'Ar',   name:'Ariary Malgache',          countries:['MG'],         decimals:0, position:'before' },
    MZN: { symbol:'MT',   name:'Metical Mozambicain',      countries:['MZ'],         decimals:2, position:'before' },
    ZMW: { symbol:'K',    name:'Kwacha Zambien',           countries:['ZM'],         decimals:2, position:'before' },
    MAD: { symbol:'DH',   name:'Dirham Marocain',          countries:['MA'],         decimals:2, position:'after'  },
    TND: { symbol:'DT',   name:'Dinar Tunisien',           countries:['TN'],         decimals:3, position:'before' },
    DZD: { symbol:'DA',   name:'Dinar Algérien',           countries:['DZ'],         decimals:2, position:'after'  },
    SDG: { symbol:'SDG',  name:'Livre Soudanaise',         countries:['SD'],         decimals:2, position:'before' },
    SOS: { symbol:'Sh',   name:'Shilling Somalien',        countries:['SO'],         decimals:2, position:'before' },
    AOA: { symbol:'Kz',   name:'Kwanza Angolais',          countries:['AO'],         decimals:2, position:'before' },
    ZWL: { symbol:'Z$',   name:'Dollar Zimbabwéen',        countries:['ZW'],         decimals:2, position:'before' },
    BWP: { symbol:'P',    name:'Pula Botswanaise',         countries:['BW'],         decimals:2, position:'before' },
    NAD: { symbol:'N$',   name:'Dollar Namibien',          countries:['NA'],         decimals:2, position:'before' },
    LSL: { symbol:'L',    name:'Loti du Lesotho',          countries:['LS'],         decimals:2, position:'before' },
    SZL: { symbol:'E',    name:'Lilangeni du Swaziland',   countries:['SZ'],         decimals:2, position:'before' },
    GMD: { symbol:'D',    name:'Dalasi Gambien',           countries:['GM'],         decimals:2, position:'before' },
    SLL: { symbol:'Le',   name:'Leone Sierra-Léonais',     countries:['SL'],         decimals:2, position:'before' },
    LRD: { symbol:'L$',   name:'Dollar Libérien',          countries:['LR'],         decimals:2, position:'before' },
    GNF: { symbol:'FG',   name:'Franc Guinéen',            countries:['GN'],         decimals:0, position:'before' },
    MWK: { symbol:'MK',   name:'Kwacha Malawien',          countries:['MW'],         decimals:2, position:'before' },
    BIF: { symbol:'Fr',   name:'Franc Burundais',          countries:['BI'],         decimals:0, position:'before' },
    ERN: { symbol:'Nfk',  name:'Nakfa Érythréen',          countries:['ER'],         decimals:2, position:'before' },
    DJF: { symbol:'Fdj',  name:'Franc Djiboutien',         countries:['DJ'],         decimals:0, position:'before' },
    KMF: { symbol:'CF',   name:'Franc Comorien',           countries:['KM'],         decimals:0, position:'before' },
    LYD: { symbol:'LD',   name:'Dinar Libyen',             countries:['LY'],         decimals:3, position:'before' },
    MRU: { symbol:'UM',   name:'Ouguiya Mauritanien',      countries:['MR'],         decimals:2, position:'before' },

    // ─── EUROPE ────────────────────────────────────
    EUR: { symbol:'€',    name:'Euro',                     countries:['FR','DE','IT','ES','PT','BE','NL','AT','FI','GR','IE','LU','SK','SI','EE','LV','LT','MT','CY'], decimals:2, position:'after' },
    GBP: { symbol:'£',    name:'Livre Sterling',           countries:['GB'],         decimals:2, position:'before' },
    CHF: { symbol:'CHF',  name:'Franc Suisse',             countries:['CH'],         decimals:2, position:'before' },
    SEK: { symbol:'kr',   name:'Couronne Suédoise',        countries:['SE'],         decimals:2, position:'after'  },
    NOK: { symbol:'kr',   name:'Couronne Norvégienne',     countries:['NO'],         decimals:2, position:'after'  },
    DKK: { symbol:'kr',   name:'Couronne Danoise',         countries:['DK'],         decimals:2, position:'after'  },
    PLN: { symbol:'zł',   name:'Zloty Polonais',           countries:['PL'],         decimals:2, position:'after'  },
    CZK: { symbol:'Kč',   name:'Couronne Tchèque',         countries:['CZ'],         decimals:2, position:'after'  },
    HUF: { symbol:'Ft',   name:'Forint Hongrois',          countries:['HU'],         decimals:0, position:'after'  },
    RON: { symbol:'lei',  name:'Leu Roumain',              countries:['RO'],         decimals:2, position:'after'  },
    HRK: { symbol:'kn',   name:'Kuna Croate',              countries:['HR'],         decimals:2, position:'after'  },
    RSD: { symbol:'din',  name:'Dinar Serbe',              countries:['RS'],         decimals:2, position:'after'  },
    UAH: { symbol:'₴',    name:'Hryvnia Ukrainienne',      countries:['UA'],         decimals:2, position:'after'  },
    RUB: { symbol:'₽',    name:'Rouble Russe',             countries:['RU'],         decimals:2, position:'after'  },

    // ─── AMÉRIQUES ─────────────────────────────────
    USD: { symbol:'$',    name:'Dollar Américain',         countries:['US','EC','SV','PA','PR'], decimals:2, position:'before' },
    CAD: { symbol:'CA$',  name:'Dollar Canadien',          countries:['CA'],         decimals:2, position:'before' },
    BRL: { symbol:'R$',   name:'Real Brésilien',           countries:['BR'],         decimals:2, position:'before' },
    MXN: { symbol:'$',    name:'Peso Mexicain',            countries:['MX'],         decimals:2, position:'before' },
    COP: { symbol:'$',    name:'Peso Colombien',           countries:['CO'],         decimals:0, position:'before' },
    ARS: { symbol:'$',    name:'Peso Argentin',            countries:['AR'],         decimals:2, position:'before' },
    CLP: { symbol:'$',    name:'Peso Chilien',             countries:['CL'],         decimals:0, position:'before' },
    PEN: { symbol:'S/',   name:'Sol Péruvien',             countries:['PE'],         decimals:2, position:'before' },
    VES: { symbol:'Bs.',  name:'Bolívar Vénézuélien',      countries:['VE'],         decimals:2, position:'before' },
    BOB: { symbol:'Bs',   name:'Boliviano',                countries:['BO'],         decimals:2, position:'before' },
    UYU: { symbol:'$U',   name:'Peso Uruguayen',           countries:['UY'],         decimals:2, position:'before' },
    PYG: { symbol:'₲',    name:'Guaraní Paraguayen',       countries:['PY'],         decimals:0, position:'before' },
    GTQ: { symbol:'Q',    name:'Quetzal Guatémaltèque',    countries:['GT'],         decimals:2, position:'before' },
    HNL: { symbol:'L',    name:'Lempira Hondurien',        countries:['HN'],         decimals:2, position:'before' },
    NIO: { symbol:'C$',   name:'Córdoba Nicaraguayen',     countries:['NI'],         decimals:2, position:'before' },
    CRC: { symbol:'₡',    name:'Colón Costaricain',        countries:['CR'],         decimals:0, position:'before' },
    DOP: { symbol:'$',    name:'Peso Dominicain',          countries:['DO'],         decimals:2, position:'before' },
    HTG: { symbol:'G',    name:'Gourde Haïtienne',         countries:['HT'],         decimals:2, position:'before' },
    CUP: { symbol:'$',    name:'Peso Cubain',              countries:['CU'],         decimals:2, position:'before' },
    JMD: { symbol:'J$',   name:'Dollar Jamaïcain',         countries:['JM'],         decimals:2, position:'before' },

    // ─── ASIE ──────────────────────────────────────
    CNY: { symbol:'¥',    name:'Yuan Chinois',             countries:['CN'],         decimals:2, position:'before' },
    JPY: { symbol:'¥',    name:'Yen Japonais',             countries:['JP'],         decimals:0, position:'before' },
    INR: { symbol:'₹',    name:'Roupie Indienne',          countries:['IN'],         decimals:2, position:'before' },
    KRW: { symbol:'₩',    name:'Won Sud-Coréen',           countries:['KR'],         decimals:0, position:'before' },
    SGD: { symbol:'S$',   name:'Dollar Singapourien',      countries:['SG'],         decimals:2, position:'before' },
    HKD: { symbol:'HK$',  name:'Dollar Hong-Kongais',      countries:['HK'],         decimals:2, position:'before' },
    TWD: { symbol:'NT$',  name:'Nouveau Dollar Taïwanais', countries:['TW'],         decimals:0, position:'before' },
    IDR: { symbol:'Rp',   name:'Roupiah Indonésienne',     countries:['ID'],         decimals:0, position:'before' },
    MYR: { symbol:'RM',   name:'Ringgit Malaisien',        countries:['MY'],         decimals:2, position:'before' },
    THB: { symbol:'฿',    name:'Baht Thaïlandais',         countries:['TH'],         decimals:2, position:'before' },
    VND: { symbol:'₫',    name:'Dong Vietnamien',          countries:['VN'],         decimals:0, position:'after'  },
    PHP: { symbol:'₱',    name:'Peso Philippin',           countries:['PH'],         decimals:2, position:'before' },
    PKR: { symbol:'₨',    name:'Roupie Pakistanaise',      countries:['PK'],         decimals:2, position:'before' },
    BDT: { symbol:'৳',    name:'Taka Bangladais',          countries:['BD'],         decimals:2, position:'before' },
    NPR: { symbol:'₨',    name:'Roupie Népalaise',         countries:['NP'],         decimals:2, position:'before' },
    LKR: { symbol:'₨',    name:'Roupie Sri-Lankaise',      countries:['LK'],         decimals:2, position:'before' },
    MMK: { symbol:'K',    name:'Kyat Birman',              countries:['MM'],         decimals:0, position:'before' },
    KHR: { symbol:'៛',    name:'Riel Cambodgien',          countries:['KH'],         decimals:0, position:'after'  },
    LAK: { symbol:'₭',    name:'Kip Laotien',              countries:['LA'],         decimals:0, position:'before' },
    MNT: { symbol:'₮',    name:'Tögrög Mongol',            countries:['MN'],         decimals:2, position:'before' },
    KZT: { symbol:'₸',    name:'Tenge Kazakh',             countries:['KZ'],         decimals:2, position:'before' },
    UZS: { symbol:'сум',  name:'Sum Ouzbek',               countries:['UZ'],         decimals:0, position:'after'  },
    AZN: { symbol:'₼',    name:'Manat Azerbaïdjanais',     countries:['AZ'],         decimals:2, position:'before' },
    GEL: { symbol:'₾',    name:'Lari Géorgien',            countries:['GE'],         decimals:2, position:'before' },
    AMD: { symbol:'֏',    name:'Dram Arménien',            countries:['AM'],         decimals:0, position:'after'  },
    IQD: { symbol:'ع.د',  name:'Dinar Irakien',            countries:['IQ'],         decimals:3, position:'after'  },
    IRR: { symbol:'﷼',    name:'Rial Iranien',             countries:['IR'],         decimals:0, position:'after'  },
    SYP: { symbol:'£',    name:'Livre Syrienne',           countries:['SY'],         decimals:2, position:'before' },
    LBP: { symbol:'ل.ل',  name:'Livre Libanaise',          countries:['LB'],         decimals:0, position:'after'  },
    JOD: { symbol:'JD',   name:'Dinar Jordanien',          countries:['JO'],         decimals:3, position:'before' },
    ILS: { symbol:'₪',    name:'Shekel Israélien',         countries:['IL'],         decimals:2, position:'before' },
    SAR: { symbol:'ر.س',  name:'Riyal Saoudien',           countries:['SA'],         decimals:2, position:'after'  },
    AED: { symbol:'د.إ',  name:'Dirham EAU',               countries:['AE'],         decimals:2, position:'after'  },
    QAR: { symbol:'ر.ق',  name:'Riyal Qatarien',           countries:['QA'],         decimals:2, position:'after'  },
    KWD: { symbol:'د.ك',  name:'Dinar Koweïtien',          countries:['KW'],         decimals:3, position:'after'  },
    OMR: { symbol:'ر.ع.', name:'Rial Omanais',             countries:['OM'],         decimals:3, position:'after'  },
    BHD: { symbol:'BD',   name:'Dinar Bahreïni',           countries:['BH'],         decimals:3, position:'before' },
    YER: { symbol:'﷼',    name:'Rial Yéménite',            countries:['YE'],         decimals:0, position:'after'  },

    // ─── OCÉANIE ───────────────────────────────────
    AUD: { symbol:'A$',   name:'Dollar Australien',        countries:['AU'],         decimals:2, position:'before' },
    NZD: { symbol:'NZ$',  name:'Dollar Néo-Zélandais',     countries:['NZ'],         decimals:2, position:'before' },
    PGK: { symbol:'K',    name:'Kina de Papouasie',        countries:['PG'],         decimals:2, position:'before' },
  };

  /* ── CORRESPONDANCE PAYS → DEVISE ─────────────── */
  const COUNTRY_CURRENCY = {};
  Object.entries(CURRENCIES).forEach(([code, cur]) => {
    cur.countries.forEach(c => { COUNTRY_CURRENCY[c] = code; });
  });

  /* ── API PUBLIQUE ──────────────────────────────── */

  /** Retourne le code devise depuis un code pays ISO */
  function getCodeByCountry(countryCode) {
    return COUNTRY_CURRENCY[countryCode?.toUpperCase()] || 'USD';
  }

  /** Retourne l'objet devise complet */
  function get(code) {
    return CURRENCIES[code] || CURRENCIES['USD'];
  }

  /** Formate un montant selon la devise */
  function format(amount, code) {
    const cur   = get(code);
    const num   = parseFloat(amount) || 0;
    const fixed = num.toFixed(cur.decimals);
    // Séparateur de milliers
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const formatted = parts.join('.');
    return cur.position === 'before'
      ? `${cur.symbol} ${formatted}`
      : `${formatted} ${cur.symbol}`;
  }

  /** Devise active de l'utilisateur courant */
  function current() {
    // 1. Priorité : devise définie dans les paramètres
    const settings = DB.getSettings();
    if (settings.currency) return settings.currency;
    // 2. Déduire depuis le pays de l'utilisateur
    const user = Auth.getUser();
    if (user?.country) return getCodeByCountry(user.country);
    // 3. Déduire depuis le patient courant
    const pid = localStorage.getItem('mc_my_patient_id');
    if (pid) {
      const p = DB.getPatientById(pid);
      if (p?.country_code) return getCodeByCountry(p.country_code);
    }
    return 'USD';
  }

  /** Symbole de la devise active */
  function symbol() { return get(current()).symbol; }

  /** Nom complet de la devise active */
  function name()   { return get(current()).name; }

  /** Formate avec la devise active */
  function fmt(amount) { return format(amount, current()); }

  /** Liste toutes les devises pour un sélecteur */
  function list() {
    return Object.entries(CURRENCIES).map(([code, cur]) => ({
      code,
      symbol: cur.symbol,
      name:   cur.name,
      label:  `${code} — ${cur.name} (${cur.symbol})`,
    })).sort((a,b) => a.code.localeCompare(b.code));
  }

  /** Sélecteur HTML de devises */
  function renderSelector(selectedCode) {
    const sel = selectedCode || current();
    return `
      <select id="currency-select" onchange="Currency.setManual(this.value)"
              style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:.45rem .7rem;font-family:var(--font);font-size:.83rem;width:100%">
        ${list().map(c =>
          `<option value="${c.code}" ${c.code===sel?'selected':''}>${c.label}</option>`
        ).join('')}
      </select>`;
  }

  /** Définir manuellement la devise (sauvegardé dans paramètres) */
  function setManual(code) {
    if (!CURRENCIES[code]) return;
    DB.saveSettings({ currency: code });
    App.toast(`💱 Devise : ${code} — ${CURRENCIES[code].name} (${CURRENCIES[code].symbol})`);
  }

  return {
    CURRENCIES, COUNTRY_CURRENCY,
    getCodeByCountry, get, format,
    current, symbol, name, fmt,
    list, renderSelector, setManual,
  };
})();

window.Currency = Currency;
