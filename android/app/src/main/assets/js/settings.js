/* =====================================================
   MedConnect 2.0 — Settings Module
   Devise · Langue · Thème · Confidentialité
   ===================================================== */
const Settings = (() => {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const countriesList = () => window.PatientPortal?.getCountriesList?.() || [
    { code:'CD', flag:'🇨🇩', name:'République démocratique du Congo' },
    { code:'SN', flag:'🇸🇳', name:'Sénégal' },
    { code:'CI', flag:'🇨🇮', name:'Côte d’Ivoire' },
    { code:'CM', flag:'🇨🇲', name:'Cameroun' },
    { code:'FR', flag:'🇫🇷', name:'France' },
  ];

  // Correctif (audit) : plusieurs actions internes (thème, consentements,
  // registres admin, localisation pharmacien) rappelaient en dur
  // Settings.render(document.getElementById('main-content')) — jamais
  // visible en session desktop pure (rendu dans #hospital-content, pas
  // #main-content). currentContainer mémorise le container RÉEL reçu par
  // le dernier render(), quel qu'il soit ; refresh() s'en sert pour se
  // rafraîchir sans dépendre d'un id figé.
  let currentContainer = null;

  function refresh() {
    if (currentContainer && document.body.contains(currentContainer)) {
      render(currentContainer);
    }
  }

  function render(main) {
    currentContainer = main;
    const user     = Auth.getUser();
    const settings = DB.getSettings();
    const curCode  = Currency.current();
    const curInfo  = Currency.get(curCode);

    main.innerHTML = `
      <div class="page-header"><h2>⚙️ Paramètres</h2></div>

      <!-- DEVISE -->
      <div class="settings-section">
        <h3>💱 Devise</h3>
        <p class="settings-desc">Sélectionnez la devise utilisée pour les prix en pharmacie.</p>
        <div class="settings-current">
          <span class="currency-badge">${curInfo.symbol}</span>
          <div>
            <strong>${curCode}</strong> — ${curInfo.name}
            <br><small style="color:var(--text-muted)">Devise actuelle</small>
          </div>
        </div>
        ${Currency.renderSelector(curCode)}
      </div>

      <!-- LANGUE -->
      <div class="settings-section">
        <h3>🌍 Langue</h3>
        <p class="settings-desc">Langue de l'interface. Changer relance l'application.</p>
        ${I18n.renderSelector()}
      </div>

      <!-- THÈME -->
      <div class="settings-section">
        <h3>🌓 Thème</h3>
        <p class="settings-desc">Apparence de l'application.</p>
        <div style="display:flex;gap:.75rem">
          <button class="theme-btn ${!document.body.classList.contains('light-theme')?'active':''}"
                  onclick="App.toggleTheme();Settings.refresh()">
            🌙 Sombre
          </button>
          <button class="theme-btn ${document.body.classList.contains('light-theme')?'active':''}"
                  onclick="App.toggleTheme();Settings.refresh()">
            ☀️ Clair
          </button>
        </div>
      </div>

      ${renderSyncInspectorSection()}

      ${user?.role === 'patient' ? renderPrivacySection(user) : ''}
      ${user?.role === 'pharmacist' ? renderPharmacyLocationSection(user) : ''}
      ${user?.role === 'admin'   ? renderAdminSection()       : ''}

      <!-- COMPTE -->
      <div class="settings-section">
        <h3>👤 Compte</h3>
        <div class="settings-row">
          <span>${Auth.getRoleIcon(user?.role)} ${esc(user?.name)}</span>
          <span class="role-badge role-${user?.role}">${user?.role}</span>
        </div>
        ${user?.role === 'doctor' ? `<div class="settings-row"><span>N° Ordre</span><span style="font-family:monospace;color:var(--primary)">${esc(user?.order_num||'—')}</span></div>` : ''}
        ${user?.role === 'pharmacist' ? `<div class="settings-row"><span>Matricule</span><span style="font-family:monospace;color:var(--purple)">${esc(user?.matricule||'—')}</span></div>` : ''}
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3);margin-top:.75rem;width:100%"
                onclick="Auth.logout()">🚪 Se déconnecter</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,.3);margin-top:.5rem;width:100%"
                onclick="Auth._deleteMyAccount()">🗑️ Supprimer mon compte</button>
      </div>

      ${renderAboutSection()}`;
  }

  /* ── INSPECTEUR DE SYNCHRONISATION (chantier "workflows
     mobile/desktop", sections 1-2) ──────────────────────
     Bug confirmé : le seul état visible pour l'utilisateur était un
     compte global "N en attente" (via SyncBadge/renderAboutSection),
     sans jamais distinguer une écriture transitoire (réseau, se
     corrigera seule) d'une écriture structurellement bloquée
     (permission Firestore refusée, argument invalide — ne se
     corrigera JAMAIS toute seule) : un problème de configuration
     pouvait rester invisible indéfiniment derrière un badge "en
     attente" normal. Cette section (mobile ET desktop, même
     Settings.render() container-agnostic que le reste du module)
     rend l'état réel visible et permet un rejeu manuel immédiat. */
  function _opLabel(e) {
    if (e.type === 'batch') {
      const cols = (e.writes || []).map(w => w[0]).join(' + ');
      return `Opération atomique (${cols || 'batch'})`;
    }
    return `${e.collection}/${e.docId}`;
  }

  function _opRow(e) {
    const isBlocked = e.classification === 'blocked';
    return `
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:.25rem;border-left:3px solid ${isBlocked ? 'var(--danger)' : 'var(--accent)'};padding-left:.6rem;margin-top:.5rem">
        <span style="font-size:.85rem"><strong>${isBlocked ? '⛔' : '⏳'} ${esc(_opLabel(e))}</strong></span>
        <span class="settings-desc" style="font-size:.78rem">
          ${esc(e.module || e.operationType || '—')} · ${esc(e.userRole || '—')}${e.userUid ? ` (${esc(String(e.userUid).slice(0, 12))}…)` : ''}${e.hospitalId ? ` · ${esc(e.hospitalId)}` : ''}<br>
          Mise en file : ${esc(new Date(e.queuedAt).toLocaleString('fr-FR'))} · ${e.attempts || 0} tentative(s)
          ${e.lastErrorCode ? `<br>Dernière erreur : ${esc(e.lastErrorCode)}${e.lastErrorMessage ? ` — ${esc(String(e.lastErrorMessage).slice(0, 120))}` : ''}` : ''}
        </span>
        <div style="display:flex;gap:.4rem">
          <button type="button" class="btn btn-ghost btn-xs" onclick="Settings.retrySyncOperation('${esc(e.operationId)}', event)">🔄 Réessayer</button>
          <button type="button" class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="Settings.removeSyncOperation('${esc(e.operationId)}')">🗑️ Supprimer de la file</button>
        </div>
      </div>`;
  }

  function renderSyncInspectorSection() {
    const summary = window.DB?.getOutboxSummary?.() || { total: 0, retryable: 0, blocked: 0, oldestQueuedAt: null };
    const entries = window.DB?.getOutboxEntries?.() || [];
    const blockedEntries = entries.filter(e => e.classification === 'blocked');
    const retryableEntries = entries.filter(e => e.classification !== 'blocked');

    let stateIcon, stateLabel, stateColor;
    if (summary.total === 0) {
      stateIcon = '☁️'; stateLabel = 'Tout est synchronisé'; stateColor = 'var(--secondary)';
    } else if (summary.blocked > 0) {
      stateIcon = '⚠️'; stateLabel = `${summary.blocked} écriture(s) bloquée(s), ${summary.retryable} en attente`; stateColor = 'var(--danger)';
    } else {
      stateIcon = '⏳'; stateLabel = `${summary.retryable} écriture(s) en attente de synchronisation`; stateColor = 'var(--accent)';
    }

    return `
      <div class="settings-section" id="settings-sync-inspector">
        <h3>🔄 Synchronisation</h3>
        <p class="settings-desc">Les écritures en attente normales sont rejouées automatiquement. Les écritures <strong>bloquées</strong> (ex. permission refusée) ne se résoudront pas toutes seules : elles restent conservées ici — jamais supprimées automatiquement — et ne sont rejouées que par vos actions ci-dessous.</p>
        <div class="settings-row">
          <span style="color:${stateColor}">${stateIcon} ${esc(stateLabel)}</span>
        </div>
        ${summary.oldestQueuedAt ? `<p class="settings-desc" style="margin-top:.3rem">En attente depuis : ${esc(new Date(summary.oldestQueuedAt).toLocaleString('fr-FR'))}</p>` : ''}
        ${blockedEntries.length ? `
        <div class="alert-box" style="margin-top:.6rem;text-align:left">
          <strong>⛔ Opérations bloquées (intervention nécessaire) :</strong>
          ${blockedEntries.slice(0, 10).map(_opRow).join('')}
          ${blockedEntries.length > 10 ? `<p class="settings-desc">… et ${blockedEntries.length - 10} autre(s).</p>` : ''}
        </div>` : ''}
        ${retryableEntries.length ? `
        <div style="margin-top:.6rem;text-align:left">
          <strong style="font-size:.85rem">⏳ En attente (rejeu automatique) :</strong>
          ${retryableEntries.slice(0, 10).map(_opRow).join('')}
          ${retryableEntries.length > 10 ? `<p class="settings-desc">… et ${retryableEntries.length - 10} autre(s).</p>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem">
          <button type="button" class="btn btn-ghost btn-sm" id="settings-check-sync-btn"
            onclick="Settings.checkSync()">🔄 Réessayer les opérations normales</button>
          ${blockedEntries.length ? `
          <button type="button" class="btn btn-ghost btn-sm" id="settings-check-blocked-btn" style="color:var(--danger)"
            onclick="Settings.checkBlockedSync()">⛔ Vérifier les bloquées (${blockedEntries.length})</button>` : ''}
          ${entries.length ? `
          <button type="button" class="btn btn-ghost btn-sm" onclick="Settings.exportSyncDiagnostic()">📄 Export JSON de diagnostic</button>` : ''}
        </div>
      </div>`;
  }

  /* « Réessayer les opérations normales » : rejoue immédiatement les
     entrées retryable (bypass du backoff) — flushOutbox() ne touche
     JAMAIS aux entrées bloquées (voir js/db.js, chantier v2.9.34). */
  async function checkSync() {
    const btn = document.getElementById('settings-check-sync-btn');
    if (!window.ActionFeedback?.start?.(btn, '⏳ Vérification…')) return;
    try {
      await window.DB?.flushOutbox?.({ force: true });
      const summary = window.DB?.getOutboxSummary?.() || { total: 0, retryable: 0, blocked: 0 };
      if (summary.total === 0) {
        window.ActionFeedback?.confirmed?.('☁️ Tout est synchronisé.');
      } else if (summary.blocked > 0) {
        window.ActionFeedback?.failed?.(`⚠️ ${summary.blocked} écriture(s) bloquée(s) — utilisez « Vérifier les bloquées » ou le rejeu par opération, ${summary.retryable} encore en attente normale.`);
      } else {
        window.ActionFeedback?.queued?.(`⏳ ${summary.retryable} écriture(s) encore en attente — nouvelle tentative automatique.`);
      }
    } finally {
      window.ActionFeedback?.reset?.(btn);
      refresh();
    }
  }

  /* « Vérifier les opérations bloquées » : seule voie de rejeu GROUPÉ
     des entrées bloquées (ex. après redéploiement d'une règle). */
  async function checkBlockedSync() {
    const btn = document.getElementById('settings-check-blocked-btn');
    if (!window.ActionFeedback?.start?.(btn, '⏳ Vérification…')) return;
    try {
      const r = await window.DB?.retryBlockedOutbox?.() || { attempted: 0, succeeded: 0, failed: 0 };
      if (!r.attempted) {
        window.ActionFeedback?.confirmed?.('Aucune opération bloquée à vérifier.');
      } else if (r.failed === 0) {
        window.ActionFeedback?.confirmed?.(`✅ ${r.succeeded} opération(s) bloquée(s) synchronisée(s) avec succès.`);
      } else {
        window.ActionFeedback?.failed?.(`${r.succeeded} réussie(s), ${r.failed} toujours bloquée(s) — la cause n'est pas résolue.`);
      }
    } finally {
      window.ActionFeedback?.reset?.(btn);
      refresh();
    }
  }

  /* « Réessayer cette opération » : rejeu manuel d'UNE opération,
     y compris bloquée. */
  async function retrySyncOperation(operationId, event) {
    const btn = event?.target;
    if (!window.ActionFeedback?.start?.(btn, '⏳…')) return;
    try {
      const r = await window.DB?.retryOutboxOperation?.(operationId);
      if (r?.ok) {
        window.ActionFeedback?.confirmed?.('✅ Opération synchronisée avec succès.');
      } else if (r?.reason === 'offline') {
        window.ActionFeedback?.queued?.('📡 Hors ligne — réessayez une fois connecté.');
      } else if (r?.reason === 'not_found') {
        window.ActionFeedback?.confirmed?.('Opération déjà synchronisée ou retirée.');
      } else {
        window.ActionFeedback?.failed?.(`Échec : ${r?.errorCode || 'erreur inconnue'} — la cause n'est pas résolue.`);
      }
    } finally {
      window.ActionFeedback?.reset?.(btn);
      refresh();
    }
  }

  /* « Supprimer de la file » : suppression MANUELLE uniquement, toujours
     confirmée — la donnée locale ne sera alors jamais synchronisée. */
  function removeSyncOperation(operationId) {
    const confirmed = window.confirm(
      'Supprimer cette opération de la file de synchronisation ?\n\n' +
      'Elle ne sera JAMAIS envoyée au cloud : la donnée concernée restera uniquement sur cet appareil (ou sera perdue à la réinstallation). Cette action est irréversible.'
    );
    if (!confirmed) return false;
    const removed = window.DB?.removeOutboxOperation?.(operationId);
    window.App?.toast?.(removed ? '🗑️ Opération retirée de la file.' : 'Opération introuvable (déjà synchronisée ou retirée).');
    refresh();
    return removed;
  }

  /* Export JSON de diagnostic — contenu expurgé des secrets côté
     DB.exportOutboxDiagnostic() (jamais de mot de passe/PIN/token). */
  function exportSyncDiagnostic() {
    try {
      const json = window.DB?.exportOutboxDiagnostic?.();
      if (!json) { window.App?.toast?.('Aucune donnée à exporter.'); return; }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medconnect-sync-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      window.App?.toast?.('📄 Diagnostic exporté (secrets expurgés).');
    } catch (e) {
      console.error('[Settings] exportSyncDiagnostic :', e);
      window.App?.toast?.(e.message || 'Export impossible.', 'error');
    }
  }

  /* ── À PROPOS (version, build, état Firebase/sync) ──────────── */
  function renderAboutSection() {
    const v = window.VersionManager?.getCurrent?.() || {};
    const firebaseOk = typeof firebaseReady !== 'undefined' && firebaseReady && typeof firebaseDB !== 'undefined' && !!firebaseDB;
    const pending = window.DB?.outboxCount?.() || 0;
    const lastSync = window.DB?.getLastSyncAt?.();

    return `
      <div class="settings-section" style="text-align:center;color:var(--text-muted)">
        <h3 style="text-align:left;color:var(--text)">ℹ️ À propos</h3>
        <table class="info-table" style="text-align:left;margin-top:.5rem">
          <tr><td>Version</td><td>${esc(v.version || '—')}</td></tr>
          <tr><td>Build</td><td style="font-family:monospace">${esc(v.build || '—')}</td></tr>
          <tr><td>Date du build</td><td>${esc(v.buildDate || '—')}</td></tr>
          <tr><td>État Firebase</td><td style="color:${firebaseOk ? 'var(--secondary)' : 'var(--danger)'}">${firebaseOk ? '✅ Connecté' : '❌ Indisponible'}</td></tr>
          <tr><td>État synchronisation</td><td style="color:${pending ? 'var(--accent)' : 'var(--secondary)'}">${pending ? `⏳ ${pending} en attente` : '☁️ À jour'}</td></tr>
          <tr><td>Dernière synchronisation</td><td>${lastSync ? esc(new Date(lastSync).toLocaleString('fr-FR')) : '—'}</td></tr>
        </table>
        <button class="btn btn-ghost btn-sm" style="margin-top:.8rem" onclick="VersionManager.openChangelog()">📋 Journal des versions</button>
        <p style="font-size:.8rem;margin-top:1rem">MedConnect © 2026 — MediaVision Tech</p>
        <p style="font-size:.75rem;margin-top:.2rem">📞 +243 856 373 707 · ✉️ hello.mediavision.tech@gmail.com</p>
        <p style="font-size:.72rem;margin-top:.35rem;color:var(--text-dim)">
          Les données peuvent être stockées localement pour le mode hors ligne.<br>
          La synchronisation sécurisée utilise Firebase selon vos droits d'accès.
        </p>
      </div>`;
  }

  /* ── SECTION LOCALISATION (pharmacien) ─────────── */
  function getUserProfile(user) {
    return (DB.getUsers?.() || []).find(u => u.uid === user?.uid) ||
      DB.getAccounts().find(a => a.uid === user?.uid) ||
      user || {};
  }

  function renderPharmacyLocationSection(user) {
    const profile = getUserProfile(user);
    const loc = profile.pharmacyLocation || user?.pharmacyLocation || null;
    const hasLoc = loc && !Number.isNaN(Number(loc.latitude)) && !Number.isNaN(Number(loc.longitude));
    const visible = profile.isLocationVisible !== false && hasLoc;

    return `
      <div class="settings-section">
        <h3>📍 Localisation</h3>
        <p class="settings-desc">
          Enregistrez la position GPS de votre pharmacie pour l'afficher sur la carte des pharmacies.
        </p>
        <div class="settings-current">
          <span class="currency-badge">📍</span>
          <div>
            <strong>${hasLoc ? `${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}` : 'Aucune localisation enregistrée'}</strong>
            <br><small style="color:var(--text-muted)">
              ${hasLoc && loc?.updatedAt ? `Mise à jour : ${loc.updatedAt.slice(0,16).replace('T',' ')}` : 'Permission GPS requise'}
            </small>
          </div>
        </div>
        <div class="settings-row">
          <span>Visible sur la carte</span>
          <span class="privacy-ok" style="${visible?'':'color:var(--accent);border-color:rgba(245,158,11,.25);background:rgba(245,158,11,.08)'}">
            ${visible ? 'Oui' : 'Non'}
          </span>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:.75rem;width:100%"
          onclick="Settings.updatePharmacyLocation()">
          📍 Ajouter / mettre à jour ma localisation
        </button>
      </div>`;
  }

  function updateSessionUser(data) {
    const user = Auth.getUser();
    if (!user) return;
    sessionStorage.setItem('mc_user', JSON.stringify({ ...user, ...data }));
  }

  function updatePharmacyLocation() {
    const user = Auth.getUser();
    if (!user || user.role !== 'pharmacist') {
      App.toast('Seul le pharmacien connecté peut modifier sa localisation.', 'error');
      return;
    }
    if (!navigator.geolocation) {
      App.toast('GPS indisponible sur cet appareil.', 'error');
      return;
    }

    App.toast('📍 Demande de permission GPS...');
    navigator.geolocation.getCurrentPosition(pos => {
      const location = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        updatedAt: new Date().toISOString(),
      };
      const patch = {
        uid: user.uid,
        role: 'pharmacist',
        name: user.name || '',
        phone: user.phone || '',
        matricule: user.matricule || user.username || '',
        pharmacy: user.pharmacy || '',
        pharmacyLocation: location,
        isLocationVisible: true,
      };

      DB.upsertUserProfile?.(user.uid, patch);

      const accounts = DB.getAccounts();
      const idx = accounts.findIndex(a => a.uid === user.uid);
      if (idx !== -1) {
        accounts[idx] = { ...accounts[idx], ...patch };
        DB.saveAccounts(accounts);
      }

      updateSessionUser(patch);
      App.toast('✅ Localisation de la pharmacie enregistrée.');
      Settings.refresh();
    }, err => {
      const msg = err.code === err.PERMISSION_DENIED
        ? 'Permission GPS refusée.'
        : 'Impossible de récupérer la localisation GPS.';
      App.toast(msg, 'error');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  /* ── SECTION CONFIDENTIALITÉ (patient) ─────────── */
  function renderPrivacySection(user) {
    const pid      = localStorage.getItem('mc_my_patient_id');
    const consents = ACL.getPatientConsents(pid);
    const approved = consents.filter(c => c.status === 'approved');
    const pending  = consents.filter(c => c.status === 'pending');
    const authors  = ACL.getAuthorDoctors(pid);

    return `
      <div class="settings-section">
        <h3>🔐 Confidentialité & Consentements</h3>
        <p class="settings-desc">Contrôlez qui a accès à votre dossier médical.</p>

        ${authors.length ? `
          <p style="font-size:.8rem;font-weight:600;color:var(--text-muted);margin-bottom:.5rem">🩺 Médecin(s) auteur(s) — accès médical actif</p>
          ${authors.map(a => `
            <div class="consent-card" style="opacity:.9">
              <strong>${esc(a.name)}</strong>
              <small style="color:var(--text-muted);display:block">A créé un acte médical dans votre dossier — accès non révocable, comme la loi l'exige pour la continuité des soins.</small>
            </div>`).join('')}
          <div style="margin-bottom:.85rem"></div>` : ''}

        ${pending.length ? `
          <div style="margin-bottom:.85rem">
            <p style="font-size:.8rem;font-weight:600;color:var(--accent);margin-bottom:.5rem">⏳ Demandes en attente</p>
            ${pending.map(c => `
              <div class="consent-card pending">
                <div>
                  <strong>${esc(c.doctor_name)}</strong>
                  <small style="color:var(--text-muted)"> — demandé le ${c.requested_at?.slice(0,10)}</small>
                </div>
                <div style="display:flex;gap:.4rem;margin-top:.5rem">
                  <button class="btn btn-ghost btn-xs" style="color:var(--secondary)"
                    onclick="ACL.respondConsent('${c.cid}',true);Settings.refresh()">
                    ✅ Autoriser
                  </button>
                  <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
                    onclick="ACL.respondConsent('${c.cid}',false);Settings.refresh()">
                    ❌ Refuser
                  </button>
                </div>
              </div>`).join('')}
          </div>` : ''}

        ${approved.length ? `
          <p style="font-size:.8rem;font-weight:600;color:var(--secondary);margin-bottom:.5rem">✅ Accès autorisés</p>
          ${approved.map(c => `
            <div class="consent-card approved">
              <div>
                <strong>${esc(c.doctor_name)}</strong>
                <small style="color:var(--text-muted)"> · expire le ${c.expires_at||'—'}</small>
              </div>
              <button class="btn btn-ghost btn-xs" style="color:var(--danger);margin-top:.4rem"
                onclick="ACL.revokeConsent('${c.cid}');Settings.refresh()">
                🚫 Révoquer l'accès
              </button>
            </div>`).join('')}` : ''}

        ${!pending.length && !approved.length ?
          `<div class="card empty-state" style="padding:1rem"><p style="font-size:.83rem">Aucune demande d'accès en cours.<br>Votre dossier est privé.</p></div>` : ''}
      </div>`;
  }

  /* ── SECTION ADMIN ──────────────────────────────── */
  function renderAdminSection() {
    const doctors = ACL.getVerifiedDoctors();
    const pharms  = ACL.getVerifiedPharmacists();
    const logs    = ACL.getAccessLog().slice(-10).reverse();

    return `
      <div class="settings-section">
        <h3>⚙️ Administration — Registres vérifiés</h3>

        <!-- Médecins -->
        <div style="margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
            <p style="font-size:.84rem;font-weight:600">👨‍⚕️ Médecins (${doctors.length})</p>
            <button class="btn btn-ghost btn-xs" onclick="Settings.openAddDoctor()">+ Ajouter</button>
          </div>
          ${doctors.map(d => `
            <div class="admin-row">
              <div>
                <span style="font-family:monospace;font-size:.75rem;color:var(--primary)">${d.order_num}</span>
                <strong style="font-size:.83rem;display:block">${esc(d.name)}</strong>
                <small style="color:var(--text-muted)">${esc(d.specialty)} · ${d.country}</small>
              </div>
              <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
                onclick="ACL.removeVerifiedDoctor('${d.order_num}');Settings.refresh()">🗑️</button>
            </div>`).join('')}
        </div>

        <!-- Pharmaciens -->
        <div style="margin-bottom:1rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
            <p style="font-size:.84rem;font-weight:600">💊 Pharmaciens (${pharms.length})</p>
            <button class="btn btn-ghost btn-xs" onclick="Settings.openAddPharmacist()">+ Ajouter</button>
          </div>
          ${pharms.map(p => `
            <div class="admin-row">
              <div>
                <span style="font-family:monospace;font-size:.75rem;color:var(--purple)">${p.matricule}</span>
                <strong style="font-size:.83rem;display:block">${esc(p.name)}</strong>
                <small style="color:var(--text-muted)">${esc(p.pharmacy)} · ${p.country}</small>
              </div>
              <button class="btn btn-ghost btn-xs" style="color:var(--danger)"
                onclick="ACL.removeVerifiedPharmacist('${p.matricule}');Settings.refresh()">🗑️</button>
            </div>`).join('')}
        </div>

        <!-- Journal d'accès -->
        <p style="font-size:.84rem;font-weight:600;margin-bottom:.5rem">📋 Journal d'accès (récents)</p>
        ${logs.length ? logs.map(l => `
          <div style="font-size:.75rem;color:var(--text-muted);padding:.25rem 0;border-bottom:1px solid var(--border)">
            <span>${l.timestamp?.slice(0,16)}</span> · <span>${l.action}</span> · Patient: <span style="font-family:monospace">${l.patient_id||'—'}</span>
          </div>`).join('') : `<p style="font-size:.8rem;color:var(--text-dim)">Aucun log.</p>`}
      </div>`;
  }

  function openAddDoctor() {
    App.openModal('➕ Ajouter Médecin Vérifié', `
      <form onsubmit="Settings.saveDoctor(event)">
        <div class="form-group"><label>N° Ordre Médical officiel *</label><input type="text" id="ad-num" required placeholder="Numéro officiel" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Nom complet *</label><input type="text" id="ad-name" required></div>
        <div class="form-group"><label>Spécialité</label><input type="text" id="ad-spec" placeholder="Médecine générale, Cardiologie…"></div>
        <div class="form-group"><label>Hôpital / Clinique</label><input type="text" id="ad-hosp"></div>
        <div class="form-group"><label>Pays *</label>
          <select id="ad-country" required>
            <option value="">—</option>
            ${countriesList().map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">✅ Ajouter</button>
        </div>
      </form>`);
  }

  function saveDoctor(e) {
    e.preventDefault();
    const ok = ACL.addVerifiedDoctor({
      order_num: document.getElementById('ad-num').value.trim().toUpperCase(),
      name:      document.getElementById('ad-name').value.trim(),
      specialty: document.getElementById('ad-spec').value.trim(),
      hospital:  document.getElementById('ad-hosp').value.trim(),
      country:   document.getElementById('ad-country').value,
    });
    App.closeModal();
    App.toast(ok ? '✅ Médecin ajouté au registre' : '❌ N° déjà enregistré', ok ? 'success' : 'error');
    Settings.refresh();
  }

  function openAddPharmacist() {
    App.openModal('➕ Ajouter Pharmacien Vérifié', `
      <form onsubmit="Settings.savePharmacist(event)">
        <div class="form-group"><label>N° Matricule / RCCM officiel *</label><input type="text" id="ap-num" required placeholder="Numéro officiel" style="text-transform:uppercase"></div>
        <div class="form-group"><label>Nom du pharmacien *</label><input type="text" id="ap-name" required></div>
        <div class="form-group"><label>Nom de la pharmacie *</label><input type="text" id="ap-pharm" required></div>
        <div class="form-group"><label>Pays *</label>
          <select id="ap-country" required>
            <option value="">—</option>
            ${countriesList().map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Annuler</button>
          <button type="submit" class="btn btn-primary">✅ Ajouter</button>
        </div>
      </form>`);
  }

  function savePharmacist(e) {
    e.preventDefault();
    const ok = ACL.addVerifiedPharmacist({
      matricule: document.getElementById('ap-num').value.trim().toUpperCase(),
      name:      document.getElementById('ap-name').value.trim(),
      pharmacy:  document.getElementById('ap-pharm').value.trim(),
      country:   document.getElementById('ap-country').value,
    });
    App.closeModal();
    App.toast(ok ? '✅ Pharmacien ajouté au registre' : '❌ Matricule déjà enregistré', ok ? 'success' : 'error');
    Settings.refresh();
  }

  return {
    render, refresh, updatePharmacyLocation, openAddDoctor, saveDoctor, openAddPharmacist, savePharmacist, renderAboutSection,
    checkSync, checkBlockedSync, retrySyncOperation, removeSyncOperation, exportSyncDiagnostic,
  };
})();

window.Settings = Settings;
