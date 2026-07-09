/* =====================================================
   MedConnect 2.0 — VersionManager
   Gestion professionnelle des versions et des mises à jour :
   PWA, Android (APK sideload) et Desktop (HospitalDesktopUI)
   partagent EXACTEMENT le même mécanisme — MedConnect est une
   seule base de code web, "Desktop" n'étant qu'un mode d'affichage
   de la même PWA (cf. ExchangeBridge.currentSourceDevice()).

   Source unique de version : config/app-version.json.

   Trois mécanismes indépendants, tous non bloquants PAR DÉFAUT :
   1. Version applicative (config/app-version.json) : comparaison
      douce, dialogue "Mettre à jour / Plus tard" — jamais forcé.
   2. Service Worker : détection d'un nouveau SW installé, dialogue
      "Recharger maintenant ?" — l'utilisateur choisit.
   3. Mode maintenance / version minimale obligatoire (Firestore
      system/maintenance) : SEUL mécanisme qui bloque l'accès, et
      seulement si un administrateur l'active explicitement — ce
      n'est pas le comportement par défaut d'une mise à jour normale.
      Les administrateurs gardent toujours l'accès.
   ===================================================== */
const VersionManager = (() => {
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const VERSION_URL = 'config/app-version.json';
  const SEEN_BUILD_KEY = 'mc_app_version_seen_build';

  let _current = null;     // { version, build, buildDate, changelog }
  let _waitingWorker = null;

  function isAdminUser() {
    try {
      return window.Auth?.getUser?.()?.role === 'admin' ||
        window.HospitalAuth?.getSession?.()?.role === 'admin';
    } catch (_) { return false; }
  }

  /* Comparaison semver simplifiée (X.Y.Z, toujours numérique, jamais
     de suffixe pré-release dans ce projet) : -1 si a<b, 0 si égal,
     1 si a>b. */
  function compareVersions(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const diff = (pa[i] || 0) - (pb[i] || 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return 0;
  }

  async function fetchVersionInfo(bypassCache) {
    const url = bypassCache ? `${VERSION_URL}?t=${Date.now()}` : VERSION_URL;
    const res = await fetch(url, bypassCache ? { cache: 'no-store' } : {});
    if (!res.ok) throw new Error(`version fetch ${res.status}`);
    return res.json();
  }

  function getCurrent() { return _current; }

  /* ── 1. Chargement de la version courante ──────────── */
  async function init() {
    try {
      _current = await fetchVersionInfo(false);
    } catch (e) {
      console.warn('[VersionManager] Lecture de config/app-version.json impossible :', e);
      _current = { version: '0.0.0', build: '', buildDate: '', changelog: [] };
    }
    // Première visite (aucune version encore mémorisée) : on note la
    // version en cours SANS afficher de dialogue — ce n'est pas une
    // mise à jour, c'est le premier chargement.
    if (!localStorage.getItem(SEEN_BUILD_KEY)) {
      try { localStorage.setItem(SEEN_BUILD_KEY, _current.build || _current.version); } catch (_) {}
    }
    listenForServiceWorkerUpdate();
    checkAppVersionUpdate();
    checkMaintenanceAndMinimumVersion();
  }

  /* ── 2. Détection de mise à jour applicative (non bloquant) ──
     Repose sur config/app-version.json, toujours lu en réseau
     d'abord côté Service Worker (voir sw.js isFreshAppShellRequest). */
  async function checkAppVersionUpdate() {
    let remote;
    try { remote = await fetchVersionInfo(true); } catch (_) { return; }
    const seen = localStorage.getItem(SEEN_BUILD_KEY) || _current?.build || _current?.version;
    if (!remote?.build || remote.build === seen) return;
    showUpdateDialog(remote);
  }

  function showUpdateDialog(remote) {
    if (!window.App?.openModal) return;
    const notes = (remote.changelog?.[0]?.notes || []).map(n => `<li>${esc(n)}</li>`).join('')
      || '<li>Correctifs et améliorations</li>';
    App.openModal('🆕 Nouvelle version disponible', `
      <table class="info-table">
        <tr><td>Version actuelle</td><td>${esc(_current?.version || '—')}</td></tr>
        <tr><td>Nouvelle version</td><td><strong>${esc(remote.version || '—')}</strong></td></tr>
      </table>
      <p style="margin-top:.7rem"><strong>Nouveautés :</strong></p>
      <ul style="margin:.3rem 0 .3rem 1.1rem;font-size:.85rem">${notes}</ul>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="VersionManager.dismissUpdate()">Plus tard</button>
        <button class="btn btn-primary" onclick="VersionManager.applyUpdate('${esc(remote.build || '')}')">🔄 Mettre à jour</button>
      </div>`);
  }

  function dismissUpdate() {
    App.closeModal?.();
    // Ne mémorise pas la version distante comme "vue" : ce n'est PAS
    // obligatoire, l'utilisateur continue à travailler normalement et
    // sera simplement resollicité à sa prochaine session.
  }

  function applyUpdate(remoteBuild) {
    try { if (remoteBuild) localStorage.setItem(SEEN_BUILD_KEY, remoteBuild); } catch (_) {}
    App.closeModal?.();
    if (_waitingWorker) _waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  }

  /* ── 3. Détection d'un nouveau Service Worker ───────
     PWA / Android (WebView chargeant la même PWA) / Desktop partagent
     ce mécanisme, identique pour les trois : le SW est le même quel
     que soit l'appareil. */
  function listenForServiceWorkerUpdate() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      if (reg.waiting && navigator.serviceWorker.controller) {
        _waitingWorker = reg.waiting;
        promptReload();
      }
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            _waitingWorker = installing;
            promptReload();
          }
        });
      });
    }).catch(() => {});

    // Le nouveau SW a pris le contrôle (après skipWaiting) : on
    // recharge une seule fois pour servir les nouveaux fichiers.
    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      location.reload();
    });
  }

  function promptReload() {
    if (!window.App?.openModal) return;
    const isAndroidApk = /[?&]apk=/.test(location.search);
    App.openModal('🔄 Mise à jour disponible', `
      <p>Une nouvelle version est disponible.</p>
      <p>Recharger maintenant ?</p>
      <div class="form-actions">
        <button class="btn btn-ghost" onclick="App.closeModal()">Plus tard</button>
        ${isAndroidApk
          ? `<button class="btn btn-primary" onclick="VersionManager.openApkDownload()">⬇️ Télécharger l'APK</button>`
          : `<button class="btn btn-primary" onclick="VersionManager.reloadNow()">🔄 Recharger maintenant</button>`}
      </div>`);
  }

  function reloadNow() {
    App.closeModal?.();
    if (_waitingWorker) _waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    else location.reload();
  }

  /* ── 4. Android (APK sideload) ──────────────────────
     L'APK n'est qu'une WebView qui charge cette même PWA (cf.
     CODEX_APK_RELEASE_TASK.md) : aucun store, aucun mécanisme de
     mise à jour natif possible. "Télécharger / Installer" renvoie
     donc vers le lien APK déjà publié — l'installation reste gérée
     par Android (sideload), rien de scriptable de plus depuis le web. */
  function openApkDownload() {
    App.closeModal?.();
    const version = _current?.version || '';
    window.open(`downloads/medconnect-v${version}.apk`, '_blank');
  }

  /* ── 9. Journal des versions (CHANGELOG.md, miroir applicatif) ── */
  function openChangelog() {
    if (!window.App?.openModal) return;
    const entries = _current?.changelog || [];
    const html = entries.length
      ? entries.map(e => `
          <div style="margin-bottom:1rem">
            <strong>v${esc(e.version || '—')}</strong>
            <span class="muted" style="font-size:.8rem"> — ${esc(e.date || '')}</span>
            <ul style="margin:.3rem 0 0 1.1rem;font-size:.85rem">
              ${(e.notes || []).map(n => `<li>${esc(n)}</li>`).join('')}
            </ul>
          </div>`).join('')
      : '<p>Aucun journal disponible.</p>';
    App.openModal('📋 Journal des versions', html);
  }

  /* ── 7/8. Mode maintenance & version minimale obligatoire ──
     Seul mécanisme qui bloque réellement l'accès — et seulement si
     un administrateur l'a explicitement activé côté Firestore. */
  async function checkMaintenanceAndMinimumVersion() {
    if (typeof firebaseDB === 'undefined' || !firebaseDB) return;
    let doc;
    try {
      const snap = await firebaseDB.collection('system').doc('maintenance').get();
      doc = snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn('[VersionManager] Lecture system/maintenance impossible :', e);
      return;
    }
    if (!doc) return;
    if (isAdminUser()) { hideBlockScreen(); return; } // admin : toujours accès

    if (doc.minimumVersion && compareVersions(_current?.version, doc.minimumVersion) < 0) {
      renderBlockScreen('⛔', 'Mise à jour obligatoire',
        'Votre version est trop ancienne.<br>Veuillez effectuer la mise à jour.', true);
      return;
    }
    if (doc.enabled) {
      renderBlockScreen('🛠️', 'Maintenance en cours', esc(doc.message || 'MedConnect est en maintenance. Merci de revenir plus tard.'), false);
      return;
    }
    hideBlockScreen();
  }

  function renderBlockScreen(icon, title, message, showUpdateButton) {
    let el = document.getElementById('mc-block-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mc-block-screen';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="mc-block-card">
        <div class="mc-block-icon">${icon}</div>
        <h2>${esc(title)}</h2>
        <p>${message}</p>
        ${showUpdateButton ? `<button class="btn btn-primary" style="margin-top:1rem" onclick="VersionManager.reloadNow()">🔄 Mettre à jour</button>` : ''}
      </div>`;
    el.style.display = 'flex';
  }

  function hideBlockScreen() {
    const el = document.getElementById('mc-block-screen');
    if (el) el.style.display = 'none';
  }

  if (typeof window !== 'undefined') {
    if (document.readyState !== 'loading') setTimeout(init, 300);
    else window.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }

  return {
    init, getCurrent, compareVersions,
    dismissUpdate, applyUpdate, reloadNow, openApkDownload, openChangelog,
    checkMaintenanceAndMinimumVersion,
  };
})();

window.VersionManager = VersionManager;
