/* =====================================================
   MedConnect 2.0 — HospitalSubscriptionModule (adapté)
   Gestion du plan hospitalier (produit desktop payant).

   ADAPTATION CRITIQUE vs bundle d'origine : les règles
   Firestore n'autorisent QUE l'admin à écrire dans
   subscriptions/{hospitalId} (source de vérité lue par
   ExchangeBridge). Le selectPlan() d'origine — écriture
   directe par l'hôpital — serait systématiquement rejeté.
   Flux adapté :
   - personnel hôpital : "Demander ce plan" → notification
     admin + journal d'audit ;
   - admin : activation directe + invalidation du cache
     d'abonnement d'ExchangeBridge.
   ===================================================== */
const HospitalSubscriptionModule = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const PLANS = {
    essentiel: {
      name: 'Essentiel',
      description: 'Petit centre médical',
      features: ['Patients', 'Consultations', 'Ordonnances', 'Lits simples'],
    },
    pro: {
      name: 'Pro',
      description: 'Clinique ou hôpital moyen',
      features: ['Laboratoire', 'Pharmacie', 'Statistiques', 'IA médicale'],
    },
    institution: {
      name: 'Institution',
      description: 'Grand hôpital',
      features: ['Multi-services', 'Quotas avancés', 'Support prioritaire'],
    },
  };

  const STATUS_LABELS = {
    active: '✅ Actif',
    grace_period: '⏳ Période de grâce',
    expired: '❌ Expiré',
    suspended: '⛔ Suspendu',
  };

  async function render(container) {
    HospitalPermissions.requireRoute('subscription');
    const hospital = await CloudDB.getActiveHospital();
    const hospitalId = hospital.establishmentId || hospital.id;
    const isAdmin = CloudDB.hasRole('admin');

    // Source de vérité : subscriptions/{hospitalId} via ExchangeBridge
    // (jamais hospital.subscriptionStatus, champ non fiable).
    let sub = { status: 'active', graceUntil: null };
    try { sub = await ExchangeBridge.getSubscriptionStatus(hospitalId); }
    catch (e) { console.warn('[Subscription] Lecture statut :', e); }

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>Abonnement</h1><p>Gestion du plan hospitalier — ${esc(hospital.name || '')}</p></div>
      </div>

      <div class="card">
        <h3>Statut actuel</h3>
        <p><strong>${STATUS_LABELS[sub.status] || esc(sub.status || 'non défini')}</strong></p>
        ${sub.graceUntil ? `<p>Grâce jusqu'au : ${esc(String(sub.graceUntil).slice(0,10))}</p>` : ''}
        <div class="alert-box" style="margin-top:.8rem">
          💳 <strong>Paiement de l'abonnement</strong><br>
          Réglez par mobile money au <strong>0856373707</strong>, puis contactez
          l'administration MedConnect. L'activation est effectuée manuellement
          après réception du paiement.
        </div>
        ${!isAdmin ? `<p class="muted">L'activation d'un plan est effectuée par l'administration MedConnect après votre paiement.</p>` : ''}
      </div>

      <div class="hospital-stats-grid">
        ${Object.entries(PLANS).map(([key, plan]) => `
          <div class="hospital-stat-card">
            <h3>${esc(plan.name)}</h3>
            <p>${esc(plan.description)}</p>
            <ul>${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            <button class="btn btn-primary btn-full"
              onclick="HospitalSubscriptionModule.selectPlan('${key}')">
              ${isAdmin ? 'Activer' : 'Demander ce plan'}
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function selectPlan(plan) {
    try {
      if (!PLANS[plan]) throw new Error('Plan inconnu.');
      const hospitalId = await CloudDB.getActiveHospitalId();
      if (!hospitalId) throw new Error('Aucun établissement actif sélectionné.');
      const user = await CloudDB.getCurrentUserProfile();

      if (CloudDB.hasRole('admin')) {
        // Admin : écriture directe autorisée par les règles.
        await CloudDB.createDoc('subscriptions', {
          hospitalId,
          establishmentId: hospitalId,
          plan,
          status: 'active',
          billingCycle: 'monthly',
          startDate: new Date().toISOString(),
          endDate: nextMonth(),
          graceUntil: '',
        }, hospitalId); // doc ID = hospitalId (contrat ExchangeBridge)

        ExchangeBridge.invalidateSubscriptionCache?.(hospitalId);
        await CloudDB.createAuditLog('subscription_plan_activated', 'subscriptions', hospitalId, { plan });
        App.toast('Abonnement activé.');
      } else {
        // Personnel hôpital : demande → notification admin + audit.
        await CloudDB.createNotification({
          hospitalId,
          type: 'subscription_request',
          title: 'Demande de plan hospitalier',
          message: `${user.name || user.uid} demande le plan « ${PLANS[plan].name} » pour l'établissement ${hospitalId}.`,
          targetType: 'subscriptions',
          targetId: hospitalId,
        });
        await CloudDB.createAuditLog('subscription_plan_requested', 'subscriptions', hospitalId, { plan });
        App.toast('Demande envoyée à l\'administration.');
      }

      HospitalDesktopUI.navigate('subscription');
    } catch (e) {
      console.error('[Subscription] selectPlan :', e);
      App.toast(e.message || 'Erreur lors de la sélection du plan.', 'error');
    }
  }

  function nextMonth() {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  }

  async function canCreateNewData() {
    const gate = await CloudDB.subscriptionAllowsWrite('create_patient');
    return gate.allowed;
  }

  return { render, selectPlan, canCreateNewData };
})();

window.HospitalSubscriptionModule = HospitalSubscriptionModule;
