/* =====================================================
   MedConnect — Partage sécurisé de dossier médical
   Brouillon officiel à intégrer plus tard
   ===================================================== */

const MedicalRecordSharing = (() => {
  const SHARE_COLLECTION = 'medical_record_shares';

  function nowIso() {
    return new Date().toISOString();
  }

  function makeShareId() {
    return `SHARE_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function createShareRequest({
    patientId,
    fromHospitalId,
    toHospitalId,
    requestedByUid,
    requestedByName,
    reason,
    durationDays = 30,
    allowedSections = ['summary', 'allergies', 'consultations', 'lab_results', 'prescriptions'],
  }) {
    if (!patientId || !fromHospitalId || !toHospitalId || !requestedByUid) {
      throw new Error('Informations de partage incomplètes.');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(durationDays || 30));

    const request = {
      shareId: makeShareId(),
      patientId,
      fromHospitalId,
      toHospitalId,
      requestedByUid,
      requestedByName: requestedByName || '',
      reason: reason || '',
      allowedSections,
      status: 'pending_patient_consent',
      sourceDevice: window.ExchangeBridge?.currentSourceDevice?.() || 'mobile',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      approvedAt: null,
      approvedByUid: null,
    };

    saveLocal(request);
    pushCloud(request);
    audit('share_request_created', request);

    return request;
  }

  function approveShare(shareId, approvedByUid) {
    const shares = getShares();
    const index = shares.findIndex(s => s.shareId === shareId);
    if (index === -1) return null;

    shares[index] = {
      ...shares[index],
      status: 'active',
      approvedAt: nowIso(),
      approvedByUid,
      updatedAt: nowIso(),
    };

    storeShares(shares);
    pushCloud(shares[index]);
    audit('share_request_approved', shares[index]);

    return shares[index];
  }

  function revokeShare(shareId, revokedByUid) {
    const shares = getShares();
    const index = shares.findIndex(s => s.shareId === shareId);
    if (index === -1) return null;

    shares[index] = {
      ...shares[index],
      status: 'revoked',
      revokedAt: nowIso(),
      revokedByUid,
      updatedAt: nowIso(),
    };

    storeShares(shares);
    pushCloud(shares[index]);
    audit('share_revoked', shares[index]);

    return shares[index];
  }

  function hasActiveShare({ patientId, hospitalId }) {
    const now = Date.now();

    return getShares().some(s =>
      s.patientId === patientId &&
      s.toHospitalId === hospitalId &&
      s.status === 'active' &&
      !s.revokedAt &&
      Date.parse(s.expiresAt) > now
    );
  }

  function getActiveSharesForHospital(hospitalId) {
    const now = Date.now();

    return getShares().filter(s =>
      s.toHospitalId === hospitalId &&
      s.status === 'active' &&
      !s.revokedAt &&
      Date.parse(s.expiresAt) > now
    );
  }

  function getSharesForPatient(patientId) {
    return getShares().filter(s => s.patientId === patientId);
  }

  function getShares() {
    try {
      return JSON.parse(localStorage.getItem(SHARE_COLLECTION) || '[]');
    } catch {
      return [];
    }
  }

  function storeShares(list) {
    localStorage.setItem(SHARE_COLLECTION, JSON.stringify(list || []));
  }

  function saveLocal(share) {
    const shares = getShares();
    const index = shares.findIndex(s => s.shareId === share.shareId);

    if (index === -1) shares.push(share);
    else shares[index] = share;

    storeShares(shares);
  }

  async function pushCloud(share) {
    if (typeof firebaseReady === 'undefined' || !firebaseReady || !firebaseDB) {
      console.warn('[MedConnect] Partage enregistré localement seulement.');
      return false;
    }

    await firebaseDB
      .collection(SHARE_COLLECTION)
      .doc(share.shareId)
      .set(share, { merge: true });

    return true;
  }

  function audit(action, share) {
    try {
      const entry = {
        auditId: `AUDIT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        hospitalId: share.fromHospitalId || share.toHospitalId || '',
        patientId: share.patientId,
        action,
        targetType: 'medical_record_share',
        targetId: share.shareId,
        createdAt: nowIso(),
      };

      const logs = JSON.parse(localStorage.getItem('auditLogs') || '[]');
      logs.push(entry);
      localStorage.setItem('auditLogs', JSON.stringify(logs));

      if (typeof firebaseReady !== 'undefined' && firebaseReady && firebaseDB) {
        firebaseDB.collection('auditLogs').doc(entry.auditId).set(entry);
      }
    } catch (e) {
      console.warn('[MedConnect] Audit partage échoué :', e);
    }
  }

  return {
    createShareRequest,
    approveShare,
    revokeShare,
    hasActiveShare,
    getActiveSharesForHospital,
    getSharesForPatient,
    getShares,
  };
})();

window.MedicalRecordSharing = MedicalRecordSharing;
