package com.micropilot.edge;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

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
    private static final String PREFS_NAME = "micropilot_bridge_prefs";
    private static final String KEY_PENDING_JSON = "pending_notifications";
    private static final int MAX_QUEUE = 40;
    private static final Object QUEUE_LOCK = new Object();

    private static volatile NotificationBridgePlugin activeInstance = null;
    private static volatile boolean isAppForeground = false;

    @Override
    public void load() {
        super.load();
        activeInstance = this;
        isAppForeground = true;
        createNotificationChannel(getContext());
        if (checkSettingsEnabled(getContext())) {
            MicroPilotNotificationListener.ensureRebind(getContext());
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        activeInstance = this;
        isAppForeground = true;
        if (checkSettingsEnabled(getContext())) {
            MicroPilotNotificationListener.ensureRebind(getContext());
        }
    }

    @Override
    protected void handleOnPause() {
        isAppForeground = false;
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        isAppForeground = false;
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static void handleIncomingNotification(Context context, JSObject payload) {
        NotificationBridgePlugin instance = activeInstance;
        if (instance != null && isAppForeground) {
            instance.notifyListeners("notificationReceived", payload, true);
            return;
        }

        // Persist into SharedPreferences so it survives WebView pause or app termination
        enqueuePending(context, payload);

        // Fire an immediate background triage notification report
        postBackgroundNativeReport(context, payload);
    }

    private static void enqueuePending(Context context, JSObject payload) {
        synchronized (QUEUE_LOCK) {
            try {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String raw = prefs.getString(KEY_PENDING_JSON, "[]");
                JSONArray arr = new JSONArray(raw);
                arr.put(new JSONObject(payload.toString()));

                // Trim oldest if exceeding MAX_QUEUE
                if (arr.length() > MAX_QUEUE) {
                    JSONArray trimmed = new JSONArray();
                    for (int i = arr.length() - MAX_QUEUE; i < arr.length(); i++) {
                        trimmed.put(arr.get(i));
                    }
                    arr = trimmed;
                }
                prefs.edit().putString(KEY_PENDING_JSON, arr.toString()).apply();
            } catch (Exception ignored) {
                // Ignore JSON/SharedPrefs error
            }
        }
    }

    private static void postBackgroundNativeReport(Context context, JSObject payload) {
        try {
            String appName = payload.optString("appName", "App");
            String title = payload.optString("title", "");
            String text = payload.optString("text", "");
            String combined = (title.isEmpty() ? "" : title + ": ") + text;
            String lower = combined.toLowerCase(Locale.ROOT);

            boolean hasLink = Pattern.compile("https?://\\S+", Pattern.CASE_INSENSITIVE).matcher(combined).find();
            boolean hasOtpWord = Pattern.compile("\\b(otp|code|pin|passcode|verify|verification|2fa)\\b").matcher(lower).find();
            Matcher otpMatcher = hasOtpWord ? Pattern.compile("\\b(\\d{4,8})\\b").matcher(combined) : null;
            String otp = (otpMatcher != null && otpMatcher.find()) ? otpMatcher.group(1) : null;

            boolean isScamHint = hasLink && Pattern.compile("\\b(suspended|urgent|verify|blocked|kyc|penalty|expire|claim|winner)\\b").matcher(lower).find();
            boolean isUrgent = Pattern.compile("\\b(urgent|asap|immediately|emergency|failed|down|502|error|unauthorized|alert)\\b").matcher(lower).find();
            boolean isFinancial = Pattern.compile("(?:rs\\.?|inr|usd|\\$|debited|credited|payment|transaction|bank)").matcher(lower).find();

            String priority = "ROUTINE";
            String category = "Routine Update";
            if (isScamHint) {
                priority = "RISK";
                category = "Potential Phishing / Link Alert";
            } else if (otp != null) {
                priority = "URGENT";
                category = "Security Alert / OTP";
            } else if (isUrgent) {
                priority = "URGENT";
                category = "Urgent Action Required";
            } else if (isFinancial) {
                priority = "IMPORTANT";
                category = "Financial Update";
            }

            StringBuilder body = new StringBuilder();
            if (otp != null) body.append("OTP: ").append(otp).append(" | ");
            if (hasLink) body.append("Link detected | ");
            body.append("Open MicroPilot for full MobileBERT report.\n");
            body.append(combined.length() > 110 ? combined.substring(0, 110) + "..." : combined);

            int notifId = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
            dispatchNotification(
                context,
                notifId,
                "[" + priority + "] " + appName + " - " + category,
                body.toString(),
                priority
            );
        } catch (Exception ignored) {
            // Do not crash NotificationListenerService
        }
    }

    private static boolean checkSettingsEnabled(Context ctx) {
        String enabledListeners = Settings.Secure.getString(
            ctx.getContentResolver(),
            "enabled_notification_listeners"
        );
        return enabledListeners != null && enabledListeners.contains(ctx.getPackageName());
    }

    @PluginMethod
    public void isNotificationAccessEnabled(PluginCall call) {
        boolean enabled = checkSettingsEnabled(getContext());
        if (enabled) {
            MicroPilotNotificationListener.ensureRebind(getContext());
        }
        boolean bound = MicroPilotNotificationListener.isServiceBound();

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        ret.put("serviceBound", bound);
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
        JSArray out = new JSArray();
        synchronized (QUEUE_LOCK) {
            try {
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String raw = prefs.getString(KEY_PENDING_JSON, "[]");
                JSONArray arr = new JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    out.put(JSObject.fromJSONObject(arr.getJSONObject(i)));
                }
                prefs.edit().putString(KEY_PENDING_JSON, "[]").apply();
            } catch (Exception ignored) {
                // Ignore
            }
        }
        JSObject ret = new JSObject();
        ret.put("notifications", out);
        call.resolve(ret);
    }

    @PluginMethod
    public void scanActiveNotifications(PluginCall call) {
        if (checkSettingsEnabled(getContext())) {
            MicroPilotNotificationListener.ensureRebind(getContext());
        }
        JSArray active = MicroPilotNotificationListener.readActiveShadeNotifications();
        JSObject ret = new JSObject();
        ret.put("notifications", active);
        ret.put("serviceBound", MicroPilotNotificationListener.isServiceBound());
        call.resolve(ret);
    }

    @PluginMethod
    public void postAnalysisReportNotification(PluginCall call) {
        int id = call.getInt("id", (int) (System.currentTimeMillis() % Integer.MAX_VALUE));
        String title = call.getString("title", "MicroPilot Report");
        String body = call.getString("body", "");
        String priority = call.getString("priority", "ROUTINE");

        dispatchNotification(getContext(), id, title, body, priority);
        call.resolve();
    }

    private static void dispatchNotification(
        Context ctx,
        int id,
        String title,
        String body,
        String priority
    ) {
        createNotificationChannel(ctx);

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
    }

    private static void createNotificationChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "MicroPilot AI Reports",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("On-device triage reports for incoming notifications");
            NotificationManager manager = ctx.getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
