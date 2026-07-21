package com.mediavision.medconnect;

import android.Manifest;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.util.Arrays;

public class MainActivity extends AppCompatActivity {

    private static final String MEDCONNECT_PWA_URL = "https://davekbg08-cloud.github.io/media-vision-medconnect/?apk=v2.9.35";
    private static final String TRUSTED_APK_URL_PREFIX = "https://davekbg08-cloud.github.io/media-vision-medconnect/downloads/";
    // v2.9.35 (audit sécurité Android) : seules les pages de CET origine
    // restent chargées dans le WebView de l'application (celui qui expose
    // le pont natif AndroidUpdater). Toute autre destination est ouverte
    // dans le navigateur système.
    private static final String OFFICIAL_ORIGIN = "https://davekbg08-cloud.github.io/media-vision-medconnect";

    private WebView myWebView;
    private static final int LOCATION_PERMISSION_REQUEST_CODE = 100;
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 101;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private PermissionRequest pendingPermissionRequest;
    private long updateDownloadId = -1L;
    private BroadcastReceiver updateDownloadReceiver;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        myWebView = new WebView(this);
        setContentView(myWebView);

        WebSettings webSettings = myWebView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(false);
        webSettings.setAllowContentAccess(false);
        webSettings.setGeolocationEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        myWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                // Les pages du domaine officiel restent dans le WebView (l'app).
                if (url.startsWith(OFFICIAL_ORIGIN)) {
                    return false;
                }
                // v2.9.35 (audit sécurité Android) : bug confirmé — toute
                // URL hors domaine officiel était auparavant chargée DANS
                // ce WebView (view.loadUrl(url)), qui expose le pont natif
                // AndroidUpdater et le contexte de session de l'application.
                // Un lien externe (reçu dans un message, page d'aide,
                // tentative de hameçonnage) s'ouvrait ainsi « à l'intérieur »
                // de l'app. On délègue désormais au navigateur/app SYSTÈME
                // (Intent ACTION_VIEW) — jamais au WebView de l'application.
                openExternally(url);
                return true;
            }
        });

        myWebView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                locationOrigin = origin;
                locationCallback = callback;

                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION},
                            LOCATION_PERMISSION_REQUEST_CODE);
                } else {
                    callback.invoke(origin, true, false);
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                boolean requestsCamera = Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);

                if (requestsCamera &&
                        ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    pendingPermissionRequest = request;
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA},
                            CAMERA_PERMISSION_REQUEST_CODE);
                    return;
                }

                request.grant(request.getResources());
            }
        });

        myWebView.addJavascriptInterface(new AndroidUpdateBridge(), "AndroidUpdater");

        myWebView.loadUrl(MEDCONNECT_PWA_URL);
    }

    /* v2.9.35 (audit sécurité Android) : ouvre une destination hors
       domaine officiel dans le navigateur / l'application système, jamais
       dans le WebView de MedConnect. Couvre aussi les schémas non-http
       (tel:, mailto:, geo:…). Un lien sans application capable de le gérer
       est ignoré silencieusement plutôt que rechargé dans le WebView. */
    private void openExternally(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            // Aucune application disponible pour cette URL : on n'ouvre rien
            // (ne jamais retomber sur un chargement in-WebView).
        }
    }

    /* Pont JS <-> natif pour la mise à jour de l'APK : la PWA (version-manager.js)
       détecte la nouvelle version via config/app-version.json et appelle ce pont
       pour télécharger puis lancer l'installation, au lieu d'un simple lien
       navigateur. Seule une URL du domaine officiel de téléchargement est acceptée
       (le WebView peut charger des liens externes dans certains cas). */
    private class AndroidUpdateBridge {
        @JavascriptInterface
        public void downloadAndInstall(final String apkUrl, final String version) {
            runOnUiThread(() -> startApkDownload(apkUrl, version));
        }
    }

    private void startApkDownload(String apkUrl, String version) {
        if (apkUrl == null || !apkUrl.startsWith(TRUSTED_APK_URL_PREFIX)) {
            notifyWeb("download_failed");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            notifyWeb("unknown_sources_required");
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()));
            startActivity(settingsIntent);
            return;
        }

        File updatesDir = new File(getCacheDir(), "apk-updates");
        if (!updatesDir.exists()) updatesDir.mkdirs();
        final File apkFile = new File(updatesDir, "medconnect-update.apk");
        if (apkFile.exists()) apkFile.delete();

        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            notifyWeb("download_failed");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apkUrl));
        request.setTitle("MedConnect " + version);
        request.setDescription("Téléchargement de la mise à jour");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationUri(Uri.fromFile(apkFile));
        request.setMimeType("application/vnd.android.package-archive");

        registerDownloadReceiver(apkFile);
        updateDownloadId = dm.enqueue(request);
        notifyWeb("download_started");
    }

    private void registerDownloadReceiver(final File apkFile) {
        if (updateDownloadReceiver != null) {
            try { unregisterReceiver(updateDownloadReceiver); } catch (IllegalArgumentException ignored) { }
        }
        updateDownloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (id != updateDownloadId) return;
                try { unregisterReceiver(this); } catch (IllegalArgumentException ignored) { }
                updateDownloadReceiver = null;
                installApk(apkFile);
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(updateDownloadReceiver,
                    new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                    Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateDownloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
    }

    private void installApk(File apkFile) {
        if (!apkFile.exists()) {
            notifyWeb("download_failed");
            return;
        }
        Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(installIntent);
            notifyWeb("install_launched");
        } catch (Exception e) {
            notifyWeb("install_failed");
        }
    }

    private void notifyWeb(final String status) {
        runOnUiThread(() -> myWebView.evaluateJavascript(
                "window.VersionManager && window.VersionManager.onNativeUpdateStatus && window.VersionManager.onNativeUpdateStatus('" + status + "');",
                null));
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (updateDownloadReceiver != null) {
            try { unregisterReceiver(updateDownloadReceiver); } catch (IllegalArgumentException ignored) { }
            updateDownloadReceiver = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                if (locationCallback != null && locationOrigin != null) {
                    locationCallback.invoke(locationOrigin, true, false);
                }
            } else {
                if (locationCallback != null && locationOrigin != null) {
                    locationCallback.invoke(locationOrigin, false, false);
                }
            }
        } else if (requestCode == CAMERA_PERMISSION_REQUEST_CODE) {
            if (pendingPermissionRequest != null) {
                if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                    pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                } else {
                    pendingPermissionRequest.deny();
                }
                pendingPermissionRequest = null;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (myWebView.canGoBack()) {
            myWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
