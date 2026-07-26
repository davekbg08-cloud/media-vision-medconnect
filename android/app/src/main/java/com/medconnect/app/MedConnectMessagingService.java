package com.mediavision.medconnect;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Service FCM natif (Phase 5 notifications, v2.9.42).
 *
 * Reçoit des messages DATA-ONLY et EXPURGÉS (notificationId/category/priority/
 * deepLink) : AUCUNE donnée médicale ne transite. Le service n'affiche qu'un
 * libellé GÉNÉRIQUE ; l'application relit ensuite la notification autorisée
 * depuis Firestore. Aucune donnée médicale n'est jamais placée dans l'Intent.
 */
public class MedConnectMessagingService extends FirebaseMessagingService {

    static final String CH_CRITICAL       = "medconnect_critical";
    static final String CH_CLINICAL       = "medconnect_clinical";
    static final String CH_APPOINTMENTS    = "medconnect_appointments";
    static final String CH_MESSAGES        = "medconnect_messages";
    static final String CH_ADMINISTRATIVE  = "medconnect_administrative";

    private static final String GENERIC_TITLE = "MedConnect";
    private static final String GENERIC_BODY  = "Vous avez une nouvelle notification sécurisée.";

    @Override
    public void onNewToken(String token) {
        // Le jeton natif est récupéré par MainActivity (pont JS) qui appelle la
        // Cloud Function registerPushDevice à la connexion. On mémorise le
        // dernier jeton pour que la WebView puisse l'enregistrer.
        MedConnectPushBridge.setToken(getApplicationContext(), token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String notificationId = data.get("notificationId");
        String category = data.get("category");
        String priority = data.get("priority");
        String deepLink = safePath(data.get("deepLink"));

        String channelId = channelForCategory(category, priority);
        ensureChannels();

        // Intent d'ouverture : on ne transmet QUE des métadonnées non médicales.
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        intent.putExtra("mc_notification_id", notificationId);
        intent.putExtra("mc_deep_link", deepLink);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this,
                notificationId != null ? notificationId.hashCode() : 0, intent, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(GENERIC_TITLE)
                .setContentText(GENERIC_BODY)
                .setAutoCancel(true)
                .setPriority("critical".equals(priority) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(pi);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        // tag = notificationId : regroupe/évite les doublons.
        nm.notify(notificationId, 0, b.build());
    }

    private String channelForCategory(String category, String priority) {
        if ("critical".equals(priority) || "security".equals(category)) return CH_CRITICAL;
        if (category == null) return CH_ADMINISTRATIVE;
        switch (category) {
            case "appointments": case "appointment": return CH_APPOINTMENTS;
            case "messages": case "message": return CH_MESSAGES;
            case "labResults": case "lab_result":
            case "prescriptions": case "prescription":
            case "admissions": case "admission":
            case "transfers": case "transfer": return CH_CLINICAL;
            default: return CH_ADMINISTRATIVE;
        }
    }

    /** Deep link SÛR : chemin interne connu, sinon /notifications. */
    static String safePath(String deepLink) {
        if (deepLink == null || !deepLink.startsWith("/") || deepLink.startsWith("//")) return "/notifications";
        String[] allow = {"/notifications", "/appointments", "/lab", "/prescriptions", "/messages", "/admissions", "/transfers"};
        for (String p : allow) if (deepLink.equals(p) || deepLink.startsWith(p + "/")) return deepLink;
        return "/notifications";
    }

    void ensureChannels() { createChannels(getApplicationContext()); }

    /** Récupère le jeton FCM natif et le met en cache (pont WebView). Confine
        toute référence Firebase à cette classe : MainActivity l'appelle sans
        importer Firebase, et un échec (Firebase non configuré, google-services
        absent) est silencieux — l'app fonctionne sans push. */
    static void fetchAndCache(final Context ctx) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnSuccessListener(token -> {
                if (token != null) MedConnectPushBridge.setToken(ctx, token);
            });
        } catch (Throwable ignored) { /* Firebase indisponible : pas de push */ }
    }

    /** Crée les canaux stables (idempotent). Appelé aussi par MainActivity. */
    static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CH_CRITICAL, "Alertes critiques", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(new NotificationChannel(CH_CLINICAL, "Clinique", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CH_APPOINTMENTS, "Rendez-vous", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(new NotificationChannel(CH_ADMINISTRATIVE, "Administratif", NotificationManager.IMPORTANCE_LOW));
    }
}
