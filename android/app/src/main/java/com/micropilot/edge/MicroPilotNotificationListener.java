package com.micropilot.edge;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

public class MicroPilotNotificationListener extends NotificationListenerService {

    private static volatile MicroPilotNotificationListener activeServiceInstance = null;
    private String lastSignature = "";
    private long lastTimestamp = 0L;

    public static boolean isServiceBound() {
        return activeServiceInstance != null;
    }

    public static void ensureRebind(Context context) {
        if (activeServiceInstance == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                requestRebind(new ComponentName(context, MicroPilotNotificationListener.class));
            } catch (Exception ignored) {
                // Ignore if permission not yet granted
            }
        }
    }

    public static JSArray readActiveShadeNotifications() {
        JSArray list = new JSArray();
        MicroPilotNotificationListener svc = activeServiceInstance;
        if (svc == null) return list;

        try {
            StatusBarNotification[] active = svc.getActiveNotifications();
            if (active == null) return list;

            for (StatusBarNotification sbn : active) {
                JSObject payload = svc.extractPayload(sbn, false);
                if (payload != null) {
                    list.put(payload);
                }
            }
        } catch (Exception ignored) {
            // Ignore security or binder errors
        }
        return list;
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        activeServiceInstance = this;
    }

    @Override
    public void onListenerDisconnected() {
        if (activeServiceInstance == this) {
            activeServiceInstance = null;
        }
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        activeServiceInstance = this;
        JSObject payload = extractPayload(sbn, true);
        if (payload == null) return;

        NotificationBridgePlugin.handleIncomingNotification(getApplicationContext(), payload);
    }

    private JSObject extractPayload(StatusBarNotification sbn, boolean deduplicate) {
        if (sbn == null) return null;

        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) {
            return null; // Never process MicroPilot's own notifications
        }

        Notification notif = sbn.getNotification();
        if (notif == null) return null;

        if ((notif.flags & Notification.FLAG_ONGOING_EVENT) != 0) return null;
        if ((notif.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return null;

        Bundle extras = notif.extras;
        if (extras == null) return null;

        CharSequence titleSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence bigTextSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence subTextSeq = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);

        String title = titleSeq != null ? titleSeq.toString().trim() : "";
        String text = bigTextSeq != null
            ? bigTextSeq.toString().trim()
            : (textSeq != null ? textSeq.toString().trim() : "");

        if (text.isEmpty() && subTextSeq != null) {
            text = subTextSeq.toString().trim();
        }

        if (title.isEmpty() && text.isEmpty()) {
            return null;
        }

        long now = System.currentTimeMillis();
        if (deduplicate) {
            String signature = pkg + "|" + title + "|" + text;
            if (signature.equals(lastSignature) && (now - lastTimestamp) < 2500) {
                return null;
            }
            lastSignature = signature;
            lastTimestamp = now;
        }

        String appName = resolveAppName(pkg);

        JSObject payload = new JSObject();
        payload.put("id", sbn.getKey() != null ? sbn.getKey() : (pkg + "_" + now));
        payload.put("packageName", pkg);
        payload.put("appName", appName);
        payload.put("title", title);
        payload.put("text", text);
        payload.put("timestamp", sbn.getPostTime() > 0 ? sbn.getPostTime() : now);
        return payload;
    }

    private String resolveAppName(String packageName) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo info = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(info);
            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Exception ignored) {
            // Fallback to readable suffix
        }
        String[] parts = packageName.split("\\.");
        if (parts.length > 0) {
            String last = parts[parts.length - 1];
            if (!last.isEmpty()) {
                return last.substring(0, 1).toUpperCase() + last.substring(1);
            }
        }
        return packageName;
    }
}
