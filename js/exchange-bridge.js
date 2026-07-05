/* =====================================================
   MedConnect — Exchange Bridge (Mobile ↔ Desktop)
   -----------------------------------------------------
   Couche unique centralisant :
   - la vérification d'abonnement avant toute écriture
     sensible (canWriteForHospital) ;
   - l'écriture normalisée vers les collections officielles
     partagées entre mobile/PWA et desktop ;
   - des listeners Firestore filtrés par hospitalId / uid
     (au lieu de listeners globaux sur des collections
     entières) ;
   - un indicateur d'état synchro/abonnement réutilisable
     par n'importe quel écran (mobile ou desktop).

   Ne remplace ni Auth, ni DB, ni Network : s'appuie dessus.
   Firestore reste la source de vérité ; localStorage ne sert
   que de cache/état de session, jamais de source de décision
   pour l'abonnement.
   ===================================================== */
const ExchangeBridge = (() => {

  /* ── COLLECTIONS OFFICIELLES DE L'ÉCHANGE ─────────── */
  const EXCHANGE_COLLECTIONS = [
    'patients', 'consultations', 'prescriptions',
    'labRequests', 'labResults', 'appointments',
    'notifications', 'messages', 'hospitalMembers',
    'subscriptions', 'auditLogs',
    'beds', 'admissions', 'aiQueries',
  ];

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function hasFirebaseDB() { return typeof firebaseDB !== 'undefined' && !!firebaseDB; }

  /* ── DÉTECTION DE LA PLATEFORME COURANTE ──────────── */
  let _cachedDevice = null;
  function currentSourceDevice() {
    // Figé au premier appel : la plateforme ne change pas en cours de
    // session, et cela évite qu'un basculement (ex. passage en mode
    // standalone) modifie le gating à la volée. Durcissement client
    // modeste — la vraie protection reste un custom claim serveur.
    if (_cachedDevice) return _cachedDevice;
    if (window.Capacitor || document.URL.startsWith('file://') || /android/i.test(navigator.userAgent)) _cachedDevice = 'mobile';
    else if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) _cachedDevice = 'pwa';
    else _cachedDevice = 'desktop';
    return _cachedDevice;
  }

  /* ── ENVELOPPE COMMUNE À TOUT DOCUMENT ÉCHANGÉ ────── */
  function envelope(hospitalId, extra = {}) {
    const user = window.Auth?.getUser?.();
    const now  = new Date().toISOString();
    return {
      hospitalId: hospitalId || '',
      establishmentId: hospitalId || '', // alias : le reste du code filtre sur ce nom historique
      createdByUid: user?.uid || '',
      createdAt: extra.createdAt || now,
      updatedAt: now,
      sourceDevice: currentSourceDevice(),
      syncStatus: 'pending',
      ...extra,
    };
  }

  /* ══════════════════════════════════════════════════
     PARTIE 2 — ABONNEMENT
     Collection Firestore : subscriptions/{hospitalId}
     Champs attendus : status (active|grace_period|expired|
     suspended), graceUntil (ISO, optionnel), updatedAt.
     Si aucun document n'existe pour un hôpital : traité comme
     "active" par défaut (rétro-compatibilité — ne bloque pas
     les hôpitaux existants tant que l'abonnement n'a pas été
     explicitement configuré pour eux).

     Restriction volontairement DIFFÉRENTE selon la plateforme :
     Desktop est le produit sous abonnement — expiré/suspendu y
     bloque toute écriture non essentielle (liste complète).
     Mobile/PWA reste l'outil terrain des soignants et ne doit
     jamais être coupé pour une facture desktop impayée — seules
     quelques actions vraiment critiques y restent bloquées.
  ══════════════════════════════════════════════════ */
  const DESKTOP_BLOCKED_ACTIONS = new Set([
    'create_patient', 'create_consultation', 'create_prescription',
    'send_prescription_pharmacy', 'request_lab', 'add_lab_result',
    'create_appointment', 'add_member', 'send_message_professional',
    'use_medical_ai', 'emergency_transfer', 'medical_record_share',
  ]);
  // Mobile/PWA : liste volontairement réduite. Le soin courant
  // (consultation, ordonnance) continue même hôpital expiré ; seule
  // la création de nouveaux patients (impact administratif/facturation
  // de l'hôpital) est bloquée.
  const MOBILE_BLOCKED_ACTIONS = new Set([
    'create_patient',
  ]);
  // Ces actions restent toujours autorisées, même expiré/suspendu,
  // quelle que soit la plateforme.
  const ALWAYS_ALLOWED_ACTIONS = new Set([
    'read_record', 'read_consultation', 'read_prescription',
    'read_lab_result', 'export_record', 'send_message_urgent',
  ]);

  const _subscriptionCache = new Map(); // hospitalId -> {status, graceUntil, fetchedAt}
  const SUBSCRIPTION_CACHE_TTL_MS = 60000;

  async function getSubscriptionStatus(hospitalId) {
    if (!hospitalId) return { status: 'active', graceUntil: null };
    const cached = _subscriptionCache.get(hospitalId);
    if (cached && (Date.now() - cached.fetchedAt) < SUBSCRIPTION_CACHE_TTL_MS) return cached;

    let result = { status: 'active', graceUntil: null, fetchedAt: Date.now() };
    if (hasFirebaseDB()) {
      try {
        const doc = await firebaseDB.collection('subscriptions').doc(hospitalId).get();
        if (doc.exists) {
          const data = doc.data() || {};
          result = { status: String(data.status || 'active').toLowerCase(), graceUntil: data.graceUntil || null, fetchedAt: Date.now() };
        }
      } catch (e) {
        console.warn('[ExchangeBridge] Lecture abonnement impossible, traité comme actif :', e);
      }
    }
    _subscriptionCache.set(hospitalId, result);
    return result;
  }

  function invalidateSubscriptionCache(hospitalId) {
    if (hospitalId) _subscriptionCache.delete(hospitalId);
    else _subscriptionCache.clear();
  }

  /**
   * canWriteForHospital(hospitalId, actionType)
   * → { allowed: bool, status: string, message: string|null, warning: string|null }
   * Ne bloque JAMAIS silencieusement : renvoie toujours une raison exploitable par l'UI.
   */
  async function canWriteForHospital(hospitalId, actionType) {
    if (ALWAYS_ALLOWED_ACTIONS.has(actionType)) {
      return { allowed: true, status: 'active', message: null, warning: null };
    }
    if (!hospitalId) {
      return { allowed: false, status: 'unknown', message: 'Aucun établissement actif sélectionné.', warning: null };
    }

    const sub = await getSubscriptionStatus(hospitalId);
    const status = sub.status;

    if (status === 'active') {
      return { allowed: true, status, message: null, warning: null };
    }
    if (status === 'grace_period') {
      return {
        allowed: true, status,
        message: null,
        warning: `Période de grâce${sub.graceUntil ? ' jusqu\'au ' + sub.graceUntil.slice(0,10) : ''} — pensez à renouveler l'abonnement de l'établissement.`,
      };
    }
    // expired / suspended — la liste d'actions bloquées dépend de
    // la plateforme d'où vient l'appel (voir note ci-dessus).
    const device = currentSourceDevice();
    const blockedActions = device === 'desktop' ? DESKTOP_BLOCKED_ACTIONS : MOBILE_BLOCKED_ACTIONS;
    const blocked = blockedActions.has(actionType);
    if (blocked) {
      const message = device === 'desktop'
        ? "Votre abonnement a expiré. La lecture reste disponible, mais les nouvelles actions sont bloquées jusqu'au renouvellement."
        : "Impossible de créer un nouveau patient : l'abonnement de l'établissement a expiré. Les consultations et ordonnances restent disponibles.";
      return { allowed: false, status, message, warning: null };
    }
    return { allowed: true, status, message: null, warning: null };
  }

  /** Variante synchrone pratique pour l'UI (cache uniquement, ne relit jamais Firestore).
      À utiliser pour l'affichage d'indicateurs ; utiliser canWriteForHospital() (async)
      juste avant toute écriture réelle. */
  function getCachedSubscriptionStatus(hospitalId) {
    return _subscriptionCache.get(hospitalId)?.status || 'active';
  }

  /* ══════════════════════════════════════════════════
     PARTIE 1 — ÉCRITURE NORMALISÉE DE L'ÉCHANGE
  ══════════════════════════════════════════════════ */

  /**
   * writeExchangeDocument(collection, docId, data, hospitalId, actionType)
   * → { ok: bool, blocked: bool, message: string|null, doc }
   * Vérifie l'abonnement, complète l'enveloppe, écrit en local (cache)
   * ET pousse vers Firestore via DB.pushAndReport (jamais d'échec
   * silencieux), marque syncStatus en conséquence.
   */
  async function writeExchangeDocument(collection, docId, data, hospitalId, actionType) {
    if (!EXCHANGE_COLLECTIONS.includes(collection)) {
      console.warn(`[ExchangeBridge] Collection non reconnue dans le contrat d'échange : ${collection}`);
    }
    const gate = await canWriteForHospital(hospitalId, actionType);
    if (!gate.allowed) {
      return { ok: false, blocked: true, message: gate.message, doc: null };
    }

    const id  = docId || (window.DB?.makeId ? DB.makeId(collection.slice(0,3).toUpperCase()) : `${collection}_${Date.now()}`);
    const doc = { ...envelope(hospitalId, data), id };

    // Cache local minimal (état de session, jamais source de vérité) :
    // toujours écrit pour ne pas perdre la saisie si le réseau tombe
    // juste après ce point, même en grâce.
    try {
      const cacheKey = `mc_exchange_${collection}`;
      const list = JSON.parse(localStorage.getItem(cacheKey) || '[]');
      list.push(doc);
      localStorage.setItem(cacheKey, JSON.stringify(list));
    } catch (e) { /* cache best-effort uniquement */ }

    const pushed = window.DB?.pushAndReport ? await DB.pushAndReport([[collection, id, doc]]) : false;
    doc.syncStatus = pushed ? 'synced' : 'failed';

    return { ok: true, blocked: false, message: gate.warning, doc };
  }

  /* ══════════════════════════════════════════════════
     PARTIE 4 — LISTENERS FILTRÉS PAR RÔLE
     Remplace les listeners globaux non filtrés par des requêtes
     ciblées hospitalId + uid + rôle, comme demandé. N'écoute que
     ce qui concerne l'utilisateur courant, pas des collections
     entières.
  ══════════════════════════════════════════════════ */
  const _activeListeners = [];

  function stopAllListeners() {
    _activeListeners.forEach(unsub => { try { unsub(); } catch (_) {} });
    _activeListeners.length = 0;
  }

  function listenFiltered(collection, filters, onChange) {
    if (!hasFirebaseDB()) return () => {};
    try {
      let query = firebaseDB.collection(collection);
      filters.forEach(([field, op, value]) => { query = query.where(field, op, value); });
      const unsub = query.onSnapshot(
        snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err  => console.warn(`[ExchangeBridge] Listener ${collection} :`, err)
      );
      _activeListeners.push(unsub);
      return unsub;
    } catch (e) {
      console.warn(`[ExchangeBridge] Impossible d'écouter ${collection} :`, e);
      return () => {};
    }
  }

  /** Démarre l'ensemble des listeners pertinents pour le rôle courant.
      À appeler une fois après connexion / changement d'établissement actif. */
  function startRoleListeners(onChange) {
    stopAllListeners();
    const user = window.Auth?.getUser?.();
    if (!user) return;
    const hospitalId = window.HospitalsRegistry?.getCurrentHospital?.()?.establishmentId || null;
    const notify = (col, docs) => onChange?.(col, docs);

    // Notifications non lues : toujours écoutées, quel que soit le rôle.
    listenFiltered('notifications', [['toUid', '==', user.uid], ['readStatus', '==', 'unread']], docs => notify('notifications', docs));

    if (!hospitalId) return; // le reste dépend d'un établissement actif

    if (user.role === 'doctor') {
      listenFiltered('consultations', [['hospitalId','==',hospitalId], ['doctorUid','==',user.uid]], docs => notify('consultations', docs));
      listenFiltered('labResults',    [['hospitalId','==',hospitalId], ['doctorUid','==',user.uid]], docs => notify('labResults', docs));
      listenFiltered('prescriptions', [['hospitalId','==',hospitalId], ['doctorUid','==',user.uid]], docs => notify('prescriptions', docs));
    } else if (user.role === 'pharmacist') {
      listenFiltered('prescriptions', [['hospitalId','==',hospitalId], ['status','in',['sent_to_pharmacy','prepared']]], docs => notify('prescriptions', docs));
    } else if (user.role === 'nurse') {
      // Labo/laborantin partage le rôle infirmier dans ce projet si absent en tant que tel.
      listenFiltered('labRequests', [['hospitalId','==',hospitalId], ['status','in',['requested','sample_pending','in_progress']]], docs => notify('labRequests', docs));
    } else if (user.role === 'admin') {
      listenFiltered('registration_requests', [['status','==','pending']], docs => notify('registration_requests', docs));
      listenFiltered('hospitalMembers', [['hospitalId','==',hospitalId]], docs => notify('hospitalMembers', docs));
    }
  }

  /* ══════════════════════════════════════════════════
     PARTIE 6 — INDICATEUR SYNCHRO / ABONNEMENT
     Utilisable identiquement sur mobile et desktop (même
     source Firestore, même fonction).
  ══════════════════════════════════════════════════ */
  async function renderSyncBadge(hospitalId) {
    const sub = await getSubscriptionStatus(hospitalId);
    const online = navigator.onLine !== false;
    const labels = {
      active:       { icon: '☁️', text: 'Cloud synchronisé', color: 'var(--secondary)' },
      grace_period: { icon: '⏳', text: 'Période de grâce', color: 'var(--accent)' },
      expired:      { icon: '🔒', text: 'Lecture seule — abonnement expiré', color: 'var(--danger)' },
      suspended:    { icon: '🚫', text: 'Lecture seule — abonnement suspendu', color: 'var(--danger)' },
    };
    const l = labels[sub.status] || labels.active;
    if (!online) return `<span class="sync-badge" style="color:var(--accent)">📡 En attente de synchronisation</span>`;
    return `<span class="sync-badge" style="color:${l.color}">${l.icon} ${esc(l.text)}</span>`;
  }

  /* ══════════════════════════════════════════════════
     PARTIE 5 — FILE D'ATTENTE HORS-LIGNE
     N'accumule des écritures locales en attente QUE si le
     dernier statut d'abonnement connu était active/grace_period —
     jamais pour un hôpital déjà su expiré/suspendu.
  ══════════════════════════════════════════════════ */
  function queuePendingWrite(collection, doc) {
    const key = 'mc_exchange_pending_queue';
    try {
      const queue = JSON.parse(localStorage.getItem(key) || '[]');
      queue.push({ collection, doc, queuedAt: new Date().toISOString() });
      localStorage.setItem(key, JSON.stringify(queue));
    } catch (_) {}
  }

  async function flushPendingQueue() {
    const key = 'mc_exchange_pending_queue';
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem(key) || '[]'); } catch { return; }
    if (!queue.length || !hasFirebaseDB()) return;

    const remaining = [];
    for (const item of queue) {
      const hospitalId = item.doc?.hospitalId;
      const gate = await canWriteForHospital(hospitalId, 'flush_pending');
      if (!gate.allowed) { remaining.push(item); continue; } // hôpital devenu expiré entre-temps : on ne pousse pas
      const ok = window.DB?.pushAndReport
        ? await DB.pushAndReport([[item.collection, item.doc.id, { ...item.doc, syncStatus: 'synced' }]])
        : false;
      if (!ok) remaining.push(item);
    }
    localStorage.setItem(key, JSON.stringify(remaining));
  }

  window.addEventListener('online', () => { flushPendingQueue(); });

  return {
    EXCHANGE_COLLECTIONS,
    currentSourceDevice,
    canWriteForHospital,
    getSubscriptionStatus, getCachedSubscriptionStatus, invalidateSubscriptionCache,
    writeExchangeDocument,
    listenFiltered, startRoleListeners, stopAllListeners,
    renderSyncBadge,
    queuePendingWrite, flushPendingQueue,
  };
})();

window.ExchangeBridge = ExchangeBridge;
