/* =====================================================
   MedConnect 2.0 — Sécurité demandes d'affiliation
   -----------------------------------------------------
   Objectifs :
   - retirer les demandes orphelines médecin/infirmier ;
   - sécuriser les boutons Approuver / Refuser ;
   - empêcher l’auto-approbation par médecin/infirmier ;
   - laisser le patient hors de cette logique.
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

  function currentUser() {
    return window.Auth?.getUser?.() || null;
  }

  function isAdminUser() {
    const user = currentUser();
    return String(user?.role || '').toLowerCase() === 'admin';
  }

  function isProfessionalRole(role) {
    return ['doctor', 'nurse', 'pharmacist'].includes(String(role || '').toLowerCase());
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
      const itemNumber = String(item?.order_num || item?.matricule || item?.username || item?.professionalNumber || '').toUpperCase();
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

  // PARTIE K — délègue à DB.pushCloud (js/db.js) au lieu d'un mini-push
  // Firestore local avec .catch(() => {}) : tout échec est loggé et mis
  // en file d'attente pour rejeu automatique, jamais perdu en silence.
  function markCloudRemoved(req) {
    if (!window.DB?.pushCloud) return;
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
    window.DB.pushCloud('affiliation_requests', id, cleaned);
    window.DB.pushCloud('mc_affiliations', id, cleaned);
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

  function readHospitalForm() {
    const user = currentUser() || {};
    return {
      name: document.getElementById('h-name')?.value?.trim() || '',
      officialId: document.getElementById('h-official')?.value?.trim()?.toUpperCase() || '',
      type: document.getElementById('h-type')?.value || 'hospital',
      phone: document.getElementById('h-phone')?.value?.trim() || '',
      address: document.getElementById('h-address')?.value?.trim() || '',
      city: document.getElementById('h-city')?.value?.trim() || '',
      latitude: document.getElementById('h-lat')?.value || '',
      longitude: document.getElementById('h-lng')?.value || '',
      status: document.getElementById('h-status')?.value || 'active',
      owner_uid: 'admin_root',
      owner_role: 'admin',
      createdBy: user.uid || '',
      createdByRole: user.role || '',
    };
  }

  function patchHospitalsRegistry() {
    if (!window.HospitalsRegistry || HospitalsRegistry.__affiliationCleanupPatchApplied) return false;

    const originalRenderManagePage = HospitalsRegistry.renderManagePage?.bind(HospitalsRegistry);
    const originalRespondAffiliation = HospitalsRegistry.respondAffiliation?.bind(HospitalsRegistry);
    const originalGetAffiliations = HospitalsRegistry.getAffiliations?.bind(HospitalsRegistry);
    const originalSaveHospital = HospitalsRegistry.saveHospital?.bind(HospitalsRegistry);

    HospitalsRegistry.getAffiliations = function () {
      cleanOrphanRequests();
      return originalGetAffiliations?.() || [];
    };

    HospitalsRegistry.respondAffiliation = function (requestId, approved) {
      if (!isAdminUser()) {
        window.App?.toast?.('⛔ Seul l’administrateur peut approuver ou refuser une affiliation.', 'error');
        return false;
      }

      const req = (originalGetAffiliations?.() || []).find(item => item.requestId === requestId || item.afid === requestId);
      if (req && isOrphanPending(req)) {
        cleanOrphanRequests();
        window.App?.toast?.('🧹 Demande nettoyée : le compte demandeur n’existe plus.', 'success');
        originalRenderManagePage?.(document.getElementById('main-content'), 'requests');
        return false;
      }

      return originalRespondAffiliation?.(requestId, approved);
    };

    HospitalsRegistry.saveHospital = function (event) {
      event?.preventDefault?.();
      const user = currentUser();

      /*
        Règle métier : médecin / infirmier / pharmacien ne valident jamais
        leur propre affiliation. Ils créent l’établissement si nécessaire,
        puis une demande pending est envoyée à l’administrateur.
        Le patient n’est pas concerné par ce flux.
      */
      if (user && isProfessionalRole(user.role)) {
        const data = readHospitalForm();
        if (!data.name || !data.officialId) {
          window.App?.toast?.('⚠️ Nom et identifiant officiel obligatoires.', 'error');
          return false;
        }

        const h = HospitalsRegistry.addHospital?.(data);
        if (!h?.establishmentId) {
          window.App?.toast?.('❌ Impossible de créer l’établissement.', 'error');
          return false;
        }

        const request = HospitalsRegistry.requestAffiliation?.(user.uid, user.name, h.establishmentId, {
          requesterRole: user.role,
          silent: false,
        });

        window.App?.closeModal?.();
        window.App?.toast?.(
          request
            ? '📤 Établissement créé. Demande d’affiliation envoyée à l’administrateur.'
            : '⚠️ Établissement créé, mais une demande existe déjà ou le rôle n’est pas autorisé.',
          request ? 'success' : 'error'
        );

        const main = document.getElementById('main-content');
        if (main) HospitalsRegistry.renderManagePage?.(main, 'list');
        return request || false;
      }

      return originalSaveHospital?.(event);
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
