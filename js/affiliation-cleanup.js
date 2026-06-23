/* =====================================================
   MedConnect 2.0 — Nettoyage demandes d'affiliation
   -----------------------------------------------------
   Objectif limité : retirer les demandes orphelines
   quand le compte médecin/infirmier n'existe plus, et
   sécuriser les boutons Approuver / Refuser.
   ===================================================== */
(function () {
  const KEYS = ['affiliation_requests', 'mc_affiliations'];
  const CLEANUP_REASON = 'missing_requester_account';

  function readList(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (_) { return []; }
  }

  function writeList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); }
    catch (_) {}
  }

  function requestId(req) {
    return req?.requestId || req?.afid || '';
  }

  function normalizedRequest(req) {
    const id = requestId(req) || `AFF${Date.now()}`;
    return {
      ...req,
      requestId: id,
      afid: id,
      requesterUid: req?.requesterUid || req?.doctor_uid || req?.uid || '',
      requesterRole: String(req?.requesterRole || req?.role || '').toLowerCase(),
      professionalNumber: req?.professionalNumber || req?.order_num || req?.matricule || '',
      status: req?.status || 'pending',
    };
  }

  function allRequests() {
    const map = new Map();
    KEYS.flatMap(readList).map(normalizedRequest).forEach(req => {
      const id = requestId(req);
      if (!id) return;
      map.set(id, { ...(map.get(id) || {}), ...req });
    });
    return [...map.values()];
  }

  function allAccounts() {
    const accounts = window.DB?.getAccounts?.() || [];
    const users = window.DB?.getUsers?.() || [];
    return [...accounts, ...users];
  }

  function requesterExists(req) {
    const r = normalizedRequest(req);
    const uid = String(r.requesterUid || '');
    const role = String(r.requesterRole || '').toLowerCase();
    const number = String(r.professionalNumber || '').toUpperCase();

    const account = allAccounts().find(item => {
      const itemUid = String(item?.uid || item?.authUid || '');
      const itemRole = String(item?.role || '').toLowerCase();
      const itemNumber = String(item?.order_num || item?.matricule || item?.username || '').toUpperCase();
      return (uid && itemUid === uid) || (role && number && itemRole === role && itemNumber === number);
    });

    if (!account) return false;
    const status = String(account.status || 'active').toLowerCase();
    return !['deleted', 'removed', 'rejected', 'suspended'].includes(status);
  }

  function isOrphanPending(req) {
    const r = normalizedRequest(req);
    return r.status === 'pending' && ['doctor', 'nurse'].includes(r.requesterRole) && !requesterExists(r);
  }

  function isCleanupMarked(req) {
    return req?.cleanupReason === CLEANUP_REASON || req?.status === 'orphan_removed';
  }

  function markCloudRemoved(req) {
    if (!(typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseDB !== 'undefined' && firebaseDB)) return;
    const r = normalizedRequest(req);
    const id = requestId(r);
    if (!id) return;
    const cleaned = {
      ...r,
      status: 'orphan_removed',
      cleanupReason: CLEANUP_REASON,
      updatedAt: new Date().toISOString(),
      decided_at: new Date().toISOString(),
    };
    firebaseDB.collection('affiliation_requests').doc(id).set(cleaned, { merge: true }).catch(() => {});
    firebaseDB.collection('mc_affiliations').doc(id).set(cleaned, { merge: true }).catch(() => {});
  }

  function cleanOrphanRequests() {
    let changed = false;
    const keep = [];

    allRequests().forEach(req => {
      if (isCleanupMarked(req) || isOrphanPending(req)) {
        changed = true;
        markCloudRemoved(req);
        return;
      }
      keep.push(req);
    });

    if (changed) KEYS.forEach(key => writeList(key, keep));
    return changed;
  }

  function patchHospitalsRegistry() {
    if (!window.HospitalsRegistry || HospitalsRegistry.__affiliationCleanupPatchApplied) return false;

    const originalRenderManagePage = HospitalsRegistry.renderManagePage?.bind(HospitalsRegistry);
    const originalRespondAffiliation = HospitalsRegistry.respondAffiliation?.bind(HospitalsRegistry);
    const originalGetAffiliations = HospitalsRegistry.getAffiliations?.bind(HospitalsRegistry);

    HospitalsRegistry.getAffiliations = function () {
      cleanOrphanRequests();
      return originalGetAffiliations?.() || [];
    };

    HospitalsRegistry.respondAffiliation = function (requestId, approved) {
      const req = (originalGetAffiliations?.() || []).find(item => item.requestId === requestId || item.afid === requestId);
      if (req && isOrphanPending(req)) {
        cleanOrphanRequests();
        window.App?.toast?.('🧹 Demande nettoyée : le compte demandeur n’existe plus.', 'success');
        originalRenderManagePage?.(document.getElementById('main-content'), 'requests');
        return;
      }
      return originalRespondAffiliation?.(requestId, approved);
    };

    HospitalsRegistry.renderManagePage = function (main, tab = 'list') {
      cleanOrphanRequests();
      return originalRenderManagePage?.(main, tab);
    };

    HospitalsRegistry.__affiliationCleanupPatchApplied = true;
    cleanOrphanRequests();
    return true;
  }

  function start() {
    if (patchHospitalsRegistry()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (patchHospitalsRegistry() || attempts > 50) clearInterval(timer);
    }, 100);
  }

  start();
  window.addEventListener('DOMContentLoaded', () => setTimeout(cleanOrphanRequests, 1200));
})();
