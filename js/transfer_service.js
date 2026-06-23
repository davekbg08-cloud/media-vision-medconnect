/* =====================================================
   MedConnect — TransferService central (standalone)
   -----------------------------------------------------
   Objectif : préparer un système unique pour tout ce qui
   peut être transféré : messages, ordonnances, analyses,
   rendez-vous, documents médicaux, etc.

   IMPORTANT : ce fichier est volontairement isolé.
   - Ne modifie aucun module existant.
   - Ne supprime rien.
   - Ne change aucun comportement tant qu'il n'est pas appelé.
   - Compatible avec DB / Auth / Firebase si disponibles.
   ===================================================== */
(function () {
  'use strict';

  const STORAGE_KEY = 'mc_transfers';
  const EVENT_KEY = 'mc_transfer_events';
  const VERSION = '1.0.0-standalone';

  const OBJECT_TYPES = Object.freeze({
    MESSAGE: 'message',
    PRESCRIPTION: 'prescription',
    LAB_RESULT: 'lab_result',
    APPOINTMENT: 'appointment',
    MEDICAL_RECORD: 'medical_record',
    CONSULTATION: 'consultation',
    VACCINATION: 'vaccination',
    DOCUMENT: 'document',
    OTHER: 'other',
  });

  const STATUSES = Object.freeze({
    DRAFT: 'draft',
    SENT: 'sent',
    RECEIVED: 'received',
    READ: 'read',
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  });

  const PRIORITIES = Object.freeze({
    NORMAL: 'normal',
    URGENT: 'urgent',
  });

  const VALID_ROLES = Object.freeze(['patient', 'doctor', 'pharmacist', 'nurse', 'admin']);

  function now() {
    return new Date().toISOString();
  }

  function today() {
    return now().slice(0, 10);
  }

  function safeJson(value, fallback) {
    try { return JSON.parse(value || 'null') ?? fallback; }
    catch (_) { return fallback; }
  }

  function load(key, fallback) {
    try { return safeJson(localStorage.getItem(key), fallback); }
    catch (_) { return fallback; }
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) {}
  }

  function makeId(prefix) {
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}${Date.now()}${rnd}`;
  }

  function normalizeRole(role) {
    const r = String(role || '').trim().toLowerCase();
    if (r === 'pharmacy') return 'pharmacist';
    if (r === 'medecin' || r === 'médecin') return 'doctor';
    if (r === 'infirmier' || r === 'infirmiere' || r === 'infirmière') return 'nurse';
    return r;
  }

  function isValidRole(role) {
    return VALID_ROLES.includes(normalizeRole(role));
  }

  function getCurrentUser() {
    try { return window.Auth?.getUser?.() || null; }
    catch (_) { return null; }
  }

  function getCurrentUserRef() {
    const user = getCurrentUser() || {};
    return {
      uid: user.uid || user.patient_id || user.username || user.order_num || user.matricule || '',
      role: normalizeRole(user.role || 'system'),
      name: user.name || user.fullname || user.firstname || user.username || 'MedConnect',
      raw: user,
    };
  }

  function patientName(patient) {
    if (!patient) return '';
    return `${patient.firstname || patient.prenom || ''} ${patient.lastname || patient.nom || ''}`.trim() || patient.name || patient.id || '';
  }

  function accountDisplayName(account) {
    if (!account) return '';
    return account.pharmacy || account.name || account.fullname || account.username || account.uid || account.matricule || account.order_num || '';
  }

  function recipientKeys(user) {
    if (!user) return [];
    return [
      user.uid,
      user.patient_id,
      user.patientId,
      user.username,
      user.order_num,
      user.matricule,
      user.id,
    ].filter(Boolean).map(String);
  }

  function normalizeRecipient(input) {
    const role = normalizeRole(input?.role || input?.toRole || input?.to_role);
    const uid = String(input?.uid || input?.toUid || input?.to_id || input?.id || '').trim();
    const name = String(input?.name || input?.toName || input?.label || '').trim();

    return {
      role,
      uid,
      name,
      isBroadcast: !!input?.isBroadcast || uid === '*',
      raw: input || null,
    };
  }

  function getTransfers() {
    return load(STORAGE_KEY, []);
  }

  function saveTransfers(list) {
    store(STORAGE_KEY, Array.isArray(list) ? list : []);
  }

  function getEvents() {
    return load(EVENT_KEY, []);
  }

  function saveEvents(list) {
    store(EVENT_KEY, Array.isArray(list) ? list : []);
  }

  function addEvent(transferId, action, data) {
    const actor = getCurrentUserRef();
    const events = getEvents();
    const event = {
      eventId: makeId('TE'),
      transferId,
      action: String(action || 'event'),
      actorUid: actor.uid,
      actorRole: actor.role,
      actorName: actor.name,
      data: data || {},
      createdAt: now(),
    };
    events.push(event);
    saveEvents(events);
    pushFirestore('mc_transfer_events', event.eventId, event);
    return event;
  }

  function pushFirestore(collection, docId, data) {
    try {
      if (!window.firebaseReady || !window.firebaseDB || !collection || !docId) return;
      window.firebaseDB.collection(collection).doc(String(docId)).set(data, { merge: true });
    } catch (_) {}
  }

  function persistTransfer(transfer) {
    const list = getTransfers();
    const idx = list.findIndex(item => item.transferId === transfer.transferId);
    if (idx === -1) list.push(transfer);
    else list[idx] = { ...list[idx], ...transfer, transferId: transfer.transferId };
    saveTransfers(list);

    pushFirestore('mc_transfers', transfer.transferId, transfer);
    pushFirestore('transfers', transfer.transferId, transfer);
    return transfer;
  }

  function validateCreateInput(payload, recipient, sender) {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, message: 'Payload transfert invalide.' };
    }
    if (!payload.objectType) {
      return { ok: false, message: 'objectType obligatoire.' };
    }
    if (!payload.objectId) {
      return { ok: false, message: 'objectId obligatoire.' };
    }
    if (!isValidRole(recipient.role)) {
      return { ok: false, message: 'Rôle destinataire invalide.' };
    }
    if (!recipient.uid && !recipient.isBroadcast) {
      return { ok: false, message: 'Destinataire précis obligatoire.' };
    }
    if (recipient.isBroadcast && sender.role !== 'admin' && !payload.allowBroadcast) {
      return { ok: false, message: 'Envoi global refusé : destinataire précis requis.' };
    }
    return { ok: true };
  }

  function createTransfer(payload) {
    const sender = getCurrentUserRef();
    const recipient = normalizeRecipient(payload?.recipient || payload || {});
    const validation = validateCreateInput(payload, recipient, sender);
    if (!validation.ok) throw new Error(validation.message);

    const createdAt = now();
    const transfer = {
      transferId: payload.transferId || makeId('TR'),
      version: VERSION,

      objectType: String(payload.objectType || OBJECT_TYPES.OTHER),
      objectId: String(payload.objectId),
      objectCode: payload.objectCode || payload.code || '',
      objectTitle: payload.objectTitle || payload.title || payload.subject || '',
      objectSummary: payload.objectSummary || payload.summary || '',

      patientId: payload.patientId || payload.patient_id || payload.patientUid || '',
      patientName: payload.patientName || '',

      fromUid: payload.fromUid || sender.uid,
      fromRole: normalizeRole(payload.fromRole || sender.role),
      fromName: payload.fromName || sender.name,

      toRole: recipient.role,
      toUid: recipient.isBroadcast ? '*' : recipient.uid,
      toName: recipient.isBroadcast ? 'Tous les utilisateurs du rôle' : recipient.name,
      toIsBroadcast: recipient.isBroadcast,

      status: payload.status || STATUSES.SENT,
      priority: payload.priority === PRIORITIES.URGENT ? PRIORITIES.URGENT : PRIORITIES.NORMAL,

      metadata: payload.metadata || {},
      createdAt,
      updatedAt: createdAt,
      sentAt: payload.sentAt || createdAt,
      receivedAt: null,
      readAt: null,
      completedAt: null,
      cancelledAt: null,
    };

    persistTransfer(transfer);
    addEvent(transfer.transferId, 'created', { status: transfer.status, toUid: transfer.toUid, toRole: transfer.toRole });
    return transfer;
  }

  function updateTransferStatus(transferId, status, extra) {
    const nextStatus = String(status || '').trim();
    if (!nextStatus) throw new Error('Statut obligatoire.');

    const list = getTransfers();
    const idx = list.findIndex(item => item.transferId === transferId);
    if (idx === -1) throw new Error('Transfert introuvable.');

    const patch = {
      ...(extra || {}),
      status: nextStatus,
      updatedAt: now(),
    };

    if (nextStatus === STATUSES.RECEIVED && !list[idx].receivedAt) patch.receivedAt = now();
    if (nextStatus === STATUSES.READ && !list[idx].readAt) patch.readAt = now();
    if (nextStatus === STATUSES.COMPLETED && !list[idx].completedAt) patch.completedAt = now();
    if (nextStatus === STATUSES.CANCELLED && !list[idx].cancelledAt) patch.cancelledAt = now();

    const transfer = { ...list[idx], ...patch };
    list[idx] = transfer;
    saveTransfers(list);
    pushFirestore('mc_transfers', transfer.transferId, transfer);
    pushFirestore('transfers', transfer.transferId, transfer);
    addEvent(transfer.transferId, 'status_changed', { status: nextStatus, extra: extra || {} });
    return transfer;
  }

  function markReceived(transferId) {
    return updateTransferStatus(transferId, STATUSES.RECEIVED);
  }

  function markRead(transferId) {
    return updateTransferStatus(transferId, STATUSES.READ);
  }

  function completeTransfer(transferId, extra) {
    return updateTransferStatus(transferId, STATUSES.COMPLETED, extra);
  }

  function cancelTransfer(transferId, reason) {
    return updateTransferStatus(transferId, STATUSES.CANCELLED, { cancelReason: reason || '' });
  }

  function matchesRecipient(transfer, user) {
    if (!transfer || !user) return false;
    const role = normalizeRole(user.role);
    if (transfer.toRole !== role) return false;
    if (transfer.toIsBroadcast || transfer.toUid === '*') return true;
    return recipientKeys(user).includes(String(transfer.toUid || ''));
  }

  function getInboxForUser(user) {
    return getTransfers()
      .filter(transfer => matchesRecipient(transfer, user))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function getInboxForCurrentUser() {
    return getInboxForUser(getCurrentUser());
  }

  function getOutboxForUser(user) {
    const keys = recipientKeys(user || getCurrentUser());
    return getTransfers()
      .filter(transfer => keys.includes(String(transfer.fromUid || '')))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  function getByObject(objectType, objectId) {
    return getTransfers().filter(transfer =>
      transfer.objectType === objectType && String(transfer.objectId) === String(objectId)
    );
  }

  function listRecipients(role, query) {
    const r = normalizeRole(role);
    const q = String(query || '').trim().toLowerCase();
    let list = [];

    if (r === 'patient') {
      list = window.DB?.getPatients?.() || [];
      return list
        .map(patient => ({
          role: 'patient',
          uid: patient.id || patient.uid || patient.patient_id || '',
          name: patientName(patient),
          label: `${patientName(patient)}${patient.id ? ' — ' + patient.id : ''}`,
          raw: patient,
        }))
        .filter(item => !q || `${item.uid} ${item.name} ${item.label}`.toLowerCase().includes(q));
    }

    list = [
      ...(window.DB?.getAccounts?.() || []),
      ...(window.DB?.getUsers?.() || []),
    ];

    const seen = new Set();
    return list
      .filter(account => normalizeRole(account.role) === r)
      .filter(account => ['approved', 'active', undefined, null, ''].includes(account.status))
      .map(account => ({
        role: r,
        uid: account.uid || account.username || account.order_num || account.matricule || '',
        name: accountDisplayName(account),
        label: accountDisplayName(account),
        raw: account,
      }))
      .filter(item => item.uid && !seen.has(item.uid) && seen.add(item.uid))
      .filter(item => !q || `${item.uid} ${item.name} ${item.label}`.toLowerCase().includes(q));
  }

  function createNotificationPayload(transfer, overrides) {
    return {
      to_role: transfer.toRole,
      to_id: transfer.toUid,
      toUid: transfer.toUid,
      toName: transfer.toName,
      type: transfer.objectType,
      priority: transfer.priority,
      subject: overrides?.subject || transfer.objectTitle || `Transfert ${transfer.objectType}`,
      body: overrides?.body || transfer.objectSummary || `Un élément ${transfer.objectType} vous a été transféré.`,
      transferId: transfer.transferId,
      objectType: transfer.objectType,
      objectId: transfer.objectId,
    };
  }

  function createNotificationForTransfer(transferIdOrObject, overrides) {
    const transfer = typeof transferIdOrObject === 'string'
      ? getTransfers().find(item => item.transferId === transferIdOrObject)
      : transferIdOrObject;

    if (!transfer) throw new Error('Transfert introuvable pour notification.');
    const payload = createNotificationPayload(transfer, overrides || {});

    if (window.Network?.notify) {
      window.Network.notify(payload);
      addEvent(transfer.transferId, 'notification_created', { via: 'Network.notify' });
      return payload;
    }

    const messages = window.DB?.getMessages?.();
    if (Array.isArray(messages) && window.DB?.saveMessages) {
      const msg = {
        mid: makeId('N'),
        ...payload,
        fromUid: transfer.fromUid,
        fromRole: transfer.fromRole,
        from: transfer.fromName,
        date: today(),
        createdAt: now(),
        read: false,
        readStatus: 'unread',
      };
      messages.push(msg);
      window.DB.saveMessages(messages);
      addEvent(transfer.transferId, 'notification_created', { via: 'DB.saveMessages' });
      return msg;
    }

    addEvent(transfer.transferId, 'notification_skipped', { reason: 'No Network.notify or DB.saveMessages available' });
    return payload;
  }

  function transferObject(payload) {
    return createTransfer(payload);
  }

  function transferPrescription(prescription, recipient, options) {
    if (!prescription) throw new Error('Ordonnance obligatoire.');
    return createTransfer({
      objectType: OBJECT_TYPES.PRESCRIPTION,
      objectId: prescription.pid || prescription.code || prescription.id,
      objectCode: prescription.code || prescription.pid || '',
      objectTitle: options?.title || 'Ordonnance transférée',
      objectSummary: options?.summary || `Ordonnance du ${prescription.date || today()}`,
      patientId: prescription.patient_id || prescription.patientId || '',
      patientName: options?.patientName || '',
      recipient,
      priority: options?.priority || PRIORITIES.NORMAL,
      metadata: {
        doctorUid: prescription.doctor_uid || prescription.created_by || '',
        doctorName: prescription.doctor || prescription.docteur || '',
        pharmacyUid: prescription.pharmacyUid || '',
        source: 'transferPrescription',
        ...(options?.metadata || {}),
      },
    });
  }

  window.TransferService = Object.freeze({
    VERSION,
    OBJECT_TYPES,
    STATUSES,
    PRIORITIES,

    transferObject,
    createTransfer,
    persistTransfer,
    updateTransferStatus,
    markReceived,
    markRead,
    completeTransfer,
    cancelTransfer,

    getTransfers,
    getEvents,
    getInboxForUser,
    getInboxForCurrentUser,
    getOutboxForUser,
    getByObject,
    matchesRecipient,
    recipientKeys,

    listRecipients,
    normalizeRole,
    normalizeRecipient,

    createNotificationPayload,
    createNotificationForTransfer,
    transferPrescription,
  });
})();
