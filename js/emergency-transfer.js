/* =====================================================
   MedConnect — Emergency Transfer Module
   Réseau Médical Sécurisé MedConnect
   -----------------------------------------------------
   Module : transfert d’urgence + partage temporaire
   ===================================================== */

const EmergencyTransferModule = (() => {
  const TRANSFERS = 'emergencyTransfers';
  const SHARES = 'medical_record_shares';
  const AUDIT = 'auditLogs';
  const NOTIFICATIONS = 'notifications';

  const STATUSES = {
    REQUESTED: 'requested',
    ACCEPTED: 'accepted',
    IN_TRANSIT: 'in_transit',
    ARRIVED: 'arrived',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
  };

  const PRIORITIES = {
    CRITICAL: 'critical',
    VERY_URGENT: 'very_urgent',
    URGENT: 'urgent',
    NORMAL: 'normal',
  };

  const DEFAULT_SECTIONS = [
    'identity',
    'allergies',
    'chronic_conditions',
    'emergency_contact',
    'recent_consultations',
    'recent_lab_results',
    'prescriptions',
    'vaccinations',
  ];

  const nowIso = () => new Date().toISOString();

  const makeId = prefix =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const cloudReady = () =>
    typeof firebaseReady !== 'undefined' &&
    firebaseReady &&
    typeof firebaseDB !== 'undefined' &&
    firebaseDB;

  const read = key => {
    try {
      return JSON.parse(localStorage.getItem(key) || '[]');
    } catch {
      return [];
    }
  };

  const write = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value || []));
  };

  function upsertLocal(collection, idField, item) {
    const list = read(collection);
    const index = list.findIndex(x => x[idField] === item[idField]);

    if (index === -1) list.push(item);
    else list[index] = item;

    write(collection, list);
    return item;
  }

  async function pushCloud(collection, id, data) {
    if (!cloudReady()) return false;

    try {
      await firebaseDB
        .collection(collection)
        .doc(String(id))
        .set(data, { merge: true });

      return true;
    } catch (e) {
      console.warn(`[MedConnect] Cloud write failed ${collection}/${id}`, e);
      return false;
    }
  }

  function currentUser() {
    return window.Auth?.getUser?.() || {};
  }

  function currentHospital() {
    return window.HospitalsRegistry?.getCurrentHospital?.() || {};
  }

  function getPatient(patientId) {
    return window.DB?.getPatientById?.(patientId) || null;
  }

  function getConsultations(patientId) {
    return window.DB?.getPatientConsultations?.(patientId) || [];
  }

  function getLabResults(patientId) {
    return window.DB?.getPatientLabResults?.(patientId) || [];
  }

  function getPrescriptions(patientId) {
    return window.DB?.getPatientPrescriptions?.(patientId) || [];
  }

  function buildEmergencyPacket(patientId, sections = DEFAULT_SECTIONS) {
    const patient = getPatient(patientId);
    if (!patient) throw new Error('Patient introuvable.');

    const packet = {
      packetId: makeId('PACKET'),
      patientId,
      generatedAt: nowIso(),
      sections,
    };

    if (sections.includes('identity')) {
      packet.identity = {
        patientCode: patient.id,
        firstname: patient.firstname || '',
        lastname: patient.lastname || '',
        gender: patient.gender || '',
        dob: patient.dob || '',
        bloodType: patient.blood_type || '',
        phone: patient.phone || '',
      };
    }

    if (sections.includes('allergies')) {
      packet.allergies = patient.allergies || '';
    }

    if (sections.includes('chronic_conditions')) {
      packet.chronicConditions = patient.chronic || '';
    }

    if (sections.includes('emergency_contact')) {
      packet.emergencyContact = patient.emergency || '';
    }

    if (sections.includes('recent_consultations')) {
      packet.recentConsultations = getConsultations(patientId).slice(0, 5);
    }

    if (sections.includes('recent_lab_results')) {
      packet.recentLabResults = getLabResults(patientId).slice(0, 5);
    }

    if (sections.includes('prescriptions')) {
      packet.prescriptions = getPrescriptions(patientId).slice(0, 5);
    }

    return packet;
  }

  function createShare({
    transferId,
    patientId,
    fromHospitalId,
    toHospitalId,
    sections = DEFAULT_SECTIONS,
    durationHours = 24,
    reason = '',
  }) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + Number(durationHours || 24));

    const share = {
      shareId: makeId('SHARE'),
      transferId,
      patientId,
      fromHospitalId,
      toHospitalId,
      allowedSections: sections,
      reason,
      status: 'active_emergency',
      sourceDevice: window.ExchangeBridge?.currentSourceDevice?.() || 'mobile',
      accessType: 'break_glass',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    };

    upsertLocal(SHARES, 'shareId', share);
    pushCloud(SHARES, share.shareId, share);
    audit('emergency_share_created', share);

    return share;
  }

  function createNotification({
    hospitalId,
    title,
    message,
    targetType,
    targetId,
    priority = 'high',
  }) {
    const notification = {
      notificationId: makeId('NOTIF'),
      hospitalId,
      recipientHospitalId: hospitalId,
      type: 'emergency_transfer',
      title,
      message,
      targetType,
      targetId,
      priority,
      read: false,
      createdAt: nowIso(),
    };

    upsertLocal(NOTIFICATIONS, 'notificationId', notification);
    pushCloud(NOTIFICATIONS, notification.notificationId, notification);

    return notification;
  }

  function audit(action, data) {
    const user = currentUser();

    const entry = {
      auditId: makeId('AUDIT'),
      hospitalId: data.fromHospitalId || data.toHospitalId || data.hospitalId || '',
      userId: user.uid || '',
      role: user.role || '',
      action,
      targetType: data.transferId ? 'emergencyTransfer' : 'medicalRecordShare',
      targetId: data.transferId || data.shareId || '',
      patientId: data.patientId || '',
      metadata: {
        priority: data.priority || '',
        status: data.status || '',
        subscriptionBypassed: data.subscriptionBypassed === true,
      },
      createdAt: nowIso(),
    };

    upsertLocal(AUDIT, 'auditId', entry);
    pushCloud(AUDIT, entry.auditId, entry);

    return entry;
  }

  async function createEmergencyTransfer({
    patientId,
    toHospitalId,
    toHospitalName = '',
    receivingService = '',
    receivingDoctorId = '',
    priority = PRIORITIES.URGENT,
    reason,
    transportType = 'ambulance',
    estimatedArrival = '',
    sharedSections = DEFAULT_SECTIONS,
    // Contournement explicite de l'abonnement — doit être demandé
    // volontairement par l'appelant (jamais automatique), réservé aux
    // situations où le transfert ne peut littéralement pas attendre
    // le renouvellement. Toujours journalisé dans auditLogs (voir
    // subscriptionBypassed ci-dessous).
    emergencyOverride = false,
  }) {
    const user = currentUser();
    const hospital = currentHospital();
    const patient = getPatient(patientId);

    if (!patient) throw new Error('Patient introuvable.');
    if (!hospital?.establishmentId && !hospital?.hid) {
      throw new Error('Aucun hôpital actif.');
    }
    if (!toHospitalId) throw new Error('Hôpital de destination obligatoire.');
    if (!reason) throw new Error('Motif du transfert obligatoire.');

    const fromHospitalId = hospital.establishmentId || hospital.hid;

    // Abonnement (point 13 de la commande) : bloqué si expired/
    // suspended, SAUF si l'appelant a explicitement activé le mode
    // urgence. Le contournement reste journalisé pour traçabilité —
    // jamais une échappatoire silencieuse.
    let subscriptionBypassed = false;
    if (window.ExchangeBridge?.canWriteForHospital && !emergencyOverride) {
      const gate = await ExchangeBridge.canWriteForHospital(fromHospitalId, 'emergency_transfer');
      if (!gate.allowed) {
        throw new Error(gate.message || "Transfert impossible : abonnement de l'établissement expiré.");
      }
    } else if (emergencyOverride) {
      subscriptionBypassed = true;
    }

    const transferId = makeId('TRANSFER');

    const emergencyPacket = buildEmergencyPacket(patientId, sharedSections);

    const transfer = {
      transferId,
      patientId,
      patientCode: patient.id,
      patientName: `${patient.firstname || ''} ${patient.lastname || ''}`.trim(),

      fromHospitalId,
      fromHospitalName: hospital.name || '',
      toHospitalId,
      toHospitalName,

      requestingDoctorId: user.uid || '',
      requestingDoctorName: user.name || '',
      receivingDoctorId,
      receivingService,

      priority,
      reason,
      transportType,
      estimatedArrival,

      status: STATUSES.REQUESTED,
      sharedSections,
      emergencyPacket,
      subscriptionBypassed,
      sourceDevice: window.ExchangeBridge?.currentSourceDevice?.() || 'mobile',

      createdAt: nowIso(),
      updatedAt: nowIso(),
      acceptedAt: null,
      inTransitAt: null,
      arrivedAt: null,
      completedAt: null,
      cancelledAt: null,
    };

    upsertLocal(TRANSFERS, 'transferId', transfer);
    pushCloud(TRANSFERS, transferId, transfer);

    createShare({
      transferId,
      patientId,
      fromHospitalId,
      toHospitalId,
      sections: sharedSections,
      reason,
      durationHours: 24,
    });

    createNotification({
      hospitalId: toHospitalId,
      title: '🚑 Transfert d’urgence',
      message: `Patient transféré depuis ${hospital.name || 'un établissement MedConnect'} — priorité : ${priority}`,
      targetType: 'emergencyTransfer',
      targetId: transferId,
      priority: 'critical',
    });

    audit('emergency_transfer_created', transfer);

    return transfer;
  }

  function updateTransferStatus(transferId, status, extra = {}) {
    const list = read(TRANSFERS);
    const index = list.findIndex(t => t.transferId === transferId);
    if (index === -1) return null;

    const timestampField = {
      [STATUSES.ACCEPTED]: 'acceptedAt',
      [STATUSES.IN_TRANSIT]: 'inTransitAt',
      [STATUSES.ARRIVED]: 'arrivedAt',
      [STATUSES.COMPLETED]: 'completedAt',
      [STATUSES.CANCELLED]: 'cancelledAt',
    }[status];

    const next = {
      ...list[index],
      ...extra,
      status,
      updatedAt: nowIso(),
    };

    if (timestampField) next[timestampField] = nowIso();

    list[index] = next;
    write(TRANSFERS, list);
    pushCloud(TRANSFERS, transferId, next);
    audit(`emergency_transfer_${status}`, next);

    return next;
  }

  function acceptTransfer(transferId, receivingUserId = '') {
    const user = currentUser();

    const transfer = updateTransferStatus(transferId, STATUSES.ACCEPTED, {
      acceptedByUid: receivingUserId || user.uid || '',
      acceptedByName: user.name || '',
    });

    if (transfer) {
      createNotification({
        hospitalId: transfer.fromHospitalId,
        title: '✅ Transfert accepté',
        message: `${transfer.toHospitalName || 'L’hôpital destinataire'} a accepté le transfert.`,
        targetType: 'emergencyTransfer',
        targetId: transferId,
      });
    }

    return transfer;
  }

  function startTransfer(transferId) {
    return updateTransferStatus(transferId, STATUSES.IN_TRANSIT);
  }

  function markArrived(transferId) {
    return updateTransferStatus(transferId, STATUSES.ARRIVED);
  }

  function completeTransfer(transferId) {
    return updateTransferStatus(transferId, STATUSES.COMPLETED);
  }

  function cancelTransfer(transferId, reason = '') {
    return updateTransferStatus(transferId, STATUSES.CANCELLED, {
      cancelReason: reason,
    });
  }

  function hasEmergencyAccess(patientId, hospitalId) {
    const now = Date.now();

    return read(SHARES).some(share =>
      share.patientId === patientId &&
      share.toHospitalId === hospitalId &&
      share.status === 'active_emergency' &&
      !share.revokedAt &&
      Date.parse(share.expiresAt) > now
    );
  }

  function revokeEmergencyShare(shareId, revokedByUid = '') {
    const list = read(SHARES);
    const index = list.findIndex(s => s.shareId === shareId);
    if (index === -1) return null;

    list[index] = {
      ...list[index],
      status: 'revoked',
      revokedAt: nowIso(),
      revokedByUid,
      updatedAt: nowIso(),
    };

    write(SHARES, list);
    pushCloud(SHARES, shareId, list[index]);
    audit('emergency_share_revoked', list[index]);

    return list[index];
  }

  function getTransfersForHospital(hospitalId) {
    return read(TRANSFERS).filter(t =>
      t.fromHospitalId === hospitalId || t.toHospitalId === hospitalId
    );
  }

  function getIncomingTransfers(hospitalId) {
    return read(TRANSFERS).filter(t =>
      t.toHospitalId === hospitalId &&
      ![STATUSES.COMPLETED, STATUSES.CANCELLED].includes(t.status)
    );
  }

  function getOutgoingTransfers(hospitalId) {
    return read(TRANSFERS).filter(t =>
      t.fromHospitalId === hospitalId &&
      ![STATUSES.COMPLETED, STATUSES.CANCELLED].includes(t.status)
    );
  }

  return {
    STATUSES,
    PRIORITIES,
    DEFAULT_SECTIONS,

    buildEmergencyPacket,
    createEmergencyTransfer,
    acceptTransfer,
    startTransfer,
    markArrived,
    completeTransfer,
    cancelTransfer,

    hasEmergencyAccess,
    revokeEmergencyShare,

    getTransfersForHospital,
    getIncomingTransfers,
    getOutgoingTransfers,
  };
})();

window.EmergencyTransferModule = EmergencyTransferModule;
