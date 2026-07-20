/* =====================================================
   MedConnect 2.0 — HospitalDesktopUI (bundle desktop, adapté)
   Tableau de bord hôpital : ÉCRAN PLEIN ÉCRAN SÉPARÉ.

   DÉCISION D'ARCHITECTURE (validée) : ce shell ne s'imbrique
   PAS dans #main-content (sa sidebar entrerait en conflit
   visuel avec celle de App.buildNav()). Il se monte comme un
   overlay plein écran au-dessus du shell existant, avec :
   - sa propre sidebar (menu filtré par HospitalPermissions) ;
   - sa propre topbar (établissement, rôle, retour explicite) ;
   - un bouton « Retour à l'application » qui démonte l'overlay
     sans toucher à l'état du shell principal.

   Routes desktop natives : dashboard, beds, lab, ai, subscription,
   patients, records, reception, emergency, maternity, consultations,
   prescriptions, settings, pharmacy, doctors — TOUTES les entrées du
   menu (HospitalPermissions.visibleMenuFor) sont rendues nativement
   dans #hospital-content. APP_SECTIONS (délégation à l'app mobile) ne
   sert plus qu'au mode hybride réel : un utilisateur mobile connecté
   qui ouvre EN PLUS l'espace hôpital depuis la sidebar principale
   (voir open(), par opposition à openForSession() — la session
   HospitalAuth pure). Correctif (audit) : fermer hospital-desktop-root
   pour appeler App.navigateTo() ne faisait RIEN de visible en session
   HospitalAuth pure, l'app-layout mobile restant caché
   (display:none) — d'où les sections "qui ne s'affichent pas".

   Lanceur : auto-installé dans la sidebar principale,
   uniquement sur desktop (produit sous abonnement) et pour
   le personnel (jamais pour les patients).
   ===================================================== */
