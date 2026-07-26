package com.mediavision.medconnect;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

/**
 * Pont natif ↔ WebView pour le push Android (Phase 5, v2.9.42).
 *
 * Le jeton FCM natif est mémorisé (SharedPreferences) par le service FCM ; la
 * WebView (js/push-registration.js) le lit via ce pont et l'enregistre auprès
 * de la Cloud Function registerPushDevice (Auth + App Check) avec le provider
 * `fcm_android_native`. Le jeton n'est JAMAIS logué.
 */
public class MedConnectPushBridge {

    private static final String PREFS = "mc_push";
    private static final String KEY_TOKEN = "fcm_token";

    static void setToken(Context ctx, String token) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putString(KEY_TOKEN, token).apply();
    }

    static String getToken(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_TOKEN, null);
    }

    private final Context ctx;
    MedConnectPushBridge(Context ctx) { this.ctx = ctx.getApplicationContext(); }

    /** Exposé à la WebView : window.MedConnectPush.getToken(). */
    @JavascriptInterface
    public String getCachedToken() {
        String t = getToken(ctx);
        return t == null ? "" : t;
    }

    /** Indique à la WebView qu'elle tourne dans l'app native Android. */
    @JavascriptInterface
    public boolean isNativeAndroid() { return true; }
}
