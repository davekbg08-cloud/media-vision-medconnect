/* =====================================================
   MedConnect — Application de bureau (Electron)
   Windows + Linux

   Charge l'application web MedConnect déployée en direct (miroir
   Firebase Hosting, origine dédiée MedConnect), exactement comme le
   fait android/.../MainActivity.java pour Android : jamais de fichiers
   embarqués, jamais de file://.

   Deux pièges à éviter (voir js/exchange-bridge.js::currentSourceDevice) :
   - file:// forcerait la détection en mode 'mobile' au lieu de 'desktop'.
   - injecter window.Capacitor (ex: @capacitor-community/electron) ferait
     la même erreur de détection. Cette app reste un Electron "nu".

   ORIGINE DÉDIÉE (audit) : l'app chargeait auparavant
   https://davekbg08-cloud.github.io/media-vision-medconnect/ et
   autorisait toute l'origine https://davekbg08-cloud.github.io —
   partagée avec d'AUTRES projets GitHub Pages du même compte, alors que
   MedConnect conserve des caches médicaux dans localStorage (scindé par
   origine dans Chromium/Electron, donc pas de fuite de données entre
   projets, mais une origine dédiée reste la bonne pratique pour une
   app médicale). MEDCONNECT_APP_URL est configurable (variable
   d'environnement, utile en développement) ; par défaut, le miroir
   Firebase Hosting dédié à MedConnect. AUCUN repli silencieux vers
   l'ancienne origine GitHub Pages partagée en production — si l'URL
   configurée est injoignable, did-fail-load affiche un écran clair
   avec un bouton Réessayer (jamais de fenêtre blanche, jamais de
   substitution d'origine sans que l'utilisateur le sache).
   ===================================================== */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const url = require('url');

// app.getVersion() lit electron/package.json (synchronisé sur la
// version racine par scripts/sync-desktop-version.mjs avant chaque
// build — voir package.json "predist:win"/"predist:linux") : jamais de
// version codée en dur dans l'URL.
const BASE_APP_URL = 'https://medconnect-e81ba.web.app/';
const DEFAULT_APP_URL = `${BASE_APP_URL}?desktop=v${app.getVersion()}`;
const APP_URL = process.env.MEDCONNECT_APP_URL || DEFAULT_APP_URL;
const ALLOWED_ORIGIN = new URL(APP_URL).origin;
// Chemins attendus de l'app (SPA — tout le reste du routage est côté
// client) : racine et page de confidentialité (voir firebase.json
// rewrites). Toute autre origine OU tout autre chemin sur la bonne
// origine est traité comme un lien externe (navigateur système).
const ALLOWED_PATHS = new Set(['/', '/privacy', '/privacy.html', '/privacy/']);

function isAllowedNavigation(target) {
  try {
    const u = new URL(target);
    if (u.origin !== ALLOWED_ORIGIN) return false;
    return ALLOWED_PATHS.has(u.pathname) || u.pathname.startsWith('/privacy');
  } catch (_) {
    return false;
  }
}

// Verrou d'instance unique : un poste hospitalier partagé ne doit
// jamais avoir deux sessions desktop MedConnect ouvertes en parallèle
// (risque de confusion entre agents / écritures concurrentes sur le
// même profil local). La seconde tentative de lancement ramène la
// fenêtre existante au premier plan au lieu d'ouvrir une deuxième copie.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  /* ── Permissions ─────────────────────────────────────
     Seule la géolocalisation est réellement utilisée sur desktop
     (carte des pharmacies, localisation du pharmacien — voir
     js/map.js, js/settings.js::updatePharmacyLocation). Le scanner QR
     (js/share.js::startQRScanner, caméra) n'est jamais câblé dans une
     route du shell desktop (HospitalDesktopUI) — uniquement accessible
     depuis l'app mobile : caméra et microphone restent donc refusés
     sur desktop. Notifications, MIDI, HID, capteurs, etc. : jamais
     utilisés, toujours refusés. Refusé pour toute origine autre que
     MedConnect lui-même. */
  const ALLOWED_PERMISSIONS = new Set(['geolocation']);

  function configurePermissions(ses) {
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      const requestingUrl = webContents.getURL();
      let allowed = false;
      try {
        allowed = new URL(requestingUrl).origin === ALLOWED_ORIGIN && ALLOWED_PERMISSIONS.has(permission);
      } catch (_) { allowed = false; }
      callback(allowed);
    });
    if (typeof ses.setPermissionCheckHandler === 'function') {
      ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
        return requestingOrigin === ALLOWED_ORIGIN && ALLOWED_PERMISSIONS.has(permission);
      });
    }
  }

  function offlinePageUrl() {
    const base = url.pathToFileURL(path.join(__dirname, 'offline.html')).toString();
    return `${base}?target=${encodeURIComponent(APP_URL)}`;
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 700,
      icon: path.join(__dirname, 'resources', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        enableRemoteModule: false,
      },
    });
    mainWindow = win;

    configurePermissions(win.webContents.session);

    // Navigation restreinte à l'origine ET au chemin attendus —
    // équivalent du shouldOverrideUrlLoading déjà en place côté
    // Android : tout lien externe (ou tout autre chemin/origine) s'ouvre
    // dans le navigateur système, jamais dans la fenêtre Electron (donc
    // jamais avec un accès Node quelconque).
    win.webContents.on('will-navigate', (event, target) => {
      if (!isAllowedNavigation(target)) {
        event.preventDefault();
        shell.openExternal(target);
      }
    });

    win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      shell.openExternal(targetUrl);
      return { action: 'deny' };
    });

    // Téléchargements : jamais gérés silencieusement dans la fenêtre —
    // MedConnect desktop n'a aucun flux de téléchargement de fichier
    // depuis l'app elle-même ; tout item de téléchargement déclenché
    // (ex. lien externe cliqué par erreur) est annulé et renvoyé vers
    // le navigateur système comme les autres liens externes.
    win.webContents.session.on('will-download', (event, item) => {
      const itemUrl = item.getURL();
      event.preventDefault();
      if (itemUrl) shell.openExternal(itemUrl);
    });

    // Jamais de fenêtre blanche : un échec de chargement (réseau coupé,
    // miroir Firebase Hosting indisponible) affiche une page locale
    // claire avec un bouton Réessayer, sans jamais prétendre que
    // MedConnect fonctionne hors ligne.
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (validatedURL && validatedURL.startsWith('file://')) return; // évite une boucle si offline.html lui-même échoue
      console.error(`[MedConnect] Échec de chargement (${errorCode} ${errorDescription}) :`, validatedURL);
      win.loadURL(offlinePageUrl());
    });

    win.loadURL(APP_URL);
  }

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
