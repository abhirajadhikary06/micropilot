package com.micropilot.edge;

import android.app.Notification;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import com.getcapacitor.JSObject;

public class MicroPilotNotificationListener extends NotificationListenerService {

    private String lastSignature = "";
    private long lastTimestamp = 0L;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName();
        if (pkg == null || pkg.equals(getPackageName())) {
            return; // Ignore our own report notifications to avoid infinite loops
        }

        Notification notif = sbn.getNotification();
        if (notif == null) return;

        // Skip ongoing background service notifications and group summaries
        if ((notif.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;
        if ((notif.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;

        Bundle extras = notif.extras;
        if (extras == null) return;

        CharSequence titleSeq = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence bigTextSeq = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);

        String title = titleSeq != null ? titleSeq.toString().trim() : "";
        String text = bigTextSeq != null
            ? bigTextSeq.toString().trim()
            : (textSeq != null ? textSeq.toString().trim() : "");

        if (title.isEmpty() && text.isEmpty()) {
            return;
        }

        long now = System.currentTimeMillis();
        String signature = pkg + "|" + title + "|" + text;
        if (signature.equals(lastSignature) && (now - lastTimestamp) < 3000) {
            return; // Deduplicate rapid OS updates
        }
        lastSignature = signature;
        lastTimestamp = now;

        String appName = resolveAppName(pkg);

        JSObject payload = new JSObject();
        payload.put("id", sbn.getKey() != null ? sbn.getKey() : (pkg + "_" + now));
        payload.put("packageName", pkg);
        payload.put("appName", appName);
        payload.put("title", title);
        payload.put("text", text);
        payload.put("timestamp", sbn.getPostTime() > 0 ? sbn.getPostTime() : now);

        NotificationBridgePlugin.dispatchIncomingNotification(payload);
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
            // Fallback to readable suffix if package visibility is restricted
        }
        String[] parts = packageName.split("\\.");
        if (parts.length > 0) {
            String last = parts[parts.length - 1];
            return last.substring(0, 1).toUpperCase() + last.substring(1);
        }
        return packageName;
    }
}
