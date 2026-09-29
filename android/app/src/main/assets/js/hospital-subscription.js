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
      price: 250,
      description: 'Petit centre médical',
      features: ['Patients', 'Consultations', 'Ordonnances', 'Lits simples'],
    },
    pro: {
      name: 'Pro',
      price: 500,
      description: 'Clinique ou hôpital moyen',
      features: ['Laboratoire', 'Pharmacie', 'Statistiques', 'IA médicale'],
    },
    institution: {
      name: 'Institution',
      price: 800,
      description: 'Grand hôpital',
      features: ['Multi-services', 'Quotas avancés', 'Support prioritaire'],
    },
  };

  const STATUS_LABELS = {
    active: '✅ Actif',
    grace_period: '⏳ Période de grâce',
    trial: '🎁 Essai gratuit',
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

    const mobileMoney = await isMobileMoneyOpen();
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
            <p class="plan-price"><strong>${plan.price} $</strong> / mois</p>
            <p>${esc(plan.description)}</p>
            <ul>${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
            ${!isAdmin && mobileMoney ? `
            <button class="btn btn-primary btn-full"
              onclick="HospitalSubscriptionModule.openPayment('${key}')">
              Payer par Mobile Money
            </button>` : ''}
            <button class="btn ${!isAdmin && mobileMoney ? 'btn-ghost' : 'btn-primary'} btn-full"
              onclick="HospitalSubscriptionModule.selectPlan('${key}')">
              ${isAdmin ? 'Activer' : 'Demander ce plan'}
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ── Paiement Mobile Money (pawaPay) ───────────────────────
     Ouvert selon appConfig/payments.pawapayMode : « live » pour tous,
     « sandbox » pour les administrateurs et comptes testeurs. Le serveur
     revérifie tout (membre de l'établissement, prix de la formule). */
  const PROVIDERS = [
    ['VODACOM_MPESA_COD', 'M-Pesa'],
    ['AIRTEL_COD', 'Airtel Money'],
    ['ORANGE_COD', 'Orange Money'],
  ];

  async function isMobileMoneyOpen() {
    try {
      const snap = await firebaseDB.collection('appConfig').doc('payments').get();
      const cfg = snap.data() || {};
      if (cfg.pawapayMode === 'live') return true;
      if (cfg.pawapayMode !== 'sandbox') return false;
      const uid = firebase.auth().currentUser?.uid;
      const testers = Array.isArray(cfg.pawapayTesterUids) ? cfg.pawapayTesterUids : [];
      return CloudDB.hasRole('admin') || (!!uid && testers.includes(uid));
    } catch (_) {
      return false;
    }
  }

  function openPayment(plan) {
    const info = PLANS[plan];
    if (!info) return;
    App.openModal(`Abonnement ${esc(info.name)} — ${info.price} $ / mois`, `
      <p class="muted" style="margin-bottom:.75rem">
        Vous recevrez une demande de paiement sur votre téléphone : validez-la
        avec votre code PIN. L'abonnement s'active automatiquement pour 30 jours.
      </p>
      <div class="form-group">
        <label class="inp-lbl" for="sub-pay-provider">Opérateur</label>
        <select id="sub-pay-provider" class="inp">
          ${PROVIDERS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="inp-lbl" for="sub-pay-phone">Numéro Mobile Money</label>
        <input id="sub-pay-phone" class="inp" type="tel" placeholder="+243 8xx xxx xxx">
      </div>
      <div id="sub-pay-status" class="muted" style="margin:.6rem 0;display:none"></div>
      <button id="sub-pay-btn" class="btn btn-primary btn-full"
        onclick="HospitalSubscriptionModule.submitPayment('${plan}')">Payer ${info.price} $</button>
    `);
  }

  const FUNCTIONS_BASE = 'https://europe-west1-medconnect-e81ba.cloudfunctions.net';

  async function callFunction(name, data) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('Session expirée : reconnectez-vous.');
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    };
    try {
      const ac = firebase.appCheck ? await firebase.appCheck().getToken(false) : null;
      if (ac?.token) headers['X-Firebase-AppCheck'] = ac.token;
    } catch (_) { /* App Check indisponible : le serveur tranchera */ }
    const response = await fetch(`${FUNCTIONS_BASE}/${name}`, {
      method: 'POST', headers, body: JSON.stringify({ data }),
    });
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok || body?.error) {
      throw new Error(body?.error?.message || `Service de paiement indisponible (${response.status}).`);
    }
    return { data: body?.result ?? body?.data ?? null };
  }

  async function submitPayment(plan) {
    const btn = document.getElementById('sub-pay-btn');
    const statusEl = document.getElementById('sub-pay-status');
    const show = (text) => { if (statusEl) { statusEl.style.display = ''; statusEl.textContent = text; } };
    const phone = document.getElementById('sub-pay-phone')?.value || '';
    const provider = document.getElementById('sub-pay-provider')?.value || '';
    if (!phone.trim()) { show('Saisissez votre numéro Mobile Money.'); return; }
    try {
      if (btn) btn.disabled = true;
      const hospitalId = await CloudDB.getActiveHospitalId();
      if (!hospitalId) throw new Error('Aucun établissement actif sélectionné.');
      try { await window.waitForAppCheckToken?.(8000); } catch (_) {}
      // Appel HTTP direct des fonctions « callable » (même protocole que
      // le SDK) : le SDK compat tentait d'enregistrer le service worker de
      // Firebase Messaging à la racine du domaine (404 sur GitHub Pages),
      // ce qui faisait échouer le paiement avant même l'appel.
      const fns = { httpsCallable: (name) => (data) => callFunction(name, data) };
      show('Envoi de la demande de paiement…');
      const start = await fns.httpsCallable('startSubscriptionPayment')({ hospitalId, plan, phoneNumber: phone, provider });
      const depositId = start?.data?.depositId;
      show('Validez le paiement sur votre téléphone avec votre code PIN…');
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await fns.httpsCallable('checkSubscriptionPayment')({ depositId });
        const st = res?.data?.status;
        if (st === 'paid') {
          ExchangeBridge.invalidateSubscriptionCache?.(hospitalId);
          App.closeModal();
          App.toast('Paiement reçu : abonnement activé.');
          HospitalDesktopUI.navigate('subscription');
          return;
        }
        if (st === 'failed') throw new Error(res?.data?.message || 'Paiement refusé ou annulé.');
      }
      show("Pas encore de confirmation. Si vous avez validé, l'abonnement s'activera automatiquement.");
    } catch (e) {
      console.error('[Subscription] paiement :', e);
      show(e.message || 'Paiement impossible. Réessayez.');
    } finally {
      if (btn) btn.disabled = false;
    }
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

  return { render, selectPlan, canCreateNewData, openPayment, submitPayment };
})();

window.HospitalSubscriptionModule = HospitalSubscriptionModule;
