package com.jblpartybox320.hebrewcontrol;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public class MainActivity extends Activity {
    private static final int REQ_SPEAKER_PERMS = 3201;
    private static final int REQ_AUDIO_FILE_PICKER = 3202;
    private static final int NOTIFICATION_ID = 3200;
    private static final String CHANNEL_ID = "jbl_partybox_quick_controls";
    private static final String ACTION_QUICK_CMD = "com.jblpartybox320.hebrewcontrol.QUICK_CMD";
    private static final String EXTRA_CMD = "cmd";

    private WebView webView;
    private AudioManager audioManager;
    private Equalizer hardwareEq;
    private BassBoost hardwareBass;
    private ValueCallback<Uri[]> fileUploadCallback;
    private boolean receiverRegistered = false;

    private final BroadcastReceiver quickControlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !ACTION_QUICK_CMD.equals(intent.getAction())) {
                return;
            }
            final String cmd = intent.getStringExtra(EXTRA_CMD);
            if (cmd == null || webView == null) {
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    String safeCmd = cmd.replace("'", "");
                    webView.evaluateJavascript(
                        "if(window.onJblNotificationAction){window.onJblNotificationAction('" + safeCmd + "');}",
                        null
                    );
                }
            });
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        ensureNotificationChannel();
        registerQuickReceiver();

        webView = new WebView(this);
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setMediaPlaybackRequiresUserGesture(false);

        webView.addJavascriptInterface(new JblAndroidBridge(), "JblAndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(
                WebView view,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;
                try {
                    Intent pickerIntent = fileChooserParams.createIntent();
                    startActivityForResult(pickerIntent, REQ_AUDIO_FILE_PICKER);
                    return true;
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "JBL PartyBox 320 Quick Controls",
                    NotificationManager.IMPORTANCE_LOW
                );
                ch.setDescription("שליטה מהירה ברמקול ובתאורת הניאון מווילון ההתראות");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void registerQuickReceiver() {
        if (receiverRegistered) return;
        IntentFilter filter = new IntentFilter(ACTION_QUICK_CMD);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(quickControlReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(quickControlReceiver, filter);
        }
        receiverRegistered = true;
    }

    private PendingIntent buildCmdPendingIntent(String cmd, int reqCode) {
        Intent intent = new Intent(ACTION_QUICK_CMD);
        intent.setPackage(getPackageName());
        intent.putExtra(EXTRA_CMD, cmd);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(this, reqCode, intent, flags);
    }

    private boolean hasPerm(String perm) {
        if (Build.VERSION.SDK_INT < 23) return true;
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private String buildPermissionsJson() {
        boolean btScan;
        boolean btConnect;
        if (Build.VERSION.SDK_INT >= 31) {
            btScan = hasPerm("android.permission.BLUETOOTH_SCAN");
            btConnect = hasPerm("android.permission.BLUETOOTH_CONNECT");
        } else {
            btScan = hasPerm(Manifest.permission.ACCESS_FINE_LOCATION)
                || hasPerm(Manifest.permission.ACCESS_COARSE_LOCATION);
            btConnect = true;
        }
        boolean mic = hasPerm(Manifest.permission.RECORD_AUDIO);
        boolean notif = Build.VERSION.SDK_INT < 33 || hasPerm("android.permission.POST_NOTIFICATIONS");

        return "{"
            + "\"bluetoothScan\":" + btScan + ","
            + "\"bluetoothConnect\":" + btConnect + ","
            + "\"microphone\":" + mic + ","
            + "\"notifications\":" + notif
            + "}";
    }

    private void notifyWebPermissions() {
        if (webView == null) return;
        final String json = buildPermissionsJson();
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(
                    "if(window.onJblPermissionsUpdated){window.onJblPermissionsUpdated(" + json + ");}",
                    null
                );
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_SPEAKER_PERMS) {
            notifyWebPermissions();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_AUDIO_FILE_PICKER && fileUploadCallback != null) {
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            fileUploadCallback.onReceiveValue(results);
            fileUploadCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (receiverRegistered) {
            try {
                unregisterReceiver(quickControlReceiver);
            } catch (Exception ignored) {
            }
            receiverRegistered = false;
        }
        if (hardwareEq != null) {
            try {
                hardwareEq.release();
            } catch (Exception ignored) {
            }
        }
        if (hardwareBass != null) {
            try {
                hardwareBass.release();
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    private String escapeJson(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public class JblAndroidBridge {
        @JavascriptInterface
        public String getPermissionStatusJson() {
            return buildPermissionsJson();
        }

        @JavascriptInterface
        public void requestSpeakerPermissions() {
            if (Build.VERSION.SDK_INT < 23) {
                notifyWebPermissions();
                return;
            }
            List<String> perms = new ArrayList<String>();
            if (Build.VERSION.SDK_INT >= 31) {
                perms.add("android.permission.BLUETOOTH_SCAN");
                perms.add("android.permission.BLUETOOTH_CONNECT");
            } else {
                perms.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
            perms.add(Manifest.permission.RECORD_AUDIO);
            if (Build.VERSION.SDK_INT >= 33) {
                perms.add("android.permission.POST_NOTIFICATIONS");
            }
            requestPermissions(perms.toArray(new String[0]), REQ_SPEAKER_PERMS);
        }

        @JavascriptInterface
        @SuppressLint("MissingPermission")
        public String getPairedSpeakersJson() {
            try {
                if (Build.VERSION.SDK_INT >= 31 && !hasPerm("android.permission.BLUETOOTH_CONNECT")) {
                    return "[]";
                }
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) {
                    return "[]";
                }
                String activeBtName = "";
                if (audioManager != null && Build.VERSION.SDK_INT >= 23) {
                    AudioDeviceInfo[] outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                    for (AudioDeviceInfo info : outputs) {
                        int type = info.getType();
                        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLE_SPEAKER) {
                            CharSequence prod = info.getProductName();
                            if (prod != null) {
                                activeBtName = prod.toString();
                            }
                        }
                    }
                }
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded == null || bonded.isEmpty()) {
                    return "[]";
                }
                StringBuilder sb = new StringBuilder("[");
                boolean first = true;
                for (BluetoothDevice dev : bonded) {
                    String name = dev.getName();
                    if (name == null || name.trim().isEmpty()) {
                        name = "Bluetooth Speaker";
                    }
                    String addr = dev.getAddress() != null ? dev.getAddress() : "";
                    boolean active = !activeBtName.isEmpty() && name.equalsIgnoreCase(activeBtName);
                    if (!first) sb.append(",");
                    first = false;
                    sb.append("{")
                        .append("\"name\":\"").append(escapeJson(name)).append("\",")
                        .append("\"address\":\"").append(escapeJson(addr)).append("\",")
                        .append("\"isActiveAudioRoute\":").append(active)
                        .append("}");
                }
                sb.append("]");
                return sb.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public void openBluetoothSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void setHardwareVolume(int percent) {
            if (audioManager == null) return;
            try {
                int clamped = Math.max(0, Math.min(100, percent));
                int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int target = Math.round((clamped / 100f) * maxVol);
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public int getHardwareVolumePercent() {
            if (audioManager == null) return 68;
            try {
                int cur = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if (max <= 0) return 68;
                return Math.round((cur * 100f) / max);
            } catch (Exception e) {
                return 68;
            }
        }

        @JavascriptInterface
        public void setHardwareEqualizer(String gainsCsv, int bassStrength) {
            try {
                if (hardwareEq == null) {
                    hardwareEq = new Equalizer(0, 0);
                    hardwareEq.setEnabled(true);
                }
                if (hardwareBass == null) {
                    hardwareBass = new BassBoost(0, 0);
                    hardwareBass.setEnabled(true);
                }
                short clampedBass = (short) Math.max(0, Math.min(1000, bassStrength));
                hardwareBass.setStrength(clampedBass);

                if (gainsCsv != null && !gainsCsv.isEmpty()) {
                    String[] parts = gainsCsv.split(",");
                    short bands = hardwareEq.getNumberOfBands();
                    short[] range = hardwareEq.getBandLevelRange();
                    short minMb = range != null && range.length > 0 ? range[0] : -1200;
                    short maxMb = range != null && range.length > 1 ? range[1] : 1200;
                    for (short b = 0; b < bands && b < parts.length; b++) {
                        float db = Float.parseFloat(parts[b].trim());
                        int mb = Math.round(db * 100f);
                        short target = (short) Math.max(minMb, Math.min(maxMb, mb));
                        hardwareEq.setBandLevel(b, target);
                    }
                }
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void showQuickControlNotification(String title, String subtitle, boolean isPlaying, boolean lightEnabled) {
            try {
                if (Build.VERSION.SDK_INT >= 33 && !hasPerm("android.permission.POST_NOTIFICATIONS")) {
                    return;
                }
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                Intent openIntent = new Intent(MainActivity.this, MainActivity.class);
                openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 23) {
                    piFlags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent contentPi = PendingIntent.getActivity(MainActivity.this, 3200, openIntent, piFlags);

                Notification.Builder builder;
                if (Build.VERSION.SDK_INT >= 26) {
                    builder = new Notification.Builder(MainActivity.this, CHANNEL_ID);
                } else {
                    builder = new Notification.Builder(MainActivity.this);
                }

                String playLabel = isPlaying ? "השהה" : "נגן";
                String lightLabel = lightEnabled ? "כבה תאורה" : "הדלק תאורה";

                builder.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
                    .setContentTitle(title != null ? title : "JBL PartyBox Stage 320")
                    .setContentText(subtitle != null ? subtitle : "שליטה מהירה ברמקול")
                    .setContentIntent(contentPi)
                    .setOngoing(false)
                    .setVisibility(Notification.VISIBILITY_PUBLIC)
                    .addAction(android.R.drawable.ic_media_play, playLabel, buildCmdPendingIntent("toggle_play", 3211))
                    .addAction(android.R.drawable.ic_menu_view, "תאורת ניאון", buildCmdPendingIntent("neon_mode", 3212))
                    .addAction(android.R.drawable.ic_menu_manage, lightLabel, buildCmdPendingIntent("toggle_light", 3213));

                nm.notify(NOTIFICATION_ID, builder.build());
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void cancelQuickControlNotification() {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(NOTIFICATION_ID);
                }
            } catch (Exception ignored) {
            }
        }
    }
}