const HospitalDesktopUI = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const ROOT_ID = 'hospital-desktop-root';
  const STAFF_ROLES = ['admin', 'doctor', 'nurse', 'pharmacist'];
  // Routes rendues nativement dans le shell desktop — TOUTES les
  // entrées possibles du menu (voir HospitalPermissions.visibleMenuFor)
  // ont un renderer ici, jamais un retour silencieux (voir navigate()).
  const NATIVE_ROUTES = {
    dashboard:     (c) => renderDashboard(c),
    beds:          (c) => HospitalBedsModule.render(c),
    lab:           (c) => HospitalLabModule.render(c),
    ai:            (c) => MedicalAIModule.render(c),
    subscription:  (c) => HospitalSubscriptionModule.render(c),
    patients:      (c) => renderPatientsByYear(c),
    records:       (c) => window.MedicalRecordDesktop?.render(c),
    reception:     (c) => HospitalReceptionModule.render(c),
    emergency:     (c) => HospitalEmergencyModule.render(c),
    maternity:     (c) => HospitalMaternityModule.render(c),
    consultations: (c) => window.HospitalPortal?.renderConsultations?.(c),
    prescriptions: (c) => window.HospitalPortal?.renderPrescriptions?.(c),
    settings:      (c) => window.Settings?.render?.(c),
    pharmacy:      (c) => window.PharmacyPortal?.renderInto?.(c, 'dashboard'),
    doctors:       (c) => renderAffiliatedStaff(c),
    messages:      (c) => window.HospitalMessagesModule?.render?.(c),
  };
  // Mode hybride réel uniquement (voir open(), pas openForSession()) :
  // un utilisateur mobile qui ouvre EN PLUS l'espace hôpital retrouve
  // ces sections dans l'app mobile plutôt que de les dupliquer ici.
  // Vide par défaut désormais que toutes les routes ont un équivalent
  // natif — conservé pour extension future si besoin.
  const APP_SECTIONS = {};

  let _current = 'dashboard';
  let _sessionRole = null;

  function isOpen() { return !!document.getElementById(ROOT_ID); }

  // Correctif (retour utilisateur) : openForSession()/open() ouvraient
  // TOUJOURS sur navigate('dashboard'), quel que soit le rôle — un
  // réceptionniste ou un laborantin atterrissait donc sur le même
  // "Tableau de bord" générique (vue d'ensemble hôpital) qu'un médecin,
  // avec des raccourcis ("Admissions", "Laboratoire") qu'il n'a pas
  // forcément le droit d'utiliser. Les rôles à usage unique (réception,
  // laboratoire, pharmacie) atterrissent désormais directement sur LEUR
  // module ; les rôles à vue d'ensemble (médecin, infirmier(ère),
  // admin_hospital, admin) continuent d'atterrir sur le Tableau de bord.
  const DEFAULT_ROUTE_BY_ROLE = {
    reception:  'reception',
    lab:        'lab',
    pharmacist: 'pharmacy',
  };
  function defaultRouteFor(role) {
    return DEFAULT_ROUTE_BY_ROLE[role] || 'dashboard';
  }

  /* Ouverture depuis une session HOSPITALIÈRE (connexion desktop par
     matricule). Le rôle vient de la session hôpital, pas d'un compte
     mobile — c'est l'entrée normale du produit desktop.

     Correctif (audit) : revérifie systématiquement la cohérence de la
     session (Firebase Auth confirmé + affiliation toujours valide)
     AVANT d'ouvrir quoi que ce soit — y compris juste après un login
     réussi (coût négligeable, protection uniforme) — pour ne jamais
     rouvrir un tableau de bord sur la seule foi du cache local. */
  async function openForSession(session) {
    try {
      if (!session?.establishmentId) { HospitalAuth?.renderScreen?.(); return; }

      const consistent = window.HospitalAuth?.isSessionConsistent
        ? await window.HospitalAuth.isSessionConsistent(session)
        : false;
      if (!consistent) {
        await window.HospitalAuth?.invalidateSession?.();
        window.HospitalAuth?.renderScreen?.();
        return;
      }

      // Identité RÉELLE de l'agent connecté — jamais un id synthétique
      // 'hospital_'+establishmentId (audit : "identité affichée"). La
      // session hôpital ne fournit plus que le contexte établissement/rôle.
      const fbUser = (typeof firebaseAuth !== 'undefined' && firebaseAuth) ? firebaseAuth.currentUser : null;
      const authUser = window.Auth?.getUser?.();
      _sessionRole = session.role || 'reception';
      const hospital = window.HospitalsRegistry?.getHospitalById?.(session.establishmentId)
        || { establishmentId: session.establishmentId, name: session.establishmentName, officialId: session.officialId };
      const agent = {
        uid: authUser?.uid || fbUser?.uid || session.agentUid,
        role: _sessionRole,
        name: authUser?.name || session.agentName || roleName(_sessionRole),
        professionalNumber: authUser?.professionalNumber || session.professionalNumber || '',
      };

      if (isOpen()) { navigate(_current); return; }
      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.innerHTML = buildShell(agent, hospital);
      document.body.appendChild(root);
      document.body.classList.add('hospital-desktop-open');
      startInactivityWatch();
      refreshMessagesBadge();
      navigate(defaultRouteFor(agent.role));
    } catch (e) {
      console.error('[HospitalDesktopUI] openForSession :', e);
      App.toast(e.message || "Impossible d'ouvrir l'espace hôpital.", 'error');
    }
  }

  /* ── Verrou d'inactivité (poste hospitalier partagé) ──
     Réinitialisé à chaque interaction ; jamais déclenché s'il existe
     une écriture encore en file (DB.outboxCount() > 0) — on ne coupe
     jamais une session pendant une écriture médicale en cours. Durée
     documentée dans HospitalAuth.INACTIVITY_TIMEOUT_MS. */
  let _inactivityTimer = null;
  let _lastActivityAt = Date.now();
  const INACTIVITY_CHECK_INTERVAL_MS = 30 * 1000;

  function _markActivity() { _lastActivityAt = Date.now(); }

  function startInactivityWatch() {
    if (_inactivityTimer) return;
    ['click', 'keydown', 'pointerdown'].forEach(evt =>
      document.addEventListener(evt, _markActivity, { passive: true }));
    _lastActivityAt = Date.now();
    _inactivityTimer = setInterval(() => {
      if (!isOpen()) { stopInactivityWatch(); return; }
      const timeout = window.HospitalAuth?.INACTIVITY_TIMEOUT_MS || (30 * 60 * 1000);
      if ((Date.now() - _lastActivityAt) < timeout) return;
      const pendingWrites = window.DB?.outboxCount?.() || 0;
      if (pendingWrites > 0) return; // écriture médicale en cours : on réessaiera au prochain contrôle
      stopInactivityWatch();
      App.toast?.('🔒 Session verrouillée après inactivité — reconnectez-vous.', 'warning');
      logoutSession();
    }, INACTIVITY_CHECK_INTERVAL_MS);
  }

  function stopInactivityWatch() {
    if (_inactivityTimer) { clearInterval(_inactivityTimer); _inactivityTimer = null; }
    ['click', 'keydown', 'pointerdown'].forEach(evt =>
      document.removeEventListener(evt, _markActivity));
  }

  function roleName(role) {
    return ({ admin_hospital:'Administration', doctor:'Médecin', nurse:'Infirmier(e)',
      lab:'Laboratoire', reception:'Réception', pharmacist:'Pharmacie' })[role] || 'Agent';
  }

  function open() {
    try {
      const user = window.Auth?.getUser?.();
      if (!user || !STAFF_ROLES.includes(user.role)) {
        App.toast('Espace réservé au personnel hospitalier.', 'error');
        return;
      }
      const hospital = window.HospitalsRegistry?.getCurrentHospital?.();
      if (!hospital) {
        App.toast('Sélectionnez d\'abord un établissement actif.', 'error');
        return;
      }
      // Correctif (audit) : contrairement à openForSession(), _sessionRole
      // n'était jamais initialisé sur ce chemin (lanceur mobile hybride)
      // — HospitalCapabilities.can/require(_sessionRole, ...) évaluait
      // alors toujours contre null, cassant silencieusement (ex. bouton
      // "🚑 Transférer avec le dossier") pour un utilisateur pourtant
      // habilité selon son rôle réel.
      _sessionRole = user.role;
      if (isOpen()) { navigate(_current); return; }

      const root = document.createElement('div');
      root.id = ROOT_ID;
      root.innerHTML = buildShell(user, hospital);
      document.body.appendChild(root);
      document.body.classList.add('hospital-desktop-open');
      refreshMessagesBadge();
      navigate(defaultRouteFor(user.role));
    } catch (e) {
      console.error('[HospitalDesktopUI] open :', e);
      App.toast(e.message || 'Impossible d\'ouvrir l\'espace hôpital.', 'error');
    }
  }

  function close() {
    stopInactivityWatch();
    document.getElementById(ROOT_ID)?.remove();
    document.body.classList.remove('hospital-desktop-open');
  }

  function buildShell(user, hospital) {
    const menu = HospitalPermissions.visibleMenuFor(user.role);
    const isHospitalSession = !!window.HospitalAuth?.getSession?.();
    const accessLevel = window.HospitalCapabilities?.accessLevel?.(user.role) || 'Accès limité';
    return `
      <aside class="hospital-sidebar">
        <div class="hospital-sidebar-brand">
          <span>🏥</span>
          <div>
            <strong>${esc(hospital.name || 'Établissement')}</strong>
            <small>${hospital.officialId ? 'Matricule ' + esc(hospital.officialId) : 'Espace hôpital — Desktop'}</small>
          </div>
        </div>
        <nav class="hospital-sidebar-nav">
          ${menu.map(m => `
            <button class="hospital-nav-item" data-route="${esc(m.key)}"
              onclick="HospitalDesktopUI.navigate('${esc(m.key)}')">
              <span>${m.icon}</span> ${esc(m.label)}
              ${m.key === 'messages' ? '<span id="hd-msg-badge" class="badge-dot" style="display:none;margin-left:.4rem"></span>' : ''}
            </button>`).join('')}
        </nav>
        <button class="hospital-sidebar-exit" onclick="${isHospitalSession ? 'HospitalDesktopUI.logoutSession()' : 'HospitalDesktopUI.close()'}">
          ${isHospitalSession ? '🔓 Déconnexion' : '← ' + esc(window.I18n?.t ? I18n.t('hd_back_to_app') : "Retour à l'application")}
        </button>
      </aside>
      <div class="hospital-main">
        <header class="hospital-topbar">
          <div id="hospital-topbar-title">Tableau de bord</div>
          <div class="hospital-topbar-user">
            <strong>${esc(user.name || 'Agent')}</strong> · ${esc(HospitalPermissions.roleLabel(user.role))} · <span style="opacity:.7">${esc(accessLevel)}</span>
          </div>
        </header>
        <div class="hospital-content" id="hospital-content"></div>
      </div>
    `;
  }

  // Correctif (audit "workflows mobile/desktop", section 10) : bug
  // confirmé — aucun indicateur de messages non lus n'existait côté
  // shell desktop (contrairement au mobile, App.buildNav) : un agent ne
  // savait jamais qu'un message l'attendait sans ouvrir "Messagerie" par
  // réflexe. Network.getUnread(role) réutilise EXACTEMENT le même
  // comptage (par destinataire réel, pas juste par rôle) que le badge
  // mobile — appelé par Network.refreshUnreadIndicators() après chaque
  // notify()/markRead()/markUnread() confirmé ou mis en file.
  function refreshMessagesBadge() {
    const badge = document.getElementById('hd-msg-badge');
    if (!badge) return;
    const user = window.Auth?.getUser?.();
    const role = user?.role || _sessionRole;
    const count = (role && window.Network?.getUnread) ? Network.getUnread(role) : 0;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  async function navigate(route) {
    if (!isOpen()) return;

    // Mode hybride réel uniquement (voir open()) : sections encore
    // déléguées à l'app mobile. Vide en session HospitalAuth pure.
    if (APP_SECTIONS[route]) {
      close();
      App.navigateTo(APP_SECTIONS[route]);
      return;
    }

    _current = route;
    document.querySelectorAll('.hospital-nav-item').forEach(el =>
      el.classList.toggle('active', el.dataset.route === route));

    const menu = HospitalPermissions.visibleMenuFor(HospitalPermissions.getCurrentRole());
    const entry = menu.find(m => m.key === route);
    const titleEl = document.getElementById('hospital-topbar-title');
    if (titleEl) titleEl.textContent = entry?.label || 'Tableau de bord';

    const content = document.getElementById('hospital-content');
    content.innerHTML = '<div class="loading">⏳</div>';

    const renderer = NATIVE_ROUTES[route];
    if (!renderer) {
      // Correctif (audit) : un retour silencieux laissait l'écran
      // précédent affiché sans aucun indice qu'un clic venait d'échouer
      // ("aucun bouton du menu ne reste sans réaction"). Le shell
      // desktop reste toujours visible, avec une erreur explicite.
      console.error(`[HospitalDesktopUI] Aucun renderer pour la route "${route}"`);
      content.innerHTML = `<div class="card empty-state"><p>⚠️ Section « ${esc(entry?.label || route)} » indisponible pour le moment.</p></div>`;
      return;
    }

    try {
      await renderer(content);
    } catch (e) {
      console.error(`[HospitalDesktopUI] route ${route} :`, e);
      content.innerHTML = `<div class="card empty-state"><p>${esc(e.message || 'Erreur de chargement.')}</p></div>`;
    }
  }

  /* ── Tableau de bord ────────────────────────────── */

  async function renderDashboard(container) {
    HospitalPermissions.requireRoute('dashboard');
    const hospital = await CloudDB.getActiveHospital();
    const hospitalId = hospital.establishmentId || hospital.id;

    container.innerHTML = `<div class="card empty-state"><p>Chargement…</p></div>`;

    let beds = [], admissions = [], labRequests = [];
    let sub = { status: 'active' };
    try {
      [beds, admissions, labRequests, sub] = await Promise.all([
        CloudDB.listByHospital('beds', hospitalId),
        CloudDB.listByHospital('admissions', hospitalId),
        CloudDB.listByHospital('labRequests', hospitalId),
        ExchangeBridge.getSubscriptionStatus(hospitalId).catch(() => ({ status: 'active' })),
      ]);
    } catch (e) {
      console.warn('[HospitalDesktopUI] dashboard :', e);
    }

    const occupied = beds.filter(b => b.status === 'occupied').length;
    const admitted = admissions.filter(a => a.status === 'admitted').length;
    const labPending = labRequests.filter(o => o.status !== 'completed').length;
    const subLabels = { active:'✅ Actif', grace_period:'⏳ Grâce', expired:'❌ Expiré', suspended:'⛔ Suspendu' };

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>${esc(hospital.name || 'Établissement')}</h1>
        <p>Vue d'ensemble de l'activité hospitalière</p></div>
      </div>

      <div class="hospital-stats-grid">
        <div class="hospital-stat-card"><h3>${beds.length}</h3><p>🛏️ Lits (${occupied} occupés)</p></div>
        <div class="hospital-stat-card"><h3>${admitted}</h3><p>👥 Patients hospitalisés</p></div>
        <div class="hospital-stat-card"><h3>${labPending}</h3><p>🧪 Analyses en attente</p></div>
        <div class="hospital-stat-card"><h3>${subLabels[sub.status] || esc(sub.status)}</h3><p>💳 Abonnement</p></div>
      </div>

      <div class="card">
        <h3>Accès rapides</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem">
          ${HospitalCapabilities.can(HospitalPermissions.getCurrentRole(), 'create_patient') ? `
          <button class="btn btn-primary btn-sm" onclick="HospitalPortal.openNewPatient?.()">+ Nouveau patient</button>` : ''}
          ${(() => {
            // Correctif (audit "workflows mobile/desktop", section 13) :
            // ces raccourcis restaient affichés à TOUS les rôles atteignant
            // le tableau de bord (ROUTES.dashboard inclut lab/reception/
            // pharmacist), même quand la route ciblée leur est fermée
            // (ROUTES.beds/lab/patients) — navigate() refusait proprement
            // (jamais un faux succès) mais le clic n'aboutissait jamais à
            // rien d'utile pour ces rôles. Masqués désormais selon
            // l'accès réel à la route, pas seulement au tableau de bord.
            const role = HospitalPermissions.getCurrentRole();
            const items = [];
            if (HospitalPermissions.canAccess(role, 'beds'))
              items.push(`<button class="btn btn-primary btn-sm" onclick="HospitalDesktopUI.navigate('beds')">🛏️ Admissions</button>`);
            if (HospitalPermissions.canAccess(role, 'lab'))
              items.push(`<button class="btn btn-primary btn-sm" onclick="HospitalDesktopUI.navigate('lab')">🧪 Laboratoire</button>`);
            if (HospitalPermissions.canAccess(role, 'patients'))
              items.push(`<button class="btn btn-ghost btn-sm" onclick="HospitalDesktopUI.navigate('patients')">👥 Patients (application)</button>`);
            return items.join('');
          })()}
        </div>
      </div>
    `;
  }

  /* ── Lanceur (desktop + personnel uniquement) ───── */

  function installLauncher() {
    // Produit desktop : jamais proposé sur mobile/PWA, jamais aux patients.
    if (window.ExchangeBridge?.currentSourceDevice?.() !== 'desktop') return;

    const tryInstall = () => {
      if (document.getElementById('hospital-desktop-launcher')) return;
      const user = window.Auth?.getUser?.();
      if (!user || !STAFF_ROLES.includes(user.role)) return;
      const sidebar = document.getElementById('sidebar');
      if (!sidebar) return;

      const btn = document.createElement('button');
      btn.id = 'hospital-desktop-launcher';
      btn.className = 'hospital-desktop-launcher';
      btn.innerHTML = '🏥 Espace hôpital <small>Desktop</small>';
      btn.onclick = () => open();
      sidebar.appendChild(btn);
    };

    window.addEventListener('DOMContentLoaded', () => setTimeout(tryInstall, 800));
    // La sidebar est reconstruite à chaque login/changement de langue :
    // on revérifie périodiquement à faible coût.
    setInterval(tryInstall, 3000);
  }

  installLauncher();

  /* Déclenche un transfert — MAIS seulement si le rôle en session a
     la capacité 'decide_transfer'. Contrôle au MOMENT de l'action
     (pas juste à l'affichage) : masquer un bouton ne suffit pas. */
  function requestTransfer(patientId) {
    if (!HospitalCapabilities.require(HospitalPermissions.getCurrentRole(), 'decide_transfer')) return;
    window.HospitalPortal?.openEmergencyTransfer?.(patientId);
  }

  function logoutSession() {
    close();
    window.HospitalAuth?.logout?.();
  }

  /* Placeholder honnête pour les sections encore à construire. */
  /* Patients classés par ANNÉE, chacun prêt à être transféré avec son
     dossier (bouton 🚑 relié au module de transfert d'urgence). */
  function renderPatientsByYear(container) {
    // Correctif (audit) : cette route n'était protégée qu'au niveau du
    // menu filtré (HospitalPermissions.visibleMenuFor) — aucune
    // vérification réelle au moment du rendu, contrairement aux autres
    // modules du bundle (hospital-lab.js, hospital-reception.js, etc.).
    HospitalPermissions.requireRoute('patients');
    const hospital = window.HospitalsRegistry?.getCurrentHospital?.();
    const hid = hospital?.establishmentId;
    let patients = [];
    try {
      patients = (window.HospitalsRegistry?.getPatientsForEstablishment?.(hid)) || window.DB?.getPatients?.() || [];
    } catch (_) { patients = window.DB?.getPatients?.() || []; }

    // Regroupement par année (à partir de created_at, ou de l'année du n° MC).
    const byYear = {};
    patients.forEach(p => {
      const y = String(p.created_at || '').slice(0,4) ||
                (String(p.id||'').match(/MC-(\d{4})/)?.[1]) || 'Sans date';
      (byYear[y] = byYear[y] || []).push(p);
    });
    const years = Object.keys(byYear).sort((a,b) => b.localeCompare(a));

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>👥 Patients — dossiers par année</h1><p>${patients.length} dossier(s) · classés par année</p></div>
        ${HospitalCapabilities.can(HospitalPermissions.getCurrentRole(), 'create_patient') ? `
        <button type="button" class="btn btn-primary btn-sm" id="patients-new-btn"
          onclick="HospitalPortal.openNewPatient?.()">+ Nouveau patient</button>` : ''}
      </div>
      ${!years.length ? `<div class="card empty-state"><p>Aucun patient enregistré.</p></div>` :
        years.map(y => `
          <div class="card">
            <h3>📁 ${esc(y)} <span class="muted">(${byYear[y].length})</span></h3>
            <div class="records-list">
              ${byYear[y].map(p => `
                <div class="record-card">
                  <p><strong>${esc(p.firstname||'')} ${esc(p.lastname||'')}</strong>
                     <span class="id-tag">${esc(p.id||'')}</span></p>
                  <p class="muted">${esc(p.gender||'')}${p.birthdate ? ' · né(e) le '+esc(p.birthdate) : ''}</p>
                  <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem">
                    <button class="btn btn-ghost btn-sm" onclick="HospitalPortal.openDetail?.('${esc(p.id)}')">📋 Dossier</button>
                    ${HospitalCapabilities.can(HospitalPermissions.getCurrentRole(), 'decide_transfer') ? `
                    <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
                      onclick="HospitalDesktopUI.requestTransfer('${esc(p.id)}')">🚑 Transférer avec le dossier</button>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`).join('')}
    `;
  }

  /* ── Écran « Médecins affiliés » (route 'doctors') ──
     Correctif (audit) : cette route renvoyait vers
     HospitalsRegistry.renderManagePage() (registre "Mes établissements"
     de l'app MOBILE, jamais atteignable en session desktop pure), qui
     de plus affichait — pour un simple médecin — le registre global de
     TOUS les établissements de la plateforme (renderAdminPage, réservé
     en principe à l'administrateur plateforme). Ce nouvel écran lit
     UNIQUEMENT le personnel de l'établissement ACTIF, et réserve les
     actions administratives (approuver une affiliation, retirer un
     membre) à admin/admin_hospital. */
  async function renderAffiliatedStaff(container) {
    // Correctif (audit) : même défaut que renderPatientsByYear ci-dessus
    // — aucune vérification réelle de route au moment du rendu.
    HospitalPermissions.requireRoute('doctors');
    const hospital = await CloudDB.getActiveHospital();
    const hospitalId = hospital.establishmentId || hospital.id;
    const role = HospitalPermissions.getCurrentRole();
    const isAdminHere = ['admin', 'admin_hospital'].includes(role);

    const staff = (Array.isArray(hospital.staff) ? hospital.staff : [])
      .filter(s => s.status === 'active' || s.status === 'approved');
    // Correctif (chantier sécurité, section 9) : le listener global
    // affiliation_requests (js/db.js setupRealtimeListeners) ne peut
    // jamais alimenter le cache local d'un admin_hospital — une requête
    // Firestore non filtrée dont la seule branche de règle viable dépend
    // de resource.data (belongsToSameEstablishment) est refusée en bloc
    // pour ce rôle. On rafraîchit donc ici, à la demande, via une
    // requête CIBLÉE (CloudDB.listByHospital, déjà filtrée par
    // établissement) avant de lire le cache local.
    if (isAdminHere) {
      await window.HospitalsRegistry?.refreshAffiliationsForHospital?.(hospitalId);
    }
    const pending = isAdminHere ? (window.HospitalsRegistry?.getPendingAffiliations?.(hospitalId) || []) : [];

    container.innerHTML = `
      <div class="hospital-page-header">
        <div><h1>👨‍⚕️ Médecins affiliés</h1><p>${esc(hospital.name || 'Établissement')} · ${staff.length} membre(s) actif(s)</p></div>
      </div>

      ${isAdminHere && pending.length ? `
      <div class="card">
        <h3>⏳ Demandes d'affiliation en attente (${pending.length})</h3>
        <div class="records-list">
          ${pending.map(a => `
            <div class="record-card">
              <p><strong>${esc(a.requesterName || a.requesterUid || '—')}</strong> · ${esc(HospitalPermissions.roleLabel(a.requesterRole))}</p>
              <p class="muted">N° ${esc(a.professionalNumber || '—')}</p>
              <div style="display:flex;gap:.4rem;margin-top:.4rem">
                <button class="btn btn-primary btn-sm" onclick="HospitalDesktopUI.respondAffiliationDesktop('${esc(a.requestId || a.afid || '')}', true, event)">✅ Approuver</button>
                <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="HospitalDesktopUI.respondAffiliationDesktop('${esc(a.requestId || a.afid || '')}', false, event)">❌ Refuser</button>
              </div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="card">
        <h3>Personnel affilié</h3>
        ${!staff.length ? `<p class="muted">Aucun membre affilié pour le moment.</p>` : `
        <div class="records-list">
          ${staff.map(s => `
            <div class="record-card">
              <p><strong>${esc(s.name || s.uid || '—')}</strong> · ${esc(HospitalPermissions.roleLabel(s.role))}</p>
              <p class="muted">N° ${esc(s.professionalNumber || '—')} · Statut : ${esc(s.status || '—')}</p>
              ${isAdminHere ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger);margin-top:.4rem" onclick="HospitalDesktopUI.removeAffiliatedStaff('${esc(hospitalId)}', '${esc(s.uid)}')">🗑️ Retirer l'affiliation</button>` : ''}
            </div>`).join('')}
        </div>`}
      </div>
    `;
  }

  /* Wrappers desktop autour de HospitalsRegistry (dont le rafraîchissement
     interne cible #main-content, invisible ici) : rejouent l'action puis
     réaffichent explicitement 'doctors' dans le container desktop réel. */
  async function respondAffiliationDesktop(requestId, approved, event) {
    // Correctif (chantier sécurité) : respondAffiliation() renvoie
    // désormais {ok, ...} sur TOUS les chemins — on l'attend et on ne
    // navigue (faux succès) que si ok === true ; en cas d'échec (ex.
    // permission Firestore refusée), le message d'erreur reste visible
    // et l'écran des demandes en attente n'est pas quitté.
    const result = await window.HospitalsRegistry?.respondAffiliation?.(requestId, approved, event);
    if (result?.ok === true) {
      await navigate('doctors');
    }
    return result;
  }
  function removeAffiliatedStaff(establishmentId, uid) {
    window.HospitalsRegistry?.removeStaff?.(establishmentId, uid);
    navigate('doctors');
  }

  return {
    open, openForSession, close, navigate, isOpen, logoutSession, requestTransfer,
    respondAffiliationDesktop, removeAffiliatedStaff, refreshMessagesBadge,
  };
})();

/* Helper de navigation partagé (desktop + mobile) — évite que les
   modules communs (HospitalPortal, PharmacyPortal, HospitalsRegistry...)
   appellent toujours App.navigateTo(), qui suppose que l'app-layout
   mobile est visible et initialisé (jamais le cas en session
   HospitalAuth pure desktop, voir audit "sections qui ne s'affichent
   pas"). Route vers le shell desktop s'il est ouvert, sinon vers l'app
   mobile comme avant — comportement inchangé hors contexte desktop. */
function navigateMedConnect(section) {
  if (window.HospitalDesktopUI?.isOpen?.()) {
    return HospitalDesktopUI.navigate(section);
  }
  return window.App?.navigateTo?.(section);
}
window.navigateMedConnect = navigateMedConnect;

window.HospitalDesktopUI = HospitalDesktopUI;
