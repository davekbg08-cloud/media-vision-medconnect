/* =====================================================
   MedConnect 2.0 — Centre de notifications in-app (Phase 6a, v2.9.42)

   Cloche flottante UNIVERSELLE (mobile / desktop / PWA / Electron), sans
   toucher aux systèmes de navigation existants. Lit `notifications/` en TEMPS
   RÉEL (source de vérité Firestore), affiche le badge de non-lus (+ badge
   système via setAppBadge si disponible), et marque lu via la Cloud Function
   markNotificationRead (repli : écriture de statut directe, autorisée au
   destinataire par les règles).

   Les notifications ne portent AUCUNE donnée médicale (titleKey/bodyKey
   neutres) : ce module n'affiche que des libellés génériques traduits.
   ===================================================== */
const NotificationCenter = (() => {
  'use strict';

  // Libellés NEUTRES (aucune donnée clinique). Résolus localement (l'i18n
  // global utilise des clés plates ; on garde la table ici, autonome).
  const LABELS = {
    'notif.generic.title':               { fr: 'Notification', en: 'Notification' },
    'notif.generic.body':                { fr: 'Vous avez une nouvelle notification.', en: 'You have a new notification.' },
    'notif.test.title':                  { fr: 'Notification de test', en: 'Test notification' },
    'notif.test.body':                   { fr: 'Ceci est une notification de test. Tout fonctionne.', en: 'This is a test notification. Everything works.' },
    'notif.appointment.created.title':   { fr: 'Nouveau rendez-vous', en: 'New appointment' },
    'notif.appointment.created.body':    { fr: 'Un rendez-vous a été programmé. Ouvrez MedConnect pour le voir.', en: 'An appointment was scheduled. Open MedConnect to view it.' },
    'notif.appointment.updated.title':   { fr: 'Rendez-vous mis à jour', en: 'Appointment updated' },
    'notif.appointment.updated.body':    { fr: 'Votre rendez-vous a été modifié.', en: 'Your appointment was updated.' },
    'notif.appointment.cancelled.title': { fr: 'Rendez-vous annulé', en: 'Appointment cancelled' },
    'notif.appointment.cancelled.body':  { fr: 'Un rendez-vous a été annulé.', en: 'An appointment was cancelled.' },
    'notif.lab.ready.title':             { fr: 'Résultat disponible', en: 'Result available' },
    'notif.lab.ready.body':              { fr: 'Un nouveau résultat est disponible dans votre espace sécurisé.', en: 'A new result is available in your secure space.' },
    'notif.prescription.created.title':  { fr: 'Nouvelle ordonnance', en: 'New prescription' },
    'notif.prescription.created.body':   { fr: 'Une nouvelle ordonnance est disponible dans votre espace sécurisé.', en: 'A new prescription is available in your secure space.' },
    'notif.prescription.pharmacy.title': { fr: 'Ordonnance reçue', en: 'Prescription received' },
    'notif.prescription.pharmacy.body':  { fr: 'Une ordonnance vous a été adressée.', en: 'A prescription was sent to you.' },
    'notif.admission.confirmed.title':   { fr: 'Admission confirmée', en: 'Admission confirmed' },
    'notif.admission.confirmed.body':    { fr: 'Une admission a été confirmée.', en: 'An admission was confirmed.' },
    'notif.discharge.confirmed.title':   { fr: 'Sortie confirmée', en: 'Discharge confirmed' },
    'notif.discharge.confirmed.body':    { fr: 'Une sortie a été confirmée.', en: 'A discharge was confirmed.' },
    'notif.affiliation.approved.title':  { fr: 'Affiliation approuvée', en: 'Affiliation approved' },
    'notif.affiliation.approved.body':   { fr: 'Votre affiliation a été approuvée.', en: 'Your affiliation was approved.' },
    'notif.affiliation.rejected.title':  { fr: 'Affiliation refusée', en: 'Affiliation rejected' },
    'notif.affiliation.rejected.body':   { fr: 'Votre demande d\'affiliation a été refusée.', en: 'Your affiliation request was declined.' },
  };

  // Deep links autorisés (allowlist) : uniquement des routes INTERNES connues.
  const ALLOWED_ROUTE_PREFIXES = [
    '/notifications', '/appointments', '/lab', '/prescriptions', '/messages',
    '/admissions', '/transfers',
  ];

  function currentLang() {
    try { return (window.I18n && window.I18n.getLang && window.I18n.getLang()) || 'fr'; } catch (_) { return 'fr'; }
  }
  function resolveLabel(key, params, lang) {
    const entry = LABELS[key] || LABELS['notif.generic.title'];
    let s = (entry && (entry[lang] || entry.fr)) || key;
    if (params) for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(String(params[k]));
    return s;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // Valide une route de deep link : interne, dans l'allowlist, jamais absolue.
  function isAllowedRoute(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) return false;
    if (path.startsWith('//')) return false; // protocol-relative → refusé
    return ALLOWED_ROUTE_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
  }
  function computeUnread(list) {
    return (list || []).filter(n => (n.readStatus || 'unread') === 'unread' && !n.dismissedAt).length;
  }
  function fmtDate(v, lang) {
    try {
      const ms = v && v.toMillis ? v.toMillis() : (v && v._seconds ? v._seconds * 1000 : (v ? Date.parse(v) : NaN));
      if (isNaN(ms)) return '';
      return new Date(ms).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR');
    } catch (_) { return ''; }
  }

  /* Carte d'une notification — n'affiche QUE des libellés neutres. */
  function renderCard(n, lang) {
    const title = resolveLabel(n.titleKey || 'notif.generic.title', n.localizationParams, lang);
    const body = resolveLabel(n.bodyKey || 'notif.generic.body', n.localizationParams, lang);
    const unread = (n.readStatus || 'unread') === 'unread';
    return `<div class="mc-notif-card${unread ? ' mc-notif-unread' : ''}" data-id="${esc(n.notificationId)}" role="listitem" tabindex="0">
      <div class="mc-notif-title">${unread ? '<span class="mc-notif-dot" aria-hidden="true"></span>' : ''}${esc(title)}</div>
      <div class="mc-notif-body">${esc(body)}</div>
      <div class="mc-notif-meta">${esc(n.category || '')} · ${esc(fmtDate(n.createdAt, lang))}</div>
    </div>`;
  }

  // ── État + Firestore temps réel ─────────────────────
  let _list = [];
  let _unsub = null;
  let _mounted = false;

  function _db() { return (typeof firebaseDB !== 'undefined' && firebaseDB) ? firebaseDB : (window.firebaseDB || null); }
  function _fns() { return (typeof firebaseFunctions !== 'undefined' && firebaseFunctions) ? firebaseFunctions : (window.firebaseFunctions || null); }
  function _uid() { try { return firebaseAuth && firebaseAuth.currentUser ? firebaseAuth.currentUser.uid : null; } catch (_) { return null; } }

  function _applyBadge(count) {
    try { if (navigator.setAppBadge) { count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(); } } catch (_) {}
    const b = document.getElementById('mc-notif-badge');
    if (b) { b.textContent = count > 99 ? '99+' : String(count); b.style.display = count > 0 ? '' : 'none'; }
  }

  function _rerender() {
    const lang = currentLang();
    _list.sort((a, b) => fmtMs(b.createdAt) - fmtMs(a.createdAt));
    const panel = document.getElementById('mc-notif-list');
    if (panel) {
      const visible = _list.filter(n => !n.dismissedAt);
      panel.innerHTML = visible.length
        ? visible.map(n => renderCard(n, lang)).join('')
        : `<div class="mc-notif-empty">${lang === 'en' ? 'No notifications.' : 'Aucune notification.'}</div>`;
    }
    _applyBadge(computeUnread(_list));
  }
  function fmtMs(v) { return v && v.toMillis ? v.toMillis() : (v && v._seconds ? v._seconds * 1000 : (v ? Date.parse(v) || 0 : 0)); }

  function subscribe() {
    const db = _db(); const uid = _uid();
    if (!db || !uid) return;
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    // Égalité seule + limite (borné pour le coût ; pas d'index composite requis).
    // Tri côté client (fmtMs), fusion sans suppression.
    try {
      _unsub = db.collection('notifications').where('recipientUid', '==', uid).limit(50)
        .onSnapshot(snap => {
          const byId = new Map(_list.map(n => [n.notificationId, n]));
          snap.forEach(doc => { const d = doc.data() || {}; byId.set(d.notificationId || doc.id, { ...d, notificationId: d.notificationId || doc.id }); });
          _list = Array.from(byId.values());
          _rerender();
        }, err => console.warn('[NotificationCenter] listener refusé :', err && err.message));
    } catch (e) { console.warn('[NotificationCenter] abonnement impossible :', e && e.message); }
  }

  async function markRead(notificationId) {
    if (!notificationId) return;
    const n = _list.find(x => x.notificationId === notificationId);
    if (n) { n.readStatus = 'read'; n.readAt = Date.now(); _rerender(); } // optimiste local
    // Voie serveur (recalcule le badge partagé). Repli : écriture de statut directe.
    const fns = _fns();
    try {
      if (fns && fns.httpsCallable) { await fns.httpsCallable('markNotificationRead')({ notificationId }); return; }
    } catch (e) { console.warn('[NotificationCenter] markNotificationRead (fonction) :', e && e.message); }
    try {
      const db = _db();
      if (db) await db.collection('notifications').doc(notificationId).set({ readStatus: 'read', readAt: new Date().toISOString(), openedAt: new Date().toISOString() }, { merge: true });
    } catch (e) { console.warn('[NotificationCenter] markRead repli :', e && e.message); }
  }

  async function markAllRead() {
    const unread = _list.filter(n => (n.readStatus || 'unread') === 'unread');
    for (const n of unread) await markRead(n.notificationId);
  }

  function openNotification(notificationId) {
    const n = _list.find(x => x.notificationId === notificationId);
    markRead(notificationId);
    // Deep link : on ne suit QUE des routes internes autorisées.
    const dl = n && n.deepLink;
    const primary = dl && dl.primary;
    if (isAllowedRoute(primary) && typeof window.navigateMedConnect === 'function') {
      try { window.navigateMedConnect(primary); } catch (_) {}
    }
    _closePanel();
  }

  // ── UI : cloche flottante + panneau ─────────────────
  function _togglePanel() {
    const p = document.getElementById('mc-notif-panel');
    if (!p) return;
    const open = p.getAttribute('data-open') === '1';
    p.setAttribute('data-open', open ? '0' : '1');
    p.style.display = open ? 'none' : 'block';
    if (!open) _rerender();
  }
  function _closePanel() {
    const p = document.getElementById('mc-notif-panel');
    if (p) { p.setAttribute('data-open', '0'); p.style.display = 'none'; }
  }

  function mountBell() {
    if (_mounted || typeof document === 'undefined' || !document.body) return;
    _mounted = true;
    const lang = currentLang();
    const wrap = document.createElement('div');
    wrap.id = 'mc-notif-root';
    wrap.innerHTML = `
      <button id="mc-notif-bell" type="button" aria-label="${lang === 'en' ? 'Notifications' : 'Notifications'}" title="Notifications">
        🔔<span id="mc-notif-badge" class="mc-notif-badge" style="display:none">0</span>
      </button>
      <div id="mc-notif-panel" role="dialog" aria-label="Notifications" data-open="0" style="display:none">
        <div class="mc-notif-head">
          <strong>Notifications</strong>
          <button type="button" id="mc-notif-allread" class="mc-notif-linkbtn">${lang === 'en' ? 'Mark all read' : 'Tout marquer lu'}</button>
        </div>
        <div id="mc-notif-list" role="list"></div>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById('mc-notif-bell').addEventListener('click', _togglePanel);
    document.getElementById('mc-notif-allread').addEventListener('click', markAllRead);
    document.getElementById('mc-notif-list').addEventListener('click', (e) => {
      const card = e.target.closest && e.target.closest('.mc-notif-card');
      if (card) openNotification(card.getAttribute('data-id'));
    });
  }

  function init() {
    try { mountBell(); subscribe(); } catch (e) { console.warn('[NotificationCenter] init :', e && e.message); }
  }
  function teardown() {
    if (_unsub) { try { _unsub(); } catch (_) {} _unsub = null; }
    _list = []; _applyBadge(0); _closePanel();
  }

  return {
    init, teardown, subscribe, markRead, markAllRead, openNotification,
    // exposés pour tests (logique pure)
    _internal: { resolveLabel, isAllowedRoute, computeUnread, renderCard, LABELS, ALLOWED_ROUTE_PREFIXES },
  };
})();

if (typeof window !== 'undefined') window.NotificationCenter = NotificationCenter;
if (typeof module !== 'undefined' && module.exports) module.exports = NotificationCenter;
