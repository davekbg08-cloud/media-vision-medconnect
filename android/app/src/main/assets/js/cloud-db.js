/* =====================================================
   MedConnect 2.0 — CloudDB (bundle desktop, adapté)
   Couche d'accès Firestore commune aux modules hôpital
   desktop (lits, laboratoire, IA, abonnement).

   ADAPTATIONS vs bundle d'origine :
   - S'appuie sur le firebaseDB global de firebase-config.js
     (pas de seconde initialisation Firebase) ;
   - Identité : Auth.getUser() (numéro professionnel / rôle
     du projet : doctor/nurse/pharmacist/admin/patient) ;
   - Établissement actif : HospitalsRegistry.getCurrentHospital()
     (champ canonique `establishmentId`, alias `hospitalId`
     accepté par resolveHospitalId() côté règles) ;
   - Abonnement : délégué à ExchangeBridge.canWriteForHospital()
     (source de vérité : subscriptions/{hospitalId}) — PAS de
     second système parallèle lisant hospital.subscriptionStatus ;
   - sourceDevice injecté automatiquement sur chaque création
     (les règles hospitalCanWriteFromDevice() en dépendent).
   ===================================================== */
const CloudDB = (() => {

  function now() { return new Date().toISOString(); }

  function db() {
    if (typeof firebaseDB === 'undefined' || !firebaseDB) {
      throw new Error('Cloud non initialisé — vérifiez votre connexion.');
    }
    return firebaseDB;
  }

  function cleanId(id) {
    return String(id || '').replace(/[\/\s]+/g, '_').trim();
  }

  function requireAuth() {
    const user = window.Auth?.getUser?.();
    if (!user || !user.uid) {
      throw new Error('Session expirée — reconnectez-vous.');
    }
    return user;
  }

  /* ── Identité & établissement actif ─────────────── */

  async function getCurrentUserProfile() {
    return requireAuth();
  }

  async function getActiveHospitalId() {
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    return h?.establishmentId || h?.id || null;
  }

  async function getActiveHospital() {
    const h = window.HospitalsRegistry?.getCurrentHospital?.();
    if (!h) throw new Error('Aucun établissement actif sélectionné.');
    return h;
  }

  /**
   * Membership dérivée des affiliations approuvées du projet
   * (pas de collection hospitalMembers parallèle).
   */
  async function getMyMembership() {
    const user = requireAuth();
    const hospitalId = await getActiveHospitalId();
    const affs = window.HospitalsRegistry?.getAffiliations?.() || [];
    const mine = affs.find(a =>
      a.requesterUid === user.uid &&
      a.establishmentId === hospitalId &&
      a.status === 'approved'
    );
    return {
      uid: user.uid,
      role: user.role || mine?.requesterRole || '',
      establishmentId: hospitalId,
      approved: !!mine || user.role === 'admin',
    };
  }

  function hasRole(...roles) {
    const role = window.Auth?.getUser?.()?.role || '';
    return roles.includes(role);
  }

  function requireRole(...roles) {
    if (!hasRole(...roles)) {
      throw new Error("Vous n'avez pas l'autorisation d'effectuer cette action.");
    }
    return true;
  }

  /* ── Abonnement (délégué à ExchangeBridge) ──────── */

  async function subscriptionAllowsWrite(actionType) {
    const hospitalId = await getActiveHospitalId();
    if (!window.ExchangeBridge?.canWriteForHospital) return { allowed: true, warning: null };
    return window.ExchangeBridge.canWriteForHospital(hospitalId, actionType);
  }

  async function requireWritableSubscription(actionType) {
    const gate = await subscriptionAllowsWrite(actionType);
    if (gate.warning) window.App?.toast?.(gate.warning, 'warning');
    if (!gate.allowed) {
      throw new Error(gate.message ||
        "Votre abonnement a expiré. La lecture reste disponible, mais les nouvelles actions sont bloquées jusqu'au renouvellement.");
    }
    return true;
  }

  /* ── CRUD ───────────────────────────────────────── */

  async function createDoc(collection, data, customId = null) {
    requireAuth();
    const payload = {
      ...data,
      // Injecté automatiquement : hospitalCanWriteFromDevice() côté
      // règles Firestore en dépend pour appliquer la distinction
      // desktop/mobile. Ne pas dépendre de chaque appelant pour s'en
      // souvenir individuellement (piège déjà rencontré et corrigé
      // au cas par cas la session précédente sur emergency-transfer.js).
      sourceDevice: data.sourceDevice || window.ExchangeBridge?.currentSourceDevice?.() || 'desktop',
      createdAt: data.createdAt || now(),
      updatedAt: now(),
    };

    if (customId) {
      await db().collection(collection).doc(cleanId(customId)).set(payload, { merge: true });
      return { id: cleanId(customId), ...payload };
    }
    const ref = await db().collection(collection).add(payload);
    return { id: ref.id, ...payload };
  }

  async function updateDoc(collection, id, data) {
    requireAuth();
    await db().collection(collection).doc(cleanId(id)).update({ ...data, updatedAt: now() });
    return { id: cleanId(id), ...data };
  }

  async function deleteDoc(collection, id) {
    requireAuth();
    await db().collection(collection).doc(cleanId(id)).delete();
    return true;
  }

  async function getDoc(collection, id) {
    const snap = await db().collection(collection).doc(cleanId(id)).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  /**
   * Liste les documents d'un établissement. Interroge le champ
   * canonique `establishmentId` ; fallback `hospitalId` pour les
   * documents plus anciens (dérive de schéma réelle du projet,
   * cf. resolveHospitalId() dans firestore.rules).
   */
  async function listByHospital(collection, hospitalId, { limit = 200 } = {}) {
    const hid = hospitalId || await getActiveHospitalId();
    if (!hid) return [];
    const results = new Map();
    for (const field of ['establishmentId', 'hospitalId']) {
      try {
        const snap = await db().collection(collection)
          .where(field, '==', hid).limit(limit).get();
        snap.forEach(d => results.set(d.id, { id: d.id, ...d.data() }));
      } catch (e) {
        console.warn(`[CloudDB] listByHospital(${collection}) champ ${field} :`, e);
      }
    }
    return Array.from(results.values());
  }

  function listenByHospital(collection, hospitalId, callback) {
    return db().collection(collection)
      .where('establishmentId', '==', hospitalId)
      .onSnapshot(
        snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => console.error(`[CloudDB] listen ${collection} :`, err)
      );
  }

  /* ── Audit & notifications ──────────────────────── */

  async function createAuditLog(action, targetType, targetId, metadata = {}) {
    const user = requireAuth();
    const hospitalId = metadata.establishmentId || metadata.hospitalId ||
      (window.HospitalsRegistry?.getCurrentHospital?.()?.establishmentId) || null;
    if (!hospitalId) return null;

    return createDoc('auditLogs', {
      establishmentId: hospitalId,
      hospitalId, // alias — resolveHospitalId() côté règles accepte les deux
      userId: user.uid,
      role: user.role || '',
      action, targetType, targetId, metadata,
      createdAt: now(),
    });
  }

  /**
   * Journal d'accès pour une cible donnée (ex: targetType='patient').
   * Filtre côté serveur par établissement (comme listByHospital),
   * puis par targetId côté client (peu de volume par patient).
   */
  async function listAuditLogForTarget(targetType, targetId, hospitalId) {
    const logs = await listByHospital('auditLogs', hospitalId);
    return logs
      .filter(l => l.targetType === targetType && l.targetId === targetId)
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
  }

  async function createNotification(data) {
    return createDoc('notifications', {
      establishmentId: data.establishmentId || data.hospitalId,
      hospitalId: data.establishmentId || data.hospitalId,
      toUid: data.recipientUserId || data.toUid,
      recipientUserId: data.recipientUserId || data.toUid,
      type: data.type || 'info',
      title: data.title || 'Notification',
      message: data.message || '',
      targetType: data.targetType || '',
      targetId: data.targetId || '',
      readStatus: 'unread',
      read: false,
      createdAt: now(),
    });
  }

  return {
    createDoc, updateDoc, deleteDoc, getDoc, listByHospital, listenByHospital,
    getCurrentUserProfile, getActiveHospitalId, getActiveHospital, getMyMembership,
    hasRole, requireRole, subscriptionAllowsWrite, requireWritableSubscription,
    createAuditLog, listAuditLogForTarget, createNotification,
  };
})();

window.CloudDB = CloudDB;
