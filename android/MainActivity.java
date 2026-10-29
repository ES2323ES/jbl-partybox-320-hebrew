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
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.Visualizer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_SPEAKER_PERMS = 3201;
    private static final int REQ_SETTINGS_BACKUP_PICKER = 3202;
    private static final int NOTIFICATION_ID = 3200;
    private static final String CHANNEL_ID = "jbl_partybox_quick_controls";
    private static final String ACTION_QUICK_CMD = "com.jblpartybox320.hebrewcontrol.QUICK_CMD";
    private static final String EXTRA_CMD = "cmd";

    private static final UUID UUID_SPP_STANDARD = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final UUID UUID_HARMAN_CONTROL = UUID.fromString("65786365-6c70-6f69-6e74-2e636f6d0000");
    private static final UUID UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private WebView webView;
    private AudioManager audioManager;
    private Equalizer hardwareEq;
    private BassBoost hardwareBass;
    private Visualizer masterVisualizer;
    private final float[] latestFftBins = new float[28];
    private volatile boolean visualizerActive = false;
    private int savedVolumeBeforeMute = 72;

    // Physical JBL Speaker Lighting Control Channels (BLE GATT + Classic RFCOMM SPP)
    private final ExecutorService txExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile BluetoothGatt activeGatt;
    private volatile boolean bleGattConnected = false;
    private final List<BluetoothGattCharacteristic> writableGattChars =
        Collections.synchronizedList(new ArrayList<BluetoothGattCharacteristic>());
    private volatile BluetoothSocket activeSppSocket;
    private volatile OutputStream sppOutputStream;
    private volatile boolean sppConnected = false;
    private volatile String lastLightingError = null;
    private BluetoothLeScanner activeLeScanner;
    private boolean leScanning = false;

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
        String baseUa = ws.getUserAgentString() != null ? ws.getUserAgentString() : "";
        ws.setUserAgentString(baseUa + " JBLPartyBox320AndroidAPK/0.2.4");

        webView.addJavascriptInterface(new JblAndroidBridge(), "JblAndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null) {
                    String scheme = request.getUrl().getScheme();
                    if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                        openExternalBrowser(request.getUrl().toString());
                        return true;
                    }
                }
                return false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    openExternalBrowser(url);
                    return true;
                }
                return false;
            }
        });
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(
                String url,
                String userAgent,
                String contentDisposition,
                String mimetype,
                long contentLength
            ) {
                openExternalBrowser(url);
            }
        });
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
                    startActivityForResult(pickerIntent, REQ_SETTINGS_BACKUP_PICKER);
                    return true;
                } catch (Exception e) {
                    fileUploadCallback = null;
                    return false;
                }
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/www/index.html");

        if (hasPerm(Manifest.permission.RECORD_AUDIO)) {
            initMasterVisualizer();
        }
    }

    private void openExternalBrowser(String url) {
        if (url == null || url.isEmpty()) return;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
        }
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

    private boolean isJblDeviceName(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.US);
        return lower.contains("jbl")
            || lower.contains("partybox")
            || lower.contains("stage 320")
            || lower.contains("320")
            || lower.contains("harman");
    }

    private int scoreCharacteristicUuid(String svcUuid, String charUuid, int props) {
        boolean canWriteNoResp = (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        boolean canWrite = (props & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        if (!canWriteNoResp && !canWrite) return 0;

        String s = svcUuid != null ? svcUuid.toLowerCase(Locale.US) : "";
        String c = charUuid != null ? charUuid.toLowerCase(Locale.US) : "";
        if (s.startsWith("00001800") || s.startsWith("00001801") || s.startsWith("0000180a") || s.startsWith("0000180f")) {
            return 0;
        }
        int score = canWriteNoResp ? 45 : 30;
        if (s.contains("fddf") || s.contains("febe") || s.startsWith("65786365")) score += 65;
        if (c.startsWith("65786365") || c.contains("fddf") || c.contains("ff01") || c.contains("ffe1") || c.startsWith("6e400002")) {
            score += 50;
        }
        return score;
    }

    private String bytesToHex(byte[] data) {
        if (data == null || data.length == 0) return "";
        StringBuilder sb = new StringBuilder(data.length * 3);
        for (int i = 0; i < data.length; i++) {
            if (i > 0) sb.append(' ');
            sb.append(String.format(Locale.US, "%02X", data[i] & 0xFF));
        }
        return sb.toString();
    }

    private byte[] hexToBytes(String hex) {
        if (hex == null) return new byte[0];
        String clean = hex.replaceAll("[^0-9A-Fa-f]", "");
        int len = clean.length();
        if (len < 2) return new byte[0];
        int pairs = len / 2;
        byte[] out = new byte[pairs];
        for (int i = 0; i < pairs; i++) {
            int hi = Character.digit(clean.charAt(i * 2), 16);
            int lo = Character.digit(clean.charAt(i * 2 + 1), 16);
            out[i] = (byte) ((hi << 4) + lo);
        }
        return out;
    }

    private void emitLightingEventToWeb(final String message, final String ackHex, final String error) {
        if (webView == null) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                StringBuilder json = new StringBuilder("{");
                boolean first = true;
                if (message != null) {
                    json.append("\"message\":\"").append(escapeJson(message)).append("\"");
                    first = false;
                }
                if (ackHex != null) {
                    if (!first) json.append(",");
                    json.append("\"ackHex\":\"").append(escapeJson(ackHex)).append("\"");
                    first = false;
                }
                if (error != null) {
                    if (!first) json.append(",");
                    json.append("\"error\":\"").append(escapeJson(error)).append("\"");
                }
                json.append("}");
                String payloadQuoted = "'" + json.toString().replace("'", "\\'") + "'";
                webView.evaluateJavascript(
                    "if(window.onJblLightingChannelEvent){window.onJblLightingChannelEvent(" + payloadQuoted + ");}",
                    null
                );
            }
        });
    }

    /**
     * Attaches Android Visualizer to Audio Session 0 (Master System Output Mix) so any song playing
     * in Spotify, YouTube Music, Apple Music, Samsung Music, etc. drives live 28-bar FFT & beat-sync
     * with ZERO song uploads required!
     */
    private synchronized void initMasterVisualizer() {
        if (visualizerActive && masterVisualizer != null) {
            return;
        }
        if (!hasPerm(Manifest.permission.RECORD_AUDIO)) {
            return;
        }
        try {
            if (masterVisualizer != null) {
                try {
                    masterVisualizer.setEnabled(false);
                    masterVisualizer.release();
                } catch (Exception ignored) {
                }
                masterVisualizer = null;
            }
            masterVisualizer = new Visualizer(0);
            int[] sizes = Visualizer.getCaptureSizeRange();
            int captureSize = 256;
            if (sizes != null && sizes.length >= 2) {
                captureSize = Math.max(sizes[0], Math.min(256, sizes[1]));
            }
            masterVisualizer.setCaptureSize(captureSize);
            masterVisualizer.setDataCaptureListener(
                new Visualizer.OnDataCaptureListener() {
                    @Override
                    public void onWaveFormDataCapture(Visualizer visualizer, byte[] waveform, int samplingRate) {
                    }

                    @Override
                    public void onFftDataCapture(Visualizer visualizer, byte[] fft, int samplingRate) {
                        if (fft == null || fft.length < 8) return;
                        int halfPairs = (fft.length / 2) - 1;
                        if (halfPairs <= 0) return;
                        synchronized (latestFftBins) {
                            for (int b = 0; b < 28; b++) {
                                int pairIdx = Math.min(halfPairs, 1 + (b * halfPairs) / 28);
                                int r = fft[pairIdx * 2];
                                int im = fft[pairIdx * 2 + 1];
                                double mag = Math.hypot(r, im);
                                float norm = (float) Math.min(1.0, Math.log10(1.0 + mag) / 2.05);
                                latestFftBins[b] = latestFftBins[b] * 0.35f + norm * 0.65f;
                            }
                        }
                    }
                },
                Visualizer.getMaxCaptureRate() / 2,
                false,
                true
            );
            masterVisualizer.setEnabled(true);
            visualizerActive = true;
        } catch (Exception e) {
            visualizerActive = false;
        }
    }

    @SuppressLint("MissingPermission")
    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                bleGattConnected = true;
                lastLightingError = null;
                try {
                    gatt.discoverServices();
                } catch (Exception ignored) {
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                bleGattConnected = false;
                writableGattChars.clear();
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) return;
            List<BluetoothGattCharacteristic> candidates = new ArrayList<BluetoothGattCharacteristic>();
            List<BluetoothGattService> services = gatt.getServices();
            if (services != null) {
                for (BluetoothGattService svc : services) {
                    final String sUuid = svc.getUuid() != null ? svc.getUuid().toString() : "";
                    List<BluetoothGattCharacteristic> chars = svc.getCharacteristics();
                    if (chars == null) continue;
                    for (BluetoothGattCharacteristic ch : chars) {
                        int props = ch.getProperties();
                        if ((props & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                            try {
                                gatt.setCharacteristicNotification(ch, true);
                                BluetoothGattDescriptor cccd = ch.getDescriptor(UUID_CCCD);
                                if (cccd != null) {
                                    cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                                    gatt.writeDescriptor(cccd);
                                }
                            } catch (Exception ignored) {
                            }
                        }
                        String cUuid = ch.getUuid() != null ? ch.getUuid().toString() : "";
                        if (scoreCharacteristicUuid(sUuid, cUuid, props) > 0) {
                            candidates.add(ch);
                        }
                    }
                }
            }

            Collections.sort(candidates, new Comparator<BluetoothGattCharacteristic>() {
                @Override
                public int compare(BluetoothGattCharacteristic a, BluetoothGattCharacteristic b) {
                    String sa = a.getService() != null && a.getService().getUuid() != null ? a.getService().getUuid().toString() : "";
                    String sb = b.getService() != null && b.getService().getUuid() != null ? b.getService().getUuid().toString() : "";
                    String ca = a.getUuid() != null ? a.getUuid().toString() : "";
                    String cb = b.getUuid() != null ? b.getUuid().toString() : "";
                    return scoreCharacteristicUuid(sb, cb, b.getProperties())
                        - scoreCharacteristicUuid(sa, ca, a.getProperties());
                }
            });

            writableGattChars.clear();
            writableGattChars.addAll(candidates);

            if (!candidates.isEmpty()) {
                emitLightingEventToWeb(
                    "ערוץ BLE GATT לתאורת הרמקול מוכן (" + candidates.size() + " ערוצים פעילים)",
                    null,
                    null
                );
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            byte[] val = characteristic.getValue();
            if (val != null && val.length > 0) {
                emitLightingEventToWeb(null, bytesToHex(val), null);
            }
        }
    };

    @SuppressLint("MissingPermission")
    private void connectDeviceDualChannels(final BluetoothDevice device) {
        if (device == null) return;

        // 1. Open BLE GATT Control Channel
        try {
            if (activeGatt != null) {
                try {
                    activeGatt.disconnect();
                    activeGatt.close();
                } catch (Exception ignored) {
                }
                activeGatt = null;
            }
            if (Build.VERSION.SDK_INT >= 23) {
                activeGatt = device.connectGatt(MainActivity.this, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                activeGatt = device.connectGatt(MainActivity.this, false, gattCallback);
            }
        } catch (Exception e) {
            lastLightingError = e.getMessage();
        }

        // 2. Open Classic RFCOMM SPP Control Channel in background executor
        txExecutor.execute(new Runnable() {
            @Override
            public void run() {
                closeSppSocketQuietly();
                UUID[] tryUuids = new UUID[]{UUID_SPP_STANDARD, UUID_HARMAN_CONTROL};
                for (UUID uuid : tryUuids) {
                    try {
                        BluetoothSocket sock = device.createInsecureRfcommSocketToServiceRecord(uuid);
                        sock.connect();
                        activeSppSocket = sock;
                        sppOutputStream = sock.getOutputStream();
                        sppConnected = true;
                        lastLightingError = null;
                        emitLightingEventToWeb(
                            "ערוץ תאורה מהיר RFCOMM SPP נפתח מול " + (device.getName() != null ? device.getName() : "הרמקול"),
                            null,
                            null
                        );
                        return;
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    @SuppressLint("MissingPermission")
    private void startShortBleScanForJbl() {
        if (leScanning) return;
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null || !adapter.isEnabled()) return;
        activeLeScanner = adapter.getBluetoothLeScanner();
        if (activeLeScanner == null) return;

        leScanning = true;
        final ScanCallback cb = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                if (result == null || result.getDevice() == null) return;
                BluetoothDevice dev = result.getDevice();
                String name = dev.getName();
                if (isJblDeviceName(name)) {
                    stopBleScanQuietly(this);
                    connectDeviceDualChannels(dev);
                }
            }
        };

        try {
            ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();
            activeLeScanner.startScan(null, settings, cb);
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    stopBleScanQuietly(cb);
                }
            }, 6500);
        } catch (Exception e) {
            leScanning = false;
        }
    }

    @SuppressLint("MissingPermission")
    private void stopBleScanQuietly(ScanCallback cb) {
        if (!leScanning) return;
        leScanning = false;
        try {
            if (activeLeScanner != null && cb != null) {
                activeLeScanner.stopScan(cb);
            }
        } catch (Exception ignored) {
        }
    }

    private void closeSppSocketQuietly() {
        sppConnected = false;
        try {
            if (sppOutputStream != null) sppOutputStream.close();
        } catch (Exception ignored) {
        }
        sppOutputStream = null;
        try {
            if (activeSppSocket != null) activeSppSocket.close();
        } catch (Exception ignored) {
        }
        activeSppSocket = null;
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
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        boolean btEnabled = adapter != null && adapter.isEnabled();

        return "{"
            + "\"bluetoothScan\":" + btScan + ","
            + "\"bluetoothConnect\":" + btConnect + ","
            + "\"microphone\":" + mic + ","
            + "\"notifications\":" + notif + ","
            + "\"bluetoothEnabled\":" + btEnabled
            + "}";
    }

    private void notifyWebPermissions() {
        if (webView == null) return;
        final String json = buildPermissionsJson();
        final String quoted = "'" + json.replace("'", "\\'") + "'";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                webView.evaluateJavascript(
                    "if(window.onJblPermissionsUpdated){window.onJblPermissionsUpdated(" + quoted + ");}",
                    null
                );
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_SPEAKER_PERMS) {
            if (hasPerm(Manifest.permission.RECORD_AUDIO)) {
                initMasterVisualizer();
            }
            notifyWebPermissions();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SETTINGS_BACKUP_PICKER && fileUploadCallback != null) {
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

    @SuppressLint("MissingPermission")
    @Override
    protected void onDestroy() {
        if (receiverRegistered) {
            try {
                unregisterReceiver(quickControlReceiver);
            } catch (Exception ignored) {
            }
            receiverRegistered = false;
        }
        closeSppSocketQuietly();
        if (activeGatt != null) {
            try {
                activeGatt.disconnect();
                activeGatt.close();
            } catch (Exception ignored) {
            }
            activeGatt = null;
        }
        if (masterVisualizer != null) {
            try {
                masterVisualizer.setEnabled(false);
                masterVisualizer.release();
            } catch (Exception ignored) {
            }
            masterVisualizer = null;
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
        txExecutor.shutdownNow();
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
                initMasterVisualizer();
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
                    boolean isJbl = isJblDeviceName(name);
                    if (!first) sb.append(",");
                    first = false;
                    sb.append("{")
                        .append("\"name\":\"").append(escapeJson(name)).append("\",")
                        .append("\"address\":\"").append(escapeJson(addr)).append("\",")
                        .append("\"isJbl\":").append(isJbl).append(",")
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
        @SuppressLint("MissingPermission")
        public String connectSpeakerControlChannel(String addressOrName) {
            try {
                if (Build.VERSION.SDK_INT >= 31 && !hasPerm("android.permission.BLUETOOTH_CONNECT")) {
                    return "{\"ok\":false,\"message\":\"חסרה הרשאת Bluetooth למכשירים קרובים.\"}";
                }
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) {
                    return "{\"ok\":false,\"message\":\"ה-Bluetooth במכשיר כבוי — הדלק Bluetooth ונסה שוב.\"}";
                }

                BluetoothDevice target = null;
                Set<BluetoothDevice> bonded = adapter.getBondedDevices();
                if (bonded != null && addressOrName != null && !"SCAN_JBL_BLE".equals(addressOrName)) {
                    for (BluetoothDevice dev : bonded) {
                        String addr = dev.getAddress() != null ? dev.getAddress() : "";
                        String name = dev.getName() != null ? dev.getName() : "";
                        if (addr.equalsIgnoreCase(addressOrName) || name.equalsIgnoreCase(addressOrName)) {
                            target = dev;
                            break;
                        }
                    }
                }
                if (target == null && bonded != null) {
                    for (BluetoothDevice dev : bonded) {
                        if (isJblDeviceName(dev.getName())) {
                            target = dev;
                            break;
                        }
                    }
                }

                if (target != null) {
                    connectDeviceDualChannels(target);
                    startShortBleScanForJbl();
                    String title = target.getName() != null ? target.getName() : "JBL PartyBox 320";
                    return "{\"ok\":true,\"message\":\"נפתחו ערוצי בקרת תאורה (BLE GATT + SPP) ושמע מול "
                        + escapeJson(title) + "!\"}";
                }

                startShortBleScanForJbl();
                return "{\"ok\":true,\"message\":\"מבצע סריקת BLE מהירה לאיתור ערוץ התאורה של JBL PartyBox 320...\"}";
            } catch (Exception e) {
                return "{\"ok\":false,\"message\":\"שגיאה בפתיחת ערוץ תאורה: " + escapeJson(e.getMessage()) + "\"}";
            }
        }

        @JavascriptInterface
        @SuppressLint("MissingPermission")
        public void disconnectSpeakerControlChannel() {
            closeSppSocketQuietly();
            writableGattChars.clear();
            bleGattConnected = false;
            if (activeGatt != null) {
                try {
                    activeGatt.disconnect();
                    activeGatt.close();
                } catch (Exception ignored) {
                }
                activeGatt = null;
            }
        }

        @JavascriptInterface
        @SuppressLint("MissingPermission")
        public boolean sendLightingHexPayload(final String hexPayload) {
            final byte[] packet = hexToBytes(hexPayload);
            if (packet.length == 0) return false;

            final boolean hasChannel = sppConnected || (bleGattConnected && !writableGattChars.isEmpty());
            if (!hasChannel) {
                return false;
            }

            txExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    // 1. Send via RFCOMM SPP if open
                    if (sppConnected && sppOutputStream != null) {
                        try {
                            sppOutputStream.write(packet);
                            sppOutputStream.flush();
                        } catch (Exception e) {
                            lastLightingError = e.getMessage();
                            closeSppSocketQuietly();
                        }
                    }

                    // 2. Send via top BLE GATT writable characteristics
                    if (bleGattConnected && activeGatt != null && !writableGattChars.isEmpty()) {
                        int count = Math.min(2, writableGattChars.size());
                        for (int i = 0; i < count; i++) {
                            try {
                                BluetoothGattCharacteristic ch = writableGattChars.get(i);
                                int props = ch.getProperties();
                                int writeType = (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                                    ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                                    : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                                ch.setWriteType(writeType);
                                ch.setValue(packet);
                                activeGatt.writeCharacteristic(ch);
                            } catch (Exception e) {
                                lastLightingError = e.getMessage();
                            }
                        }
                    }
                }
            });

            return true;
        }

        @JavascriptInterface
        public String getLightingChannelStatusJson() {
            boolean bleReady = bleGattConnected && !writableGattChars.isEmpty();
            String charUuid = "";
            if (!writableGattChars.isEmpty()) {
                BluetoothGattCharacteristic first = writableGattChars.get(0);
                if (first != null && first.getUuid() != null) {
                    charUuid = first.getUuid().toString();
                }
            }
            return "{"
                + "\"bleConnected\":" + bleReady + ","
                + "\"sppConnected\":" + sppConnected + ","
                + "\"writableCount\":" + writableGattChars.size() + ","
                + "\"charUuid\":\"" + escapeJson(charUuid) + "\","
                + "\"lastError\":" + (lastLightingError != null ? "\"" + escapeJson(lastLightingError) + "\"" : "null")
                + "}";
        }

        @JavascriptInterface
        public String getExternalPlayerStateJson() {
            if (!visualizerActive && hasPerm(Manifest.permission.RECORD_AUDIO)) {
                initMasterVisualizer();
            }
            boolean musicActive = audioManager != null && audioManager.isMusicActive();
            boolean a2dp = false;
            String routeName = "";
            if (audioManager != null && Build.VERSION.SDK_INT >= 23) {
                AudioDeviceInfo[] outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
                for (AudioDeviceInfo info : outputs) {
                    int type = info.getType();
                    if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLE_SPEAKER) {
                        a2dp = true;
                        if (info.getProductName() != null) {
                            routeName = info.getProductName().toString();
                        }
                    }
                }
            }
            return "{"
                + "\"isMusicActive\":" + musicActive + ","
                + "\"bluetoothA2dpActive\":" + a2dp + ","
                + "\"activeRouteName\":\"" + escapeJson(routeName) + "\","
                + "\"volumePercent\":" + getHardwareVolumePercent() + ","
                + "\"visualizerAvailable\":" + visualizerActive
                + "}";
        }

        @JavascriptInterface
        public String getSystemAudioFftJson() {
            if (!visualizerActive && hasPerm(Manifest.permission.RECORD_AUDIO)) {
                initMasterVisualizer();
            }
            if (!visualizerActive) {
                return "[]";
            }
            StringBuilder sb = new StringBuilder("[");
            synchronized (latestFftBins) {
                for (int i = 0; i < latestFftBins.length; i++) {
                    if (i > 0) sb.append(",");
                    sb.append(String.format(Locale.US, "%.3f", latestFftBins[i]));
                }
            }
            sb.append("]");
            return sb.toString();
        }

        @JavascriptInterface
        public boolean sendMediaKey(String action) {
            if (audioManager == null || action == null) return false;
            int keyCode = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            if ("next".equalsIgnoreCase(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_NEXT;
            } else if ("previous".equalsIgnoreCase(action)) {
                keyCode = KeyEvent.KEYCODE_MEDIA_PREVIOUS;
            }
            try {
                long now = SystemClock.uptimeMillis();
                KeyEvent down = new KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0);
                KeyEvent up = new KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0);
                audioManager.dispatchMediaKeyEvent(down);
                audioManager.dispatchMediaKeyEvent(up);
                return true;
            } catch (Exception e) {
                return false;
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
        public void setHardwareVolume(int percent, boolean muted) {
            if (audioManager == null) return;
            try {
                int clamped = Math.max(0, Math.min(100, percent));
                if (!muted && clamped > 0) {
                    savedVolumeBeforeMute = clamped;
                }
                int maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int target = muted ? 0 : Math.round(((clamped > 0 ? clamped : savedVolumeBeforeMute) / 100f) * maxVol);
                audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public void setHardwareVolume(int percent) {
            setHardwareVolume(percent, false);
        }

        @JavascriptInterface
        public int getHardwareVolumePercent() {
            if (audioManager == null) return 72;
            try {
                int cur = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
                int max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                if (max <= 0) return 72;
                return Math.round((cur * 100f) / max);
            } catch (Exception e) {
                return 72;
            }
        }

        @JavascriptInterface
        public void setHardwareEqualizer(String gainsJsonOrCsv, int bassStrength) {
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

                if (gainsJsonOrCsv != null && !gainsJsonOrCsv.isEmpty()) {
                    String cleaned = gainsJsonOrCsv.replace("[", "").replace("]", "").trim();
                    if (!cleaned.isEmpty()) {
                        String[] parts = cleaned.split(",");
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

                String playLabel = isPlaying ? "השהה נגן" : "נגן";
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
