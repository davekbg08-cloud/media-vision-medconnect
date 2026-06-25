/* =====================================================
   MedConnect — Prescription Flow Fix
   Objectif : après enregistrement/envoi, afficher directement Ordonnances
   ===================================================== */
(function () {
  function patchPrescriptionFlow() {
    if (!window.HospitalPortal || HospitalPortal.__prescriptionFlowFixApplied) return false;

    const originalConfirm = HospitalPortal.confirmPrescriptionTarget?.bind(HospitalPortal);
    if (!originalConfirm) return false;

    HospitalPortal.confirmPrescriptionTarget = function (pid) {
      const target = document.getElementById('rx-target')?.value || 'patient';

      try {
        if (window.Network?.sendPrescriptionToPharmacy) {
          Network.sendPrescriptionToPharmacy(pid, target);
        } else if (originalConfirm) {
          originalConfirm(pid);
        }
      } catch (e) {
        console.warn('[MedConnect] Envoi ordonnance :', e);
      }

      window.App?.closeModal?.();
      window.App?.toast?.('✅ Ordonnance enregistrée');
      window.App?.navigateTo?.('prescriptions');
      return true;
    };

    HospitalPortal.__prescriptionFlowFixApplied = true;
    return true;
  }

  function start() {
    if (patchPrescriptionFlow()) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (patchPrescriptionFlow() || attempts > 50) clearInterval(timer);
    }, 100);
  }

  start();
})();
