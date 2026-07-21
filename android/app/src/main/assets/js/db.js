/* =====================================================
   MedConnect 2.0 — DB Module
   localStorage + Firebase Firestore sync

   Fonctionnement :
   - Lecture  → localStorage (rapide, hors-ligne)
   - Écriture → localStorage + Firebase (sync cloud)
   - Au démarrage → sync depuis Firebase vers localStorage
   ===================================================== */
const DB = (() => {

  /* ── HELPERS localStorage ────────────────────────── */
  const load  = (k, d=[]) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch { return d; } };
  const store = (k, v)    => localStorage.setItem(k, JSON.stringify(v));
  const today = ()        => new Date().toISOString().slice(0, 10);

  /* ── FILE D'ÉCRITURE CLOUD PERSISTANTE ─────────────────
     Firestore est la source de vérité. Mais une écriture peut
     échouer ponctuellement (hors-ligne, latence, règle en cours
     de déploiement). Sans file, cette donnée ne vivrait qu'en
     localStorage et disparaîtrait à la réinstallation — cause
     racine des pertes de données signalées.

     Chaque écriture cloud échouée est mémorisée ici (dans
     localStorage, donc elle survit à une fermeture d'app) et
     rejouée automatiquement dès que Firestore répond. La donnée
     n'est réputée « à l'abri » que lorsqu'elle a atteint le cloud. */
  const OUTBOX_KEY = 'mc_cloud_outbox';

  /* ── CLASSIFICATION DES ERREURS (chantier "workflows mobile/desktop",
     sections 1-2) ──────────────────────────────────────
     Bug confirmé : TOUTE écriture échouée était rejouée indéfiniment, à
     la même fréquence, qu'elle soit réellement transitoire (hors ligne,
     latence, service temporairement indisponible — se corrigera
     seule) ou structurellement condamnée à échouer pour toujours
     (permission refusée par une règle Firestore, argument invalide,
     document déjà supprimé) — masquant un vrai problème de
     configuration derrière un badge "en attente" qui ne redescendait
     JAMAIS, sans jamais le distinguer d'une simple coupure réseau.
     classifyOutboxError() ne DISCRÉDITE ni ne SUPPRIME jamais une
     écriture 'blocked' (aucune perte de données) — elle sert
     uniquement à afficher un état honnête (voir
     js/settings.js/js/sync-badge.js) et à éviter de la rejouer à
     pleine fréquence pendant qu'un humain doit intervenir. */
  const BLOCKED_ERROR_CODES = new Set([
    'permission-denied', 'invalid-argument', 'failed-precondition',
    'not-found', 'already-exists', 'unauthenticated', 'out-of-range',
  ]);
  function classifyOutboxError(err) {
    const code = err?.code || null;
    if (!code) return 'retryable'; // pas d'erreur (hors ligne) : purement transitoire
    if (BLOCKED_ERROR_CODES.has(code)) return 'blocked';
    return 'retryable';
  }

  const OUTBOX_BASE_DELAY_MS = 30 * 1000;      // 30 s
  const OUTBOX_MAX_DELAY_MS  = 30 * 60 * 1000; // 30 min (plafond)
  function _computeNextRetryAt(attempts) {
    const delay = Math.min(OUTBOX_BASE_DELAY_MS * Math.pow(2, attempts), OUTBOX_MAX_DELAY_MS);
    return new Date(Date.now() + delay).toISOString();
  }

  /* Contexte d'exécution capturé À LA MISE EN FILE (chantier v2.9.34,
     P0 outbox) : module source, utilisateur, rôle, établissement —
     purement informatif (inspecteur/diagnostic), jamais utilisé pour
     décider d'un droit d'accès (les règles Firestore restent la seule
     barrière). */
  function _opContext(meta = {}) {
    let userUid = null, userRole = null, hospitalId = null;
    try {
      const u = window.Auth?.getUser?.();
      userUid = u?.uid || null; userRole = u?.role || null;
    } catch (_) {}
    try {
      hospitalId = window.HospitalsRegistry?.getCurrentHospital?.()?.establishmentId || null;
    } catch (_) {}
    return {
      module: meta.module || null,
      operationType: meta.operationType || null,
      userUid, userRole, hospitalId,
      groupId: meta.groupId || null,
    };
  }

  /* Rétro-compatibilité : les entrées écrites par les versions
     précédentes n'ont ni operationId ni type — normalisées à la lecture
     (jamais supprimées, jamais réinterprétées au-delà des champs
     manquants). */
  function _normalizeOutboxEntry(e) {
    if (!e) return e;
    const n = { ...e };
    if (!n.operationId) n.operationId = makeId('OP');
    if (!n.type) n.type = Array.isArray(n.writes) ? 'batch' : 'set';
    if (!n.operationType) n.operationType = n.type === 'batch' ? 'batch' : `set:${n.collection || '?'}`;
    if (!n.updatedAt) n.updatedAt = n.queuedAt || new Date().toISOString();
    if (n.attempts == null) n.attempts = 0;
    if (!n.classification) n.classification = 'retryable';
    return n;
  }
  function _outboxLoad() { return load(OUTBOX_KEY).map(_normalizeOutboxEntry); }

  function _outboxAdd(collection, docId, data, err = null, meta = {}) {
    const q = _outboxLoad();
    // Dédoublonnage : une réécriture plus récente du même document
    // remplace l'ancienne en file (dernière valeur = la bonne) — repart
    // avec un compteur de tentatives à zéro (nouvelle donnée à écrire,
    // pas un rejeu de l'ancienne). Ne touche JAMAIS aux entrées batch
    // (qui ne s'écrasent que par groupId, voir _outboxAddBatch).
    const filtered = q.filter(e => !(e.type === 'set' && e.collection === collection && e.docId === String(docId)));
    filtered.push({
      operationId: makeId('OP'),
      type: 'set',
      collection, docId: String(docId), data,
      ..._opContext({ operationType: `set:${collection}`, ...meta }),
      operationType: meta.operationType || `set:${collection}`,
      queuedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0, nextRetryAt: null,
      classification: classifyOutboxError(err),
      lastErrorCode: err?.code || null,
      lastErrorMessage: err?.message || null,
    });
    store(OUTBOX_KEY, filtered);
  }

  /* Mise en file d'un GROUPE ATOMIQUE (chantier v2.9.34, P0) : un batch
     médical (ex. création patient : mc_patients+patients+medical_records+
     patient_directory) est mémorisé comme UNE SEULE entrée, rejouée par
     un seul firebaseDB.batch().commit() — jamais décomposée en
     écritures indépendantes, ce qui romprait l'atomicité. */
  function _outboxAddBatch(writes, err = null, meta = {}) {
    const q = _outboxLoad();
    const groupId = meta.groupId || makeId('GRP');
    const filtered = q.filter(e => !(e.type === 'batch' && e.groupId === groupId));
    const entry = {
      operationId: makeId('OP'),
      type: 'batch',
      writes: writes.map(([col, id, data]) => [col, String(id), data]),
      ..._opContext(meta),
      groupId,
      operationType: meta.operationType || 'batch',
      queuedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0, nextRetryAt: null,
      classification: classifyOutboxError(err),
      lastErrorCode: err?.code || null,
      lastErrorMessage: err?.message || null,
    };
    filtered.push(entry);
    store(OUTBOX_KEY, filtered);
    return entry.operationId;
  }

  function _outboxCount() { return _outboxLoad().length; }
  const outboxCount = _outboxCount;

  /** Instantané en lecture seule de la file — pour l'inspecteur UI
      (js/settings.js) : jamais utilisé pour décider quoi que ce soit,
      seulement pour AFFICHER l'état réel à l'utilisateur/l'admin. */
  function getOutboxEntries() { return _outboxLoad(); }

  /** Résumé agrégé — évite à chaque appelant (badge, inspecteur) de
      recompter lui-même les classifications. */
  function getOutboxSummary() {
    const q = _outboxLoad();
    const blocked = q.filter(e => e.classification === 'blocked').length;
    const retryable = q.length - blocked;
    const oldestQueuedAt = q.length
      ? q.map(e => e.queuedAt).sort()[0]
      : null;
    return { total: q.length, retryable, blocked, oldestQueuedAt };
  }

  /** Rejoue UNE entrée (set ou batch). Retourne true si l'écriture a
      abouti. Ne modifie pas la file — l'appelant s'en charge. */
  async function _replayEntry(e) {
    if (e.type === 'batch') {
      if (typeof firebaseDB.batch !== 'function') throw new Error('batch non supporté');
      const batch = firebaseDB.batch();
      (e.writes || []).forEach(([col, id, data]) => {
        batch.set(firebaseDB.collection(col).doc(String(id)), data);
      });
      await batch.commit();
      return true;
    }
    await firebaseDB.collection(e.collection).doc(e.docId).set(e.data, { merge: true });
    return true;
  }

  function _failedEntry(e, err) {
    const attempts = (e.attempts || 0) + 1;
    return {
      ..._normalizeOutboxEntry(e), attempts,
      updatedAt: new Date().toISOString(),
      nextRetryAt: _computeNextRetryAt(attempts),
      classification: classifyOutboxError(err),
      lastErrorCode: err?.code || null,
      lastErrorMessage: err?.message || null,
    };
  }

  let _flushing = false;
  /** Rejeu AUTOMATIQUE (et « Réessayer toutes les opérations normales »
      avec force:true, qui ignore seulement le délai de backoff).

      Correctif (chantier v2.9.34, P0) : bug confirmé — une entrée
      'blocked' (permission refusée, argument invalide… : ne se
      corrigera JAMAIS toute seule) était encore rejouée automatiquement
      une fois son délai de backoff écoulé, et par le rejeu forcé
      générique. Une entrée 'blocked' n'est désormais JAMAIS rejouée par
      flushOutbox(), force ou pas — seules les actions manuelles
      explicites la rejouent : retryOutboxOperation(operationId)
      (« Réessayer cette opération ») ou retryBlockedOutbox()
      (« Vérifier les opérations bloquées »). Elle n'est jamais
      supprimée automatiquement non plus. */
  async function flushOutbox({ force = false } = {}) {
    if (_flushing || !firebaseReady || !firebaseDB) return;
    const q = _outboxLoad();
    if (!q.length) return;
    _flushing = true;
    const now = Date.now();
    const remaining = [];
    for (const e of q) {
      if (e.classification === 'blocked') {
        remaining.push(e); // jamais rejouée automatiquement — action manuelle requise
        continue;
      }
      if (!force && e.nextRetryAt && new Date(e.nextRetryAt).getTime() > now) {
        remaining.push(e); // pas encore l'heure du prochain essai (backoff)
        continue;
      }
      try {
        await _replayEntry(e);
      } catch (err) {
        console.warn(`[MedConnect] Outbox : rejeu ${e.operationType || e.collection} encore en échec :`, err?.message || err);
        remaining.push(_failedEntry(e, err));
      }
    }
    store(OUTBOX_KEY, remaining);
    _flushing = false;
    // Rafraîchit le badge de synchronisation pour refléter l'état réel.
    try { window.SyncBadge?.render?.(); } catch (_) {}
    if (remaining.length) console.warn(`[MedConnect] Outbox : ${remaining.length} écriture(s) toujours en attente.`);
  }

  /** Rejeu MANUEL d'UNE opération précise (y compris 'blocked') —
      « Réessayer cette opération » dans l'inspecteur. */
  async function retryOutboxOperation(operationId) {
    if (!firebaseReady || !firebaseDB) return { ok: false, reason: 'offline' };
    const q = _outboxLoad();
    const idx = q.findIndex(e => e.operationId === operationId);
    if (idx === -1) return { ok: false, reason: 'not_found' };
    const e = q[idx];
    try {
      await _replayEntry(e);
      q.splice(idx, 1);
      store(OUTBOX_KEY, q);
      try { window.SyncBadge?.render?.(); } catch (_) {}
      return { ok: true };
    } catch (err) {
      q[idx] = _failedEntry(e, err);
      store(OUTBOX_KEY, q);
      try { window.SyncBadge?.render?.(); } catch (_) {}
      return { ok: false, reason: 'failed', errorCode: err?.code || null, errorMessage: err?.message || null };
    }
  }

  /** Rejeu MANUEL de TOUTES les opérations bloquées — « Vérifier les
      opérations bloquées » dans l'inspecteur. Seule autre voie de rejeu
      d'une entrée 'blocked' (ex. après redéploiement d'une règle). */
  async function retryBlockedOutbox() {
    if (!firebaseReady || !firebaseDB) return { attempted: 0, succeeded: 0, failed: 0 };
    const q = _outboxLoad();
    let attempted = 0, succeeded = 0;
    const remaining = [];
    for (const e of q) {
      if (e.classification !== 'blocked') { remaining.push(e); continue; }
      attempted++;
      try {
        await _replayEntry(e);
        succeeded++;
      } catch (err) {
        remaining.push(_failedEntry(e, err));
      }
    }
    store(OUTBOX_KEY, remaining);
    try { window.SyncBadge?.render?.(); } catch (_) {}
    return { attempted, succeeded, failed: attempted - succeeded };
  }

  /** Suppression MANUELLE d'une opération de la file — jamais appelée
      automatiquement ; l'inspecteur (js/settings.js) exige une
      confirmation explicite de l'utilisateur avant cet appel. */
  function removeOutboxOperation(operationId) {
    const q = _outboxLoad();
    const filtered = q.filter(e => e.operationId !== operationId);
    if (filtered.length === q.length) return false;
    store(OUTBOX_KEY, filtered);
    try { window.SyncBadge?.render?.(); } catch (_) {}
    return true;
  }

  /* Export JSON de diagnostic — les valeurs dont la clé évoque un
     secret (mot de passe, PIN, jeton…) sont expurgées récursivement :
     le fichier peut être partagé pour diagnostic sans fuiter un
     identifiant. */
  const SENSITIVE_KEY_RE = /(password|passwd|pwd|pin|secret|token|apikey|api_key|credential|authkey|auth_key|privatekey|private_key)/i;
  function _redactSecrets(value) {
    if (Array.isArray(value)) return value.map(_redactSecrets);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = SENSITIVE_KEY_RE.test(k) ? '[expurgé]' : _redactSecrets(v);
      }
      return out;
    }
    return value;
  }
  function exportOutboxDiagnostic() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      appVersion: (typeof window !== 'undefined' && window.VersionManager?.getCurrent?.()?.version) || null,
      summary: getOutboxSummary(),
      entries: _redactSecrets(_outboxLoad()),
    }, null, 2);
  }

  /* ── IDs UNIQUES ──────────────────────────────────────
     Remplace les anciens `${PREFIX}${Date.now()}` qui pouvaient
     entrer en collision si deux écritures arrivaient dans la
     même milliseconde (lot rapide, double appui, Promise.all).
     N'affecte QUE les nouveaux IDs générés — les anciens IDs déjà
     stockés (format Date.now() seul) restent valides et inchangés.
  ──────────────────────────────────────────────────────── */
  function makeId(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `${prefix}${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ── NUMÉRO DE SÉRIE PATIENT ─────────────────────── */
  function generatePatientId(countryCode) {
    const yr    = new Date().getFullYear();
    const cc    = (countryCode || 'XX').toUpperCase().slice(0, 2);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let   rnd   = '';
    for (let i = 0; i < 8; i++) rnd += chars[Math.floor(Math.random() * chars.length)];
    return `MC-${yr}-${cc}-${rnd}`;
  }

  /* ── CODE D'ACCÈS PATIENT (premier accès) ──────────
     Donné par l'hôpital au patient à la création de sa fiche, saisi
     avec le PIN au premier accès (js/auth.js _createPatientPin) —
     vérifié côté serveur (firestore.rules) contre
     mc_patients/{id}.firstAccessCode. Empêche un tiers connaissant
     seulement le numéro de fiche de préempter le compte du patient
     avant lui (voir rapport de sécurité). Alphabet sans caractères
     ambigus à l'oral/à l'écrit (pas de O/0, I/1/L). */
  function generateFirstAccessCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  /* ── SYNC FIREBASE ───────────────────────────────────
     Écrit dans localStorage ET dans Firestore si dispo.
     Lit toujours depuis localStorage (cache local).

     _push()         : compatible avec tout le code existant
                       (aucun appelant actuel ne vérifie son retour),
                       mais retourne désormais true/false et logue
                       clairement tout échec au lieu de l'avaler.
     _pushCritical() : à utiliser pour les écritures où l'utilisateur
                       doit savoir si le cloud a réellement confirmé
                       (inscription, approbation admin...).
  ──────────────────────────────────────────────────── */
  async function _push(collection, docId, data) {
    if (!firebaseReady || !firebaseDB) {
      // Firestore pas prêt : on ne perd PAS l'écriture, on la met en
      // file pour rejeu automatique dès que le cloud répond.
      _outboxAdd(collection, docId, data);
      return false;
    }
    try {
      await firebaseDB.collection(collection).doc(String(docId)).set(data);
      return true;
    } catch (e) {
      console.warn(`[MedConnect] Échec écriture Firestore ${collection}/${docId} — mise en file :`, e?.message || e);
      _outboxAdd(collection, docId, data, e);
      return false;
    }
  }

  /** Écriture critique : retourne explicitement le résultat, ne masque jamais l'échec. */
  async function _pushCritical(collection, docId, data) {
    return _push(collection, docId, data);
  }

  /** Pousse plusieurs (collection, docId, data) et résout true seulement si TOUT a réussi. */
  async function pushAndReport(entries) {
    const results = await Promise.all(entries.map(([col, id, data]) => _pushCritical(col, id, data)));
    return results.every(Boolean);
  }

  /* ── DÉLAI MAXIMAL POUR LES ÉCRITURES CRITIQUES ────────
     Réservé aux actions administratives (approbation de compte,
     approbation d'affiliation…) : sans délai maximal, un bouton
     "Approuver"/"Refuser" pouvait rester indéfiniment sur "⏳" si
     Firestore ne répondait jamais (réseau très lent, requête bloquée),
     sans jamais informer l'administrateur de l'échec. N'affecte PAS
     les écritures médicales silencieuses habituelles (pushCloud/
     _push), qui continuent d'alimenter l'outbox sans délai imposé. */
  async function withTimeout(promise, timeoutMs, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} : délai dépassé`)), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Variante détaillée de pushAndReport(), réservée aux validations
      administratives critiques (AdminModule.approve/reject/suspend,
      HospitalsRegistry.respondAffiliation) : contrairement à
      pushAndReport() (booléen simple, utilisé par des dizaines
      d'appelants existants — le changer romprait leurs `if (!ok)`),
      celle-ci renvoie un compte-rendu complet ET applique un délai
      maximal par écriture, pour qu'un bouton de validation ne reste
      jamais bloqué indéfiniment sur un réseau qui ne répond jamais. */
  async function pushAndReportDetailed(entries, options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const label = options.label || 'Écriture';
    const succeeded = [];
    const failed = [];
    let timedOut = false;
    let error = null;

    await Promise.all(entries.map(async ([col, id, data]) => {
      try {
        const ok = await withTimeout(_pushCritical(col, id, data), timeoutMs, label);
        if (ok) succeeded.push([col, id]); else failed.push([col, id]);
      } catch (e) {
        if (/délai dépassé/.test(e?.message || '')) timedOut = true;
        error = e;
        failed.push([col, id]);
      }
    }));

    return { ok: failed.length === 0, succeeded, failed, timedOut, error };
  }

  /* ── ÉCRITURES ATOMIQUES (batch Firestore) ─────────────
     Revue Codex (P1, PR #39) : pushAndReport()/pushAndReportDetailed()
     poussent chaque document en parallèle et indépendamment — si l'un
     échoue après qu'un autre a réussi, le booléen/rapport final dit
     "échec", mais les documents déjà écrits restent en place (et
     _push() remet même le document en échec en file pour un rejeu
     automatique ultérieur). Pour un groupe de documents qui doivent
     TOUS exister ensemble ou PAS DU TOUT (inscription lab/reception :
     mc_accounts+users+registration_request ; validation admin :
     users+mc_accounts+registration_requests ; approbation
     d'affiliation : affiliation_requests+establishments+
     hospitalMembers), on utilise un vrai batch Firestore — atomique
     par construction (tout ou rien), disponible sur le SDK client
     compat sans Cloud Function ni plan Blaze. Volontairement SANS
     repli sur l'outbox en cas d'échec : un batch qui échoue ne doit
     jamais être rejoué pièce par pièce (ça romprait l'atomicité) —
     l'appelant doit réessayer l'opération complète (bouton "Réessayer"). */
  function _hasBatchSupport() {
    return !!(firebaseReady && firebaseDB && typeof firebaseDB.batch === 'function');
  }

  async function pushBatchAndReport(entries) {
    if (!_hasBatchSupport()) return false;
    try {
      const batch = firebaseDB.batch();
      entries.forEach(([col, id, data]) => {
        batch.set(firebaseDB.collection(col).doc(String(id)), data);
      });
      await batch.commit();
      return true;
    } catch (e) {
      console.warn('[MedConnect] Écriture atomique (batch) échouée :', e?.message || e);
      return false;
    }
  }

  async function pushBatchAndReportDetailed(entries, options = {}) {
    const timeoutMs = options.timeoutMs || 15000;
    const label = options.label || 'Écriture';
    const ids = entries.map(([col, id]) => [col, id]);
    if (!_hasBatchSupport()) {
      return { ok: false, succeeded: [], failed: ids, timedOut: false, error: new Error('Firestore indisponible') };
    }
    try {
      const batch = firebaseDB.batch();
      entries.forEach(([col, id, data]) => {
        batch.set(firebaseDB.collection(col).doc(String(id)), data);
      });
      await withTimeout(batch.commit(), timeoutMs, label);
      return { ok: true, succeeded: ids, failed: [], timedOut: false, error: null };
    } catch (e) {
      const timedOut = /délai dépassé/.test(e?.message || '');
      console.warn('[MedConnect] Écriture atomique détaillée (batch) échouée :', e?.message || e);
      return { ok: false, succeeded: [], failed: ids, timedOut, error: e };
    }
  }

  async function _delete(collection, docId) {
    if (!firebaseReady || !firebaseDB) return false;
    try {
      await firebaseDB.collection(collection).doc(String(docId)).delete();
      return true;
    } catch (e) {
      console.warn(`[MedConnect] Échec suppression Firestore ${collection}/${docId} :`, e?.message || e);
      return false;
    }
  }

  // Seules ces collections ADMINISTRATIVES, gérées côté cloud, se
  // vident quand le serveur confirme un snapshot vide (les « demandes
  // fantômes » du dashboard). Pour les données MÉDICALES créées
  // localement (ordonnances, consultations…), un cloud vide ne doit
  // JAMAIS effacer le travail local : d'anciennes écritures cloud ont
  // pu échouer en silence, le local est alors la seule copie.
  const EMPTY_WIPE_WHITELIST = new Set([
    'registration_requests', 'affiliation_requests',
    'establishments', 'establishment_documents',
  ]);

  function storeSnapshot(key, snap) {
    if (snap.empty) {
      if (!snap.metadata?.fromCache && EMPTY_WIPE_WHITELIST.has(key)) store(key, []);
      return;
    }
    store(key, snap.docs.map(d => d.data()));
  }

  /** Fusionne des documents dans une liste locale par identifiant,
      sans écraser les entrées locales absentes du snapshot (un
      listener FILTRÉ ne voit qu'une tranche de la collection : le
      remplacement intégral effacerait le reste). */
  function mergeStore(key, idField, docs) {
    const list = load(key);
    const byId = new Map(list.map(x => [x[idField], x]));
    docs.forEach(d => { if (d && d[idField] != null) byId.set(d[idField], d); });
    store(key, Array.from(byId.values()));
  }

  function listen(query, onData) {
    try {
      // Ne JAMAIS avaler l'erreur : c'est ce silence qui a masqué
      // pendant des semaines le rejet en bloc des requêtes
      // collection-entière par les règles Firestore.
      query.onSnapshot(onData, err =>
        console.warn('[MedConnect] Listener Firestore rejeté :', err?.message || err));
    } catch (e) {
      console.warn('[MedConnect] Listener impossible :', e?.message || e);
    }
  }

  function roleCollection(role) {
    return {
      patient: 'patients',
      doctor: 'doctors',
      nurse: 'nurses',
      pharmacist: 'pharmacies',
      pharmacy: 'pharmacies',
    }[role] || null;
  }

  function publicAccountProfile(account) {
    const profile = { ...account };
    delete profile.password;
    delete profile.passwordHash;
    return {
      ...profile,
      uid: account.uid,
      role: account.role,
      updatedAt: new Date().toISOString(),
    };
  }

  function mirrorAccountProfile(account) {
    if (!account?.uid) return;
    const profile = publicAccountProfile(account);
    _push('users', account.uid, profile);
    const collection = roleCollection(account.role);
    if (collection) _push(collection, account.uid, profile);
  }

  function professionalNumber(account) {
    return account?.order_num || account?.matricule || account?.username || '';
  }

  /* ── SYNC AU DÉMARRAGE ───────────────────────────── */
  async function syncFromFirebase() {
    if (!firebaseReady || !firebaseDB) return;
    // Collections SANS listener temps réel : seul le .get() initial
    // les charge. Les 12 collections couvertes par un listener dans
    // setupRealtimeListeners() sont volontairement EXCLUES d'ici :
    // la première émission d'un onSnapshot livre déjà l'intégralité
    // de la collection — le .get() préalable doublait chaque lecture
    // Firestore au démarrage (coût facturé + bande passante, bug
    // documenté de la version publiée). 'users' reste ici car son
    // listener est un sous-ensemble filtré (pharmacies publiques).
    const collections = [
      'mc_vaccinations','mc_lab_results','mc_consents','mc_admissions',
      'mc_emergency_cases','mc_maternity_cases',
      'users',
      'patients','doctors','nurses','pharmacies','hospitals',
      'medical_records','prescriptions','appointments','notifications',
      'mc_hospitals','mc_affiliations',
      // Collections des DEMANDES (écrites par un appareil, lues par
      // l'admin sur un autre) : sans elles, une demande créée sur
      // desktop ne redescendait jamais sur le mobile admin.
      'affiliation_requests','registration_requests','establishments',
      'mc_verified_doctors','mc_verified_pharms','mc_verified_nurses',
    ];
    // Chaque collection en parallèle avec un timeout individuel : un
    // réseau lent ou une requête bloquée ne doit jamais figer toute
    // l'app (observé : admin resté sur un sablier vide en LTE faible).
    const PER_COLLECTION_TIMEOUT_MS = 6000;
    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
      ]);
    }
    await Promise.all(collections.map(async col => {
      try {
        const snap = await withTimeout(firebaseDB.collection(col).get(), PER_COLLECTION_TIMEOUT_MS);
        // Vide confirmé serveur : vidage UNIQUEMENT pour les collections
        // administratives de la whitelist (fantômes du dashboard) —
        // jamais pour les données médicales créées localement.
        if (!snap.empty) store(col, snap.docs.map(d => d.data()));
        else if (!snap.metadata?.fromCache && EMPTY_WIPE_WHITELIST.has(col)) store(col, []);
      } catch (e) {
        console.warn(`[MedConnect] Sync ${col} ignorée (lente/indisponible) :`, e?.message || e);
      }
    }));
    // Horodatage pour l'écran "À propos" (VersionManager) — dernière
    // fois que la synchro Firebase a été tentée avec succès.
    try { localStorage.setItem('mc_last_sync_at', new Date().toISOString()); } catch (_) {}
  }

  function getLastSyncAt() {
    try { return localStorage.getItem('mc_last_sync_at'); } catch (_) { return null; }
  }

  /** Version non bloquante : lance la sync en arrière-plan sans jamais
      faire attendre l'appelant. À utiliser partout où l'affichage ne
      doit pas dépendre du réseau (ex: dashboard admin). */
  function syncFromFirebaseInBackground(onDone) {
    syncFromFirebase()
      .then(() => onDone?.(true))
      .catch(e => { console.warn('[MedConnect] Sync arrière-plan :', e); onDone?.(false); });
  }

  /* ── LISTENERS TEMPS RÉEL ────────────────────────── */
  function setupRealtimeListeners() {
    if (!firebaseReady || !firebaseDB) return;
    // Patients — FUSION : un dossier créé localement dont la montée
    // cloud a échoué ne doit pas disparaître au snapshot suivant.
    listen(firebaseDB.collection('mc_patients'), snap => {
      if (!snap.empty) mergeStore('mc_patients', 'id', snap.docs.map(d => d.data()));
    });
    // Messages : PAS de listener global ici — la règle Firestore exige
    // to_id == uid par document, une écoute collection-entière est
    // rejetée en bloc pour tout le monde (c'était le cas depuis
    // toujours, silencieusement). Voir setupUserScopedListeners().
    // Rendez-vous — FUSION (même principe que mc_patients).
    listen(firebaseDB.collection('mc_appointments'), snap => {
      if (!snap.empty) mergeStore('mc_appointments', 'aid', snap.docs.map(d => d.data()));
    });
    // Comptes
    listen(firebaseDB.collection('mc_accounts'), snap => {
      storeSnapshot('mc_accounts', snap);
    });
    // Profils pharmacies visibles publiquement — listener FILTRÉ :
    // fusion obligatoire, un remplacement intégral écraserait les
    // autres profils chargés par la sync initiale.
    listen(firebaseDB.collection('users')
      .where('role', '==', 'pharmacist')
      .where('status', 'in', ['active', 'approved'])
      .where('isLocationVisible', '==', true), snap => {
        if (!snap.empty) mergeStore('users', 'uid', snap.docs.map(d => d.data()));
    });
    // Établissements
    listen(firebaseDB.collection('establishments'), snap => {
      storeSnapshot('establishments', snap);
    });
    // Demandes d'affiliation
    listen(firebaseDB.collection('affiliation_requests'), snap => {
      storeSnapshot('affiliation_requests', snap);
    });
    listen(firebaseDB.collection('registration_requests'), snap => {
      storeSnapshot('registration_requests', snap);
    });
    // Ordonnances — FUSION : c'est la protection qui garantit que
    // l'ordonnance du médecin reste visible même si sa montée cloud
    // a échoué (cause de l'écran « Aucune donnée »).
    listen(firebaseDB.collection('mc_prescriptions'), snap => {
      if (!snap.empty) mergeStore('mc_prescriptions', 'pid', snap.docs.map(d => d.data()));
    });
    // Consultations — FUSION (même principe).
    listen(firebaseDB.collection('mc_consultations'), snap => {
      if (!snap.empty) mergeStore('mc_consultations', 'cid', snap.docs.map(d => d.data()));
    });
    // Inventaire pharmacie (stock partagé entre appareils du même pharmacien)
    listen(firebaseDB.collection('mc_medicines'), snap => {
      storeSnapshot('mc_medicines', snap);
    });
    // Ventes
    listen(firebaseDB.collection('mc_sales'), snap => {
      storeSnapshot('mc_sales', snap);
    });
    // Trace documents établissement (audit)
    listen(firebaseDB.collection('establishment_documents'), snap => {
      storeSnapshot('establishment_documents', snap);
    });
  }

  /** Listeners dépendants de l'utilisateur connecté — montés APRÈS
      login (App.startExchangeSync), pas au boot. Requêtes filtrées :
      seule forme que les règles par-document acceptent. Fusion par
      identifiant : un snapshot filtré ne doit jamais écraser le
      reste de la liste locale. */
  let _userListenersUnsubs = [];
  function setupUserScopedListeners() {
    if (!firebaseReady || !firebaseDB) return;
    const user = window.Auth?.getUser?.();
    if (!user?.uid) return;

    _userListenersUnsubs.forEach(u => { try { u(); } catch (_) {} });
    _userListenersUnsubs = [];

    const scoped = (query, key, idField) => {
      try {
        const unsub = query.onSnapshot(
          snap => {
            if (!snap.empty) {
              mergeStore(key, idField, snap.docs.map(d => d.data()));
              // Rafraîchit la vue affichée si elle dépend de ces données
              // (ex. l'écran Ordonnances quand mc_prescriptions arrive),
              // pour un affichage immédiat sans rechargement manuel.
              try {
                const section = { mc_prescriptions: 'prescriptions', mc_messages: 'messages' }[key];
                if (section && window.App?.refreshIfCurrent) window.App.refreshIfCurrent(section);
              } catch (_) {}
            }
          },
          err => console.warn(`[MedConnect] Listener ${key} (scoped) rejeté :`, err?.message || err)
        );
        _userListenersUnsubs.push(unsub);
      } catch (e) {
        console.warn(`[MedConnect] Listener ${key} impossible :`, e?.message || e);
      }
    };

    // Messagerie : la règle exige to_id == uid — c'est la seule
    // écoute des messages qui fonctionne réellement.
    scoped(firebaseDB.collection('mc_messages').where('to_id', '==', user.uid),
      'mc_messages', 'mid');

    // Pharmacien : ses ordonnances reçues (pharmacyCanReadPrescription).
    if (user.role === 'pharmacist') {
      scoped(firebaseDB.collection('mc_prescriptions').where('pharmacyUid', '==', user.uid),
        'mc_prescriptions', 'pid');
    }

    // Médecin / infirmier : la règle Firestore les autorise à LIRE la
    // collection mc_prescriptions (currentRoleIs doctor/nurse). Sans ce
    // listener, leurs ordonnances n'étaient jamais rechargées après la
    // connexion — cause du bug « ordonnances qui n'apparaissent pas ».
    // Le filtrage métier (contexte établissement, consentement patient)
    // reste appliqué à l'affichage par prescriptionsForContext ; ici on
    // se contente de ramener les données en local par fusion.
    if (user.role === 'doctor' || user.role === 'nurse') {
      scoped(firebaseDB.collection('mc_prescriptions'),
        'mc_prescriptions', 'pid');
    }
  }

  /* ── INIT ────────────────────────────────────────── */
  async function init() {
    await syncFromFirebase();
    setupRealtimeListeners();
    // Rejoue immédiatement les écritures d'une session précédente qui
    // n'avaient pas atteint le cloud (fermeture d'app hors-ligne, etc.),
    // puis réessaie régulièrement tant qu'il en reste.
    flushOutbox();
    setInterval(flushOutbox, 20000);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', flushOutbox);
    }
  }

  /* ══════════════════════════════════════════════════
     PATIENTS
  ══════════════════════════════════════════════════ */
  function getPatients()   { return load('mc_patients'); }
  function savePatients(list) { store('mc_patients', list); }

  function addPatient(data) {
    const list = getPatients();
    const p = { ...data, id: generatePatientId(data.country_code), firstAccessCode: generateFirstAccessCode(), created_at: new Date().toISOString() };
    list.push(p); store('mc_patients', list);
    _push('mc_patients', p.id, p);
    _push('patients', p.id, p);
    _push('medical_records', p.id, {
      recordId: p.id,
      patientId: p.id,
      patientUid: p.uid || p.patient_uid || '',
      created_by: p.created_by || '',
      establishmentId: p.establishmentId || p.hospital_id || '',
      type: 'patient_record',
      status: 'active',
      createdAt: p.created_at,
      updatedAt: p.created_at,
    });
    return p;
  }

  /* ── Réaffichage du code d'accès après création ──────
     showFirstAccessCodeModal (js/hospital.js) ne montre le code
     qu'une fois, à la création. Si le personnel doit le redonner au
     patient plus tard, il faut vérifier avant tout que le compte
     n'est pas déjà créé (le code serait alors sans objet) puis
     relire le code réel côté serveur — jamais se fier uniquement au
     cache local, qui peut ne pas refléter un compte créé depuis un
     autre appareil. */
  async function accountExistsForPatient(patientId) {
    const uid = `PAT_${patientId}`;
    if (getAccounts().some(a => a.uid === uid)) return true;
    if (!firebaseReady || !firebaseDB) return false;
    try {
      const doc = await firebaseDB.collection('mc_accounts').doc(uid).get();
      return doc.exists;
    } catch (e) { console.warn('[MedConnect] Vérification compte existant :', e); return false; }
  }

  async function getPatientAccessCode(patientId) {
    if (firebaseReady && firebaseDB) {
      try {
        const doc = await firebaseDB.collection('mc_patients').doc(patientId).get();
        if (doc.exists) return doc.data()?.firstAccessCode || null;
      } catch (e) { console.warn('[MedConnect] Lecture du code d\'accès :', e); }
    }
    return getPatientById(patientId)?.firstAccessCode || null;
  }

  /* ⚠️ OBSOLÈTE (chantier v2.9.34, P0 création patient) : plus aucun
     appelant applicatif — le parcours médecin (js/hospital.js
     saveNewPatient) utilise désormais le service atomique unique
     addPatientAndConfirmAtomic(), comme la réception. Conservée
     uniquement pour la compatibilité de signature publique (consigne
     du chantier : ne jamais casser un appelant externe éventuel) ; ne
     pas réutiliser pour du nouveau code : cache local renseigné AVANT
     confirmation, écritures indépendantes (non atomiques), pas de
     patient_directory. */
  async function addPatientAndConfirm(data) {
    const p = addPatient(data);
    // Seul mc_patients est vérifié par patientFirstAccessOk() côté
    // règles — inutile de re-pousser patients/medical_records ici,
    // addPatient() les a déjà mis en route (fire-and-forget, comme
    // pour tous ses autres appelants).
    const ok = await pushAndReport([['mc_patients', p.id, p]]);
    return { patient: p, confirmed: ok };
  }

  /* Chantier "sécurité/réception/affiliation sans régression" (section
     4) : variante STRICTE d'addPatientAndConfirm(), réservée à la
     réception. Contrairement à addPatientAndConfirm() (confirme
     seulement mc_patients, tolère une synchronisation différée des 2
     autres documents via l'outbox — comportement déjà validé pour
     médecin/infirmier, volontairement inchangé ci-dessus), la réception
     ne doit JAMAIS créer une prise en charge (receptionVisits/admissions)
     sur une fiche dont les 3 documents ne sont pas RÉELLEMENT confirmés
     ensemble par Firestore. Utilise le batch atomique existant
     (pushBatchAndReportDetailed, déjà utilisé par
     HospitalsRegistry.respondAffiliation) — tout ou rien, sans repli
     outbox pièce par pièce (cf. commentaire ligne ~208) : un échec ici
     signifie qu'AUCUN des 3 documents n'a atteint Firestore, jamais un
     état partiel. addPatient() a déjà lancé ses propres écritures
     fire-and-forget (comportement historique inchangé pour ses autres
     appelants directs, maternité/urgences) ; ce second passage est
     redondant mais idempotent (set() par id identique), et c'est le
     seul dont le résultat est réellement attendu ici. */
  // Correctif (audit "workflows mobile/desktop", section 5) : bug
  // confirmé — addPatientAndConfirmAtomic() appelait addPatient(), qui
  // écrit IMMÉDIATEMENT dans le cache local ET lance trois écritures
  // _push() INDÉPENDANTES (mc_patients/patients/medical_records),
  // chacune capable d'échouer et de se mettre en file d'outbox
  // SÉPARÉMENT — avant même que le batch supposé atomique ci-dessous ne
  // s'exécute. Hors ligne, ça pouvait mettre en file trois écritures
  // non groupées pour une fiche que le batch atomique rejetait ensuite
  // (et retirait du cache), rejouées plus tard indépendamment : la
  // pire des deux moitiés d'une même fiche pouvait survivre. Cette
  // fonction n'écrit donc plus JAMAIS dans le cache ni dans l'outbox
  // avant la confirmation réelle du batch — buildPatientRecord() est un
  // helper pur (aucune écriture), et le cache n'est renseigné qu'après
  // un batch.commit() réellement confirmé.
  function buildPatientRecord(data) {
    return { ...data, id: generatePatientId(data.country_code), firstAccessCode: generateFirstAccessCode(), created_at: new Date().toISOString() };
  }

  // Correctif (audit "workflows mobile/desktop", section 7) : annuaire
  // non clinique (patient_directory) alimenté dans le MÊME batch que
  // mc_patients/patients/medical_records — jamais de contenu clinique,
  // jamais écrit séparément (voir firestore.rules patientDirectoryFieldsOk).
  function buildPatientDirectoryEntry(p) {
    return {
      patientId: p.id,
      firstname: p.firstname || '',
      lastname: p.lastname || '',
      dob: p.dob || p.birthdate || '',
      gender: p.gender || '',
      phone: p.phone || '',
      establishmentId: p.establishmentId || p.hospital_id || '',
      hospital_id: p.hospital_id || p.establishmentId || '',
      administrativeStatus: 'active',
      createdAt: p.created_at,
      updatedAt: p.created_at,
    };
  }

  /* Chantier v2.9.34 (P0 création patient) : SERVICE UNIQUE de création
     patient, partagé par TOUS les rôles autorisés (médecin mobile,
     médecin desktop, réception desktop) — le parcours médecin passait
     encore par addPatientAndConfirm() (cache local immédiat + 3
     écritures indépendantes, sans patient_directory, code d'accès
     affiché même non confirmé).

     Contrat de retour :
     - { patient, confirmed: true }                    → les 4 documents
       sont RÉELLEMENT dans Firestore (ou réconciliés après timeout) ;
       le cache local vient d'être renseigné ; le code de premier accès
       peut être affiché.
     - { patient, confirmed: false, queued: true,
         operationId }                                 → hors ligne (ou
       cloud injoignable après timeout non réconciliable) : le groupe
       ATOMIQUE complet est en file d'outbox comme UNE SEULE opération
       (jamais décomposé), rejouable tel quel — le cache local n'est PAS
       renseigné (il le sera par le listener Firestore quand le batch
       aura réellement abouti), le code d'accès n'est PAS affichable.
     - { patient: null, confirmed: false, failed: true,
         blocked?, errorCode? }                        → rejet réel
       (ex. permission refusée) : RIEN n'est créé nulle part, rien n'est
       mis en file (un rejeu produirait le même refus ; et une nouvelle
       tentative de l'agent, avec un NOUVEL identifiant, ne doit jamais
       pouvoir entrer en collision avec une file fantôme). L'appelant
       garde la modale ouverte pour permettre une nouvelle tentative.

     Idempotence/réconciliation (Promise.race n'annule JAMAIS une
     écriture déjà partie) : toutes les écritures sont des set() sur des
     identifiants FIXES — rejouer le même groupe ne peut pas créer de
     doublon. Après un timeout, on RELIT mc_patients/{id} : si le
     document existe, le batch avait réellement abouti → confirmé
     (jamais une nouvelle création proposée pour rien) ; sinon on met le
     groupe en file (rejeu sans risque, mêmes ids). */
  let _creatingPatient = false;
  async function addPatientAndConfirmAtomic(data, options = {}) {
    if (_creatingPatient) return { patient: null, confirmed: false, failed: true, busy: true };
    _creatingPatient = true;
    try {
      const p = buildPatientRecord(data);
      const medicalRecord = {
        recordId: p.id,
        patientId: p.id,
        patientUid: p.uid || p.patient_uid || '',
        created_by: p.created_by || '',
        establishmentId: p.establishmentId || p.hospital_id || '',
        type: 'patient_record',
        status: 'active',
        createdAt: p.created_at,
        updatedAt: p.created_at,
      };
      const writes = [
        ['mc_patients', p.id, p],
        ['patients', p.id, p],
        ['medical_records', p.id, medicalRecord],
        ['patient_directory', p.id, buildPatientDirectoryEntry(p)],
      ];
      const opMeta = { operationType: 'patient_create', module: 'patients', groupId: p.id };

      const confirmLocally = () => {
        // Le cache local n'est renseigné qu'APRÈS confirmation réelle
        // du batch — jamais avant.
        const list = getPatients();
        if (!list.some(x => x.id === p.id)) { list.push(p); store('mc_patients', list); }
      };

      // Hors ligne d'emblée : mise en file du groupe atomique complet.
      if (!_hasBatchSupport()) {
        const operationId = _outboxAddBatch(writes, null, opMeta);
        return { patient: p, confirmed: false, queued: true, operationId };
      }

      const result = await pushBatchAndReportDetailed(writes, { label: 'Création patient', timeoutMs: options.timeoutMs });
      if (result.ok) {
        confirmLocally();
        return { patient: p, confirmed: true };
      }

      if (result.timedOut) {
        // Réconciliation : le commit est peut-être passé malgré le
        // timeout côté interface.
        try {
          const doc = await firebaseDB.collection('mc_patients').doc(p.id).get();
          if (doc.exists) {
            confirmLocally();
            return { patient: p, confirmed: true, reconciled: true };
          }
        } catch (_) { /* relecture impossible : traité comme injoignable ci-dessous */ }
        const operationId = _outboxAddBatch(writes, result.error, opMeta);
        return { patient: p, confirmed: false, queued: true, operationId };
      }

      const classification = classifyOutboxError(result.error);
      if (classification === 'blocked') {
        // Rejet réel (permission, données invalides…) : rien n'est créé,
        // rien n'est mis en file — l'agent corrige et réessaie.
        return {
          patient: null, confirmed: false, failed: true, blocked: true,
          errorCode: result.error?.code || null,
          errorMessage: result.error?.message || null,
        };
      }
      // Échec transitoire (service indisponible…) : le commit n'a pas
      // abouti — mise en file du groupe atomique complet.
      const operationId = _outboxAddBatch(writes, result.error, opMeta);
      return { patient: p, confirmed: false, queued: true, operationId };
    } finally {
      _creatingPatient = false;
    }
  }

  function updatePatient(id, data) {
    const list = getPatients();
    const idx  = list.findIndex(p => p.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, id, updated_at: new Date().toISOString() };
      store('mc_patients', list);
      _push('mc_patients', id, list[idx]);
      _push('patients', id, list[idx]);
      _push('medical_records', id, {
        recordId: id,
        patientId: id,
        patientUid: list[idx].uid || list[idx].patient_uid || '',
        created_by: list[idx].created_by || '',
        establishmentId: list[idx].establishmentId || list[idx].hospital_id || '',
        type: 'patient_record',
        status: 'active',
        updatedAt: list[idx].updated_at,
      });
      return list[idx];
    }
    return null;
  }

  function deletePatient(id) {
    store('mc_patients',       getPatients().filter(p => p.id !== id));
    store('mc_consultations',  getConsultations().filter(c => c.patient_id !== id));
    store('mc_prescriptions',  getPrescriptions().filter(p => p.patient_id !== id));
    store('mc_vaccinations',   getVaccinations().filter(v => v.patient_id !== id));
    store('mc_lab_results',    getAllLabResults().filter(l => l.patient_id !== id));
    store('mc_appointments',   getAppointments().filter(a => a.patient_id !== id));
    _delete('mc_patients', id);
    _delete('patients', id);
    _delete('medical_records', id);
  }

  function getPatientById(id) { return getPatients().find(p => p.id === id) || null; }

  function searchPatients(q) {
    if (!q) return getPatients();
    const ql = q.toLowerCase();
    return getPatients().filter(p =>
      (p.id||'').toLowerCase().includes(ql) ||
      (p.firstname||'').toLowerCase().includes(ql) ||
      (p.lastname||'').toLowerCase().includes(ql) ||
      (p.phone||'').includes(ql));
  }

  /* ══════════════════════════════════════════════════
     COMPTES
  ══════════════════════════════════════════════════ */
  function getAccounts()    { return load('mc_accounts'); }
  function saveAccounts(l)  {
    store('mc_accounts', l);
    l.forEach(a => {
      _push('mc_accounts', a.uid, a);
      mirrorAccountProfile(a);
    });
  }

  function getUsers()       { return load('users'); }
  function saveUsers(l)     {
    store('users', l);
    l.forEach(u => {
      _push('users', u.uid, u);
      const collection = roleCollection(u.role);
      if (collection) _push(collection, u.uid, u);
    });
  }

  function getRegistrationRequests() { return load('registration_requests'); }
  function saveRegistrationRequests(l) {
    store('registration_requests', l);
    l.forEach(r => _push('registration_requests', r.requestId, r));
  }

  function createRegistrationRequest(account) {
    const list = getRegistrationRequests();
    const requestId = makeId('REG');
    const req = {
      requestId,
      requesterUid: account.uid,
      requesterName: account.name || '',
      requesterRole: account.role,
      professionalNumber: professionalNumber(account),
      email: account.email || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(req);
    saveRegistrationRequests(list);
    return req;
  }

  function upsertUserProfile(uid, data) {
    const users = getUsers();
    const idx = users.findIndex(u => u.uid === uid);
    const current = idx !== -1 ? users[idx] : { uid };
    const next = { ...current, ...data, uid, updatedAt: new Date().toISOString() };
    if (idx === -1) users.push(next);
    else users[idx] = next;
    saveUsers(users);
    _push('users', uid, next);
    return next;
  }

  /* ══════════════════════════════════════════════════
     CONSULTATIONS
  ══════════════════════════════════════════════════ */
  function getConsultations() { return load('mc_consultations'); }

  function addConsultation(data) {
    const list = getConsultations();
    // sourceDevice : nécessaire pour que hospitalCanWriteFromDevice()
    // (firestore.rules) applique la distinction desktop/mobile — sans
    // ce champ, resolveHospitalId() trouve bien l'établissement mais
    // la règle reste permissive par défaut (même piège déjà corrigé
    // au cas par cas sur emergency-transfer.js, voir addPrescription
    // ci-dessous qui l'a déjà).
    const c = { ...data, cid: makeId('C'), date: data.date || today(),
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(c); store('mc_consultations', list);
    _push('mc_consultations', c.cid, c);
    _push('medical_records', c.cid, {
      ...c,
      recordId: c.cid,
      type: 'consultation',
      patientId: c.patient_id,
      patientUid: c.patient_uid || '',
      updatedAt: new Date().toISOString(),
    });
    return c;
  }

  function getPatientConsultations(pid) {
    return getConsultations().filter(c => c.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteConsultation(cid) {
    store('mc_consultations', getConsultations().filter(c => c.cid !== cid));
    _delete('mc_consultations', cid);
  }

  /* ══════════════════════════════════════════════════
     PRESCRIPTIONS
  ══════════════════════════════════════════════════ */
  function getPrescriptions() { return load('mc_prescriptions'); }

  function addPrescription(data) {
    const list = getPrescriptions();
    const p = { ...data, pid: makeId('P'), date: data.date || today(), status: data.status || 'sent',
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(p); store('mc_prescriptions', list);
    _push('mc_prescriptions', p.pid, p);
    _push('prescriptions', p.pid, p);
    return p;
  }

  /** Applique la mise à jour au store local uniquement (pas d'écriture
      cloud ici) et retourne l'objet fusionné, ou null si introuvable. */
  function _updatePrescriptionLocal(pid, data) {
    const list = getPrescriptions();
    const idx  = list.findIndex(p => p.pid === pid);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...data, pid, updatedAt: new Date().toISOString() };
    store('mc_prescriptions', list);
    return list[idx];
  }

  function updatePrescription(pid, data) {
    const updated = _updatePrescriptionLocal(pid, data);
    if (!updated) return null;
    _push('mc_prescriptions', pid, updated);
    _push('prescriptions', pid, updated);
    return updated;
  }

  /** Comme updatePrescription, mais attend la confirmation Firestore
      réelle avant de résoudre — utilisé quand l'appelant doit savoir
      si le cloud a réellement accepté l'écriture (ex : avant d'afficher
      "Ordonnance envoyée" à l'utilisateur) plutôt que de l'afficher de
      façon optimiste sur une écriture fire-and-forget. Retourne
      { ok, reason } plutôt qu'un simple booléen, pour que l'appelant
      distingue "hors ligne, en file d'attente" de "refusé par le
      serveur" (PARTIE H/K) — reason vaut 'offline' ou 'denied' quand
      ok est false, sinon null. */
  async function updatePrescriptionAndConfirm(pid, data) {
    const updated = _updatePrescriptionLocal(pid, data);
    if (!updated) return { ok: false, reason: 'not_found' };
    const wasOffline = !firebaseReady || !firebaseDB;
    const ok = await pushAndReport([
      ['mc_prescriptions', pid, updated],
      ['prescriptions', pid, updated],
    ]);
    return { ok, reason: ok ? null : (wasOffline ? 'offline' : 'denied') };
  }

  function getPatientPrescriptions(pid) {
    return getPrescriptions().filter(p => p.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     RENDEZ-VOUS
  ══════════════════════════════════════════════════ */
  /* ══════════════════════════════════════════════════
     PARTIE G — TRACE DOCUMENTS ÉTABLISSEMENT (audit)
  ══════════════════════════════════════════════════ */
  function getEstablishmentDocuments() { return load('establishment_documents'); }

  function addEstablishmentDocument(doc) {
    const list = getEstablishmentDocuments();
    const d = {
      documentId: makeId('DOC'),
      createdAt:  new Date().toISOString(),
      auditRequired: true,
      ...doc,
    };
    list.push(d); store('establishment_documents', list);
    _push('establishment_documents', d.documentId, d);
    return d;
  }

  /** Documents d'un patient (champ canonique de establishment_documents :
      patientUid, cf. hospital.js addEstablishmentDocument), éventuellement
      filtrés par documentType (ex: 'imaging' pour l'onglet Imagerie). */
  function getPatientEstablishmentDocuments(pid, documentType) {
    return getEstablishmentDocuments()
      .filter(d => d.patientUid === pid && (!documentType || d.documentType === documentType))
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  }

  function getAppointments() { return load('mc_appointments'); }

  function addAppointment(data) {
    const list = getAppointments();
    // sourceDevice : nécessaire pour que hospitalCanWriteFromDevice()
    // (firestore.rules, mc_appointments) applique la distinction
    // desktop/mobile — la clause existait déjà côté règles (PR2) mais
    // restait un no-op sans ce champ, comme pour addConsultation avant
    // son propre correctif.
    const a = { ...data, aid: makeId('A'), created_at: new Date().toISOString(),
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'mobile' };
    list.push(a); store('mc_appointments', list);
    _push('mc_appointments', a.aid, a);
    _push('appointments', a.aid, a);
    return a;
  }

  function updateAppointment(aid, data) {
    const list = getAppointments();
    const idx  = list.findIndex(a => a.aid === aid);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, aid };
      store('mc_appointments', list);
      _push('mc_appointments', aid, list[idx]);
      _push('appointments', aid, list[idx]);
    }
  }

  function deleteAppointment(aid) {
    store('mc_appointments', getAppointments().filter(a => a.aid !== aid));
    _delete('mc_appointments', aid);
    _delete('appointments', aid);
  }

  function getPatientAppointments(pid) {
    return getAppointments().filter(a => a.patient_id === pid).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }

  /* ══════════════════════════════════════════════════
     VACCINATIONS
  ══════════════════════════════════════════════════ */
  function getVaccinations() { return load('mc_vaccinations'); }

  function addVaccination(data) {
    const list = getVaccinations();
    const v = { ...data, vid: makeId('V'), date: data.date || today() };
    list.push(v); store('mc_vaccinations', list);
    _push('mc_vaccinations', v.vid, v);
    return v;
  }

  function getPatientVaccinations(pid) {
    return getVaccinations().filter(v => v.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteVaccination(vid) {
    store('mc_vaccinations', getVaccinations().filter(v => v.vid !== vid));
    _delete('mc_vaccinations', vid);
  }

  /* ══════════════════════════════════════════════════
     LABORATOIRE
  ══════════════════════════════════════════════════ */
  function getAllLabResults() { return load('mc_lab_results'); }

  function addLabResult(data) {
    const list = getAllLabResults();
    const l = { ...data, lid: makeId('L'), date: data.date || today() };
    list.push(l); store('mc_lab_results', list);
    _push('mc_lab_results', l.lid, l);
    _push('medical_records', l.lid, {
      ...l,
      recordId: l.lid,
      type: 'lab_result',
      patientId: l.patient_id,
      patientUid: l.patient_uid || '',
      updatedAt: new Date().toISOString(),
    });
    return l;
  }

  function getPatientLabResults(pid) {
    return getAllLabResults().filter(l => l.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function deleteLabResult(lid) {
    store('mc_lab_results', getAllLabResults().filter(l => l.lid !== lid));
    _delete('mc_lab_results', lid);
    _delete('medical_records', lid);
  }

  /* ══════════════════════════════════════════════════
     ADMISSIONS (miroir patient)

     Correctif (audit) : hospital-beds.js/hospital-reception.js
     écrivent l'admission dans la collection desktop `admissions`
     (patientMc, jamais lue par le patient) — le filtre "🏥
     Hospitalisation" de js/timeline.js existait déjà côté interface
     mais n'était jamais alimenté. mc_admissions est le miroir
     lisible côté patient, même principe que mc_lab_results.
  ══════════════════════════════════════════════════ */
  function getAllAdmissions() { return load('mc_admissions'); }

  function addAdmissionRecord(data) {
    const list = getAllAdmissions();
    const a = { ...data, aid: data.aid || makeId('ADM'), date: data.date || today() };
    list.push(a); store('mc_admissions', list);
    _push('mc_admissions', a.aid, a);
    return a;
  }
  /** Met à jour le miroir patient d'une admission (ex : sortie) en le
      retrouvant par sourceAdmissionId — l'id de l'admission desktop posé
      à la création. Sans ce lien, la Timeline du patient continuait à
      afficher l'hospitalisation "en cours" après la sortie (le miroir ne
      gérait que la création). Règle mc_admissions : allow write (update
      couvert). */
  function updateAdmissionRecord(sourceAdmissionId, patch) {
    if (!sourceAdmissionId) return null;
    const list = getAllAdmissions();
    const idx = list.findIndex(a => a.sourceAdmissionId === sourceAdmissionId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    store('mc_admissions', list);
    _push('mc_admissions', list[idx].aid, list[idx]);
    return list[idx];
  }

  function getPatientAdmissions(pid) {
    return getAllAdmissions().filter(a => a.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     URGENCES / MATERNITÉ (miroirs patient)

     Correctif (audit) : hospital-emergency.js/hospital-maternity.js
     écrivent uniquement dans les collections desktop emergencyCases/
     maternityCases (patientMc, aucun champ patient_uid/uid) — lues
     exclusivement par leur propre module desktop, jamais par le
     patient ni par un autre professionnel. Même principe de miroir
     que mc_lab_results/mc_admissions.
  ══════════════════════════════════════════════════ */
  function getAllEmergencyCases() { return load('mc_emergency_cases'); }

  function addEmergencyCaseRecord(data) {
    const list = getAllEmergencyCases();
    const e = { ...data, eid: data.eid || makeId('ER'), date: data.date || today() };
    list.push(e); store('mc_emergency_cases', list);
    _push('mc_emergency_cases', e.eid, e);
    return e;
  }
  /** Met à jour le miroir patient d'un passage aux urgences (ex :
      clôture) par sourceCaseId — l'id du cas desktop posé à la création.
      Garde le miroir cohérent avec le statut réel. */
  function updateEmergencyCaseRecord(sourceCaseId, patch) {
    if (!sourceCaseId) return null;
    const list = getAllEmergencyCases();
    const idx = list.findIndex(e => e.sourceCaseId === sourceCaseId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    store('mc_emergency_cases', list);
    _push('mc_emergency_cases', list[idx].eid, list[idx]);
    return list[idx];
  }

  function getPatientEmergencyCases(pid) {
    return getAllEmergencyCases().filter(e => e.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  function getAllMaternityCases() { return load('mc_maternity_cases'); }

  function addMaternityCaseRecord(data) {
    const list = getAllMaternityCases();
    const m = { ...data, mid: data.mid || makeId('MAT'), date: data.date || today() };
    list.push(m); store('mc_maternity_cases', list);
    _push('mc_maternity_cases', m.mid, m);
    return m;
  }
  /** Met à jour le miroir patient d'un dossier de maternité (accouchement,
      clôture) par sourceCaseId — l'id du cas desktop posé à la création.
      Garde le miroir cohérent avec le statut réel. */
  function updateMaternityCaseRecord(sourceCaseId, patch) {
    if (!sourceCaseId) return null;
    const list = getAllMaternityCases();
    const idx = list.findIndex(m => m.sourceCaseId === sourceCaseId);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    store('mc_maternity_cases', list);
    _push('mc_maternity_cases', list[idx].mid, list[idx]);
    return list[idx];
  }

  function getPatientMaternityCases(pid) {
    return getAllMaternityCases().filter(m => m.patient_id === pid).sort((a,b) => b.date.localeCompare(a.date));
  }

  /* ══════════════════════════════════════════════════
     MÉDICAMENTS
  ══════════════════════════════════════════════════ */
  function getMedicines() { return load('mc_medicines'); }

  // Chantier sécurité (section 11) : bug confirmé — mc_medicines
  // n'avait jamais de pharmacyUid, et firestore.rules autorisait
  // "write: if currentRoleIs('pharmacist')" sans aucune isolation —
  // n'importe quel pharmacien pouvait modifier/supprimer le stock d'un
  // AUTRE pharmacien. pharmacyUid identifie désormais le propriétaire
  // dès la création (lecture catalogue publique inchangée : seule
  // l'écriture est concernée, voir firestore.rules).
  function addMedicine(data) {
    const list = getMedicines();
    const m = { ...data, mid: makeId('M'), pharmacyUid: window.Auth?.getUser?.()?.uid || '', created_at: new Date().toISOString() };
    list.push(m); store('mc_medicines', list);
    _push('mc_medicines', m.mid, m);
    return m;
  }

  function updateMedicine(mid, data) {
    const list = getMedicines();
    const idx  = list.findIndex(m => m.mid === mid);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...data, mid };
      store('mc_medicines', list);
      _push('mc_medicines', mid, list[idx]);
    }
  }

  function deleteMedicine(mid) {
    store('mc_medicines', getMedicines().filter(m => m.mid !== mid));
    _delete('mc_medicines', mid);
  }

  /* ══════════════════════════════════════════════════
     VENTES
  ══════════════════════════════════════════════════ */
  function getSales() { return load('mc_sales'); }

  function addSale(items, total, patientId) {
    const list = getSales();
    const s = {
      sid: makeId('S'), items,
      total: parseFloat(total).toFixed(2),
      patient_id: patientId || null,
      date: today(), time: new Date().toLocaleTimeString(),
      // Chantier sécurité (section 11) : même correctif que
      // addMedicine() — mc_sales n'avait aucun identifiant de
      // propriétaire, et firestore.rules autorisait tout pharmacien à
      // lire/écrire les ventes de N'IMPORTE QUEL AUTRE pharmacien.
      pharmacyUid: window.Auth?.getUser?.()?.uid || '',
    };
    list.push(s); store('mc_sales', list);
    _push('mc_sales', s.sid, s);
    // Déduire le stock
    const meds = getMedicines();
    items.forEach(i => {
      const idx = meds.findIndex(m => m.mid === i.mid);
      if (idx !== -1) meds[idx].stock = Math.max(0, (parseInt(meds[idx].stock)||0) - i.qty);
    });
    store('mc_medicines', meds);
    meds.forEach(m => _push('mc_medicines', m.mid, m));
    return s;
  }

  /* ══════════════════════════════════════════════════
     MESSAGES
  ══════════════════════════════════════════════════ */
  function getMessages()    { return load('mc_messages'); }
  function saveMessages(l)  {
    store('mc_messages', l);
    l.forEach(m => {
      _push('mc_messages', m.mid, m);
      _push('notifications', m.mid, m);
    });
  }

  /* ══════════════════════════════════════════════════
     PARAMÈTRES
  ══════════════════════════════════════════════════ */
  function getSettings()      { return load('mc_settings', {}); }
  function saveSettings(data) {
    const s = { ...getSettings(), ...data };
    store('mc_settings', s);
    // Nettoyage (audit) : l'ancienne écriture cloud des réglages visait
    // une collection SANS aucune règle Firestore — systématiquement
    // rejetée par la clause catch-all (allow write: if false) — et jamais
    // relue côté cloud (getSettings lit le localStorage local, aucune
    // synchronisation des réglages). Écriture morte retirée : les réglages
    // restent locaux à l'appareil, comme c'était déjà le cas en pratique.
    // (Une vraie synchro cross-appareil nécessiterait règles + listener +
    // lecture cloud — hors périmètre.)
  }

  /* ══════════════════════════════════════════════════
     STATISTIQUES
  ══════════════════════════════════════════════════ */
  function getStats() {
    const pts   = getPatients();
    const cons  = getConsultations();
    const sales = getSales();
    const meds  = getMedicines();
    const apts  = getAppointments();
    const msgs  = getMessages();
    const td    = today();
    return {
      totalPatients:   pts.length,
      todayPatients:   pts.filter(p => (p.created_at||'').startsWith(td)).length,
      totalConsults:   cons.length,
      todayConsults:   cons.filter(c => c.date === td).length,
      totalSales:      sales.reduce((s,x) => s + parseFloat(x.total||0), 0),
      todaySales:      sales.filter(x => x.date === td).reduce((s,x) => s + parseFloat(x.total||0), 0),
      lowStockCount:   meds.filter(m => parseInt(m.stock) < 10).length,
      expiredCount:    meds.filter(m => m.expiry && m.expiry < td).length,
      pendingApts:     apts.filter(a => a.status === 'pending' && a.date >= td).length,
      unreadMessages:  msgs.filter(m => !m.read).length,
    };
  }

  return {
    init, syncFromFirebase, syncFromFirebaseInBackground, setupUserScopedListeners, generatePatientId, makeId, pushAndReport, pushAndReportDetailed, pushBatchAndReport, pushBatchAndReportDetailed, withTimeout, flushOutbox, outboxCount, getLastSyncAt,
    // Inspecteur de synchronisation (chantier "workflows mobile/desktop",
    // sections 1-2) : getOutboxEntries/getOutboxSummary sont des
    // instantanés en LECTURE SEULE (js/settings.js, js/sync-badge.js) —
    // jamais utilisés pour décider quoi que ce soit côté métier.
    getOutboxEntries, getOutboxSummary, classifyOutboxError,
    // Chantier v2.9.34 (P0 outbox) : rejeu manuel ciblé (seule voie de
    // rejeu d'une entrée 'blocked'), suppression manuelle confirmée,
    // export de diagnostic expurgé.
    retryOutboxOperation, retryBlockedOutbox, removeOutboxOperation, exportOutboxDiagnostic,
    // pushCloud/deleteCloud : wrappers publics sur _push/_delete, à
    // utiliser par tout module (access_control.js, hospitals_registry.js,
    // affiliation-cleanup.js...) au lieu de réimplémenter un mini-push
    // Firestore local avec .catch(() => {}) qui avale les échecs en
    // silence. Ici, tout échec est loggé ET mis en file d'attente pour
    // rejeu automatique (voir _push ci-dessus).
    pushCloud: _push, deleteCloud: _delete, roleCollection,
    getAccounts, saveAccounts, getUsers, saveUsers, upsertUserProfile,
    getRegistrationRequests, saveRegistrationRequests, createRegistrationRequest,
    getPatients, savePatients, addPatient, addPatientAndConfirm, buildPatientRecord, buildPatientDirectoryEntry, addPatientAndConfirmAtomic, updatePatient, deletePatient, getPatientById, searchPatients,
    accountExistsForPatient, getPatientAccessCode,
    getConsultations, addConsultation, getPatientConsultations, deleteConsultation,
    getPrescriptions, addPrescription, updatePrescription, updatePrescriptionAndConfirm, getPatientPrescriptions,
    getEstablishmentDocuments, addEstablishmentDocument, getPatientEstablishmentDocuments,
    getAppointments, addAppointment, updateAppointment, deleteAppointment, getPatientAppointments,
    getVaccinations, addVaccination, getPatientVaccinations, deleteVaccination,
    getAllLabResults, addLabResult, getPatientLabResults, deleteLabResult,
    getAllAdmissions, addAdmissionRecord, updateAdmissionRecord, getPatientAdmissions,
    getAllEmergencyCases, addEmergencyCaseRecord, updateEmergencyCaseRecord, getPatientEmergencyCases,
    getAllMaternityCases, addMaternityCaseRecord, updateMaternityCaseRecord, getPatientMaternityCases,
    getMedicines, addMedicine, updateMedicine, deleteMedicine,
    getSales, addSale,
    getMessages, saveMessages,
    getSettings, saveSettings,
    getStats,
  };
})();

window.DB = DB;
