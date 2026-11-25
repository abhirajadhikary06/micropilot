package com.micropilot.edge;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ConcurrentLinkedQueue;

@CapacitorPlugin(
    name = "NotificationBridge",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class NotificationBridgePlugin extends Plugin {

    private static final String CHANNEL_ID = "micropilot_reports";
    private static final int MAX_QUEUE = 50;
    private static final ConcurrentLinkedQueue<JSObject> pendingQueue = new ConcurrentLinkedQueue<>();
    private static NotificationBridgePlugin activeInstance = null;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        createNotificationChannel();
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static void dispatchIncomingNotification(JSObject payload) {
        NotificationBridgePlugin instance = activeInstance;
        if (instance != null) {
            instance.notifyListeners("notificationReceived", payload, true);
        } else {
            pendingQueue.add(payload);
            while (pendingQueue.size() > MAX_QUEUE) {
                pendingQueue.poll();
            }
        }
    }

    @PluginMethod
    public void isNotificationAccessEnabled(PluginCall call) {
        String enabledListeners = Settings.Secure.getString(
            getContext().getContentResolver(),
            "enabled_notification_listeners"
        );
        boolean enabled = enabledListeners != null &&
            enabledListeners.contains(getContext().getPackageName());

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void requestPostNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }

        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("notifications", call, "notificationsPermCallback");
        }
    }

    @PermissionCallback
    private void notificationsPermCallback(PluginCall call) {
        boolean granted = getPermissionState("notifications") == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingNotifications(PluginCall call) {
        JSArray arr = new JSArray();
        JSObject item;
        while ((item = pendingQueue.poll()) != null) {
            arr.put(item);
        }
        JSObject ret = new JSObject();
        ret.put("notifications", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void postAnalysisReportNotification(PluginCall call) {
        int id = call.getInt("id", (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        String title = call.getString("title", "MicroPilot Report");
        String body = call.getString("body", "");
        String priority = call.getString("priority", "ROUTINE");

        createNotificationChannel();

        Context ctx = getContext();
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(ctx, id, openIntent, flags);

        int notifPriority = ("URGENT".equals(priority) || "RISK".equals(priority))
            ? NotificationCompat.PRIORITY_HIGH
            : NotificationCompat.PRIORITY_DEFAULT;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(notifPriority)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent);

        NotificationManager manager = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(id, builder.build());
        }
        call.resolve();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "MicroPilot AI Reports",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("On-device triage reports for incoming notifications");
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
