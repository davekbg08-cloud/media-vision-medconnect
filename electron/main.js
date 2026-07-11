/* =====================================================
   MedConnect — Application de bureau (Electron)
   Windows + Linux

   Charge l'application web MedConnect déployée en direct sur GitHub
   Pages, exactement comme le fait android/.../MainActivity.java pour
   Android : jamais de fichiers embarqués, jamais de file://.

   Deux pièges à éviter (voir js/exchange-bridge.js::currentSourceDevice) :
   - file:// forcerait la détection en mode 'mobile' au lieu de 'desktop'.
   - injecter window.Capacitor (ex: @capacitor-community/electron) ferait
     la même erreur de détection. Cette app reste un Electron "nu".
   ===================================================== */
const { app, BrowserWindow, shell } = require('electron');

const APP_URL = 'https://davekbg08-cloud.github.io/media-vision-medconnect/?desktop=v1.0.0';
const ALLOWED_ORIGIN = 'https://davekbg08-cloud.github.io';

function isAllowedUrl(url) {
  try {
    return new URL(url).origin === ALLOWED_ORIGIN;
  } catch (_) {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: __dirname + '/resources/icon.png',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
    },
  });

  // Navigation restreinte au domaine attendu — équivalent du
  // shouldOverrideUrlLoading déjà en place côté Android : tout lien
  // externe s'ouvre dans le navigateur système, jamais dans la fenêtre
  // Electron (donc jamais avec un accès Node quelconque).
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
