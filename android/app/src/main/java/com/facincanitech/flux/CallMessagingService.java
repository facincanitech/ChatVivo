package com.facincanitech.flux;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class CallMessagingService extends MessagingService {

    private static final String CHANNEL_ID = "flux_calls";
    private static int notificationId = 9001;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if ("call".equals(data.get("type"))) {
            showFullScreenCallNotification(remoteMessage);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    private void showFullScreenCallNotification(RemoteMessage remoteMessage) {
        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "Chamadas do Flux", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Chamadas de voz e vídeo");
                channel.enableVibration(true);
                nm.createNotificationChannel(channel);
            }
        }

        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(ctx, notificationId, intent, piFlags);

        RemoteMessage.Notification notif = remoteMessage.getNotification();
        String title = notif != null && notif.getTitle() != null ? notif.getTitle() : "Chamada";
        String body = notif != null && notif.getBody() != null ? notif.getBody() : "";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setAutoCancel(true)
                .setOngoing(true)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .setContentIntent(fullScreenPendingIntent);

        nm.notify(notificationId, builder.build());
    }
}
