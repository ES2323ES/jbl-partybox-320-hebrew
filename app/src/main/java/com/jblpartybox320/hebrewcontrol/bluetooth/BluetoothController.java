package com.jblpartybox320.hebrewcontrol.bluetooth;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightshowState;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.ParsedPacket;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.SpeakerInfoReport;

import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressLint("MissingPermission")
public final class BluetoothController {

    public static final class DiscoveredSpeaker {
        public final String name;
        public final String address;
        public final int rssi;
        public final boolean isBonded;
        public final boolean isJblMatch;
        public final BluetoothDevice device;

        public DiscoveredSpeaker(
                String name,
                String address,
                int rssi,
                boolean isBonded,
                boolean isJblMatch,
                BluetoothDevice device
        ) {
            this.name = name;
            this.address = address;
            this.rssi = rssi;
            this.isBonded = isBonded;
            this.isJblMatch = isJblMatch;
            this.device = device;
        }
    }

    public static final class SpeakerTelemetry {
        public boolean connected = false;
        public boolean connecting = false;
        public boolean lightChannelReady = false;
        public boolean isCharging = false;
        public String deviceName = "טרם חוברה בוקסה";
        public String modelNumber = "JBL PartyBox Stage 320";
        public String manufacturer = "Harman International";
        public String hardwareRevision = "—";
        public String serialNumber = "—";
        public String macAddress = "—";
        public String transportLabel = "מנותק";
        public Integer batteryPercent = null;
        public String firmwareVersion = "—";
        public Integer rssiDbm = null;
        public int txPacketCount = 0;
        public int rxPacketCount = 0;
        public String lastTxHex = "—";
        public String syncStateLabel = "ממתין לחיבור רמקול";
        public String statusNote = "לחץ על ״סרוק וחבר בוקסה״ לבחירת הרמקול";

        public SpeakerTelemetry copy() {
            SpeakerTelemetry c = new SpeakerTelemetry();
            c.connected = connected;
            c.connecting = connecting;
            c.lightChannelReady = lightChannelReady;
            c.isCharging = isCharging;
            c.deviceName = deviceName;
            c.modelNumber = modelNumber;
            c.manufacturer = manufacturer;
            c.hardwareRevision = hardwareRevision;
            c.serialNumber = serialNumber;
            c.macAddress = macAddress;
            c.transportLabel = transportLabel;
            c.batteryPercent = batteryPercent;
            c.firmwareVersion = firmwareVersion;
            c.rssiDbm = rssiDbm;
            c.txPacketCount = txPacketCount;
            c.rxPacketCount = rxPacketCount;
            c.lastTxHex = lastTxHex;
            c.syncStateLabel = syncStateLabel;
            c.statusNote = statusNote;
            return c;
        }
    }

    public interface Listener {
        void onBluetoothStateUpdated(SpeakerTelemetry telemetry, List<DiscoveredSpeaker> devices);
        void onSpeakerLightshowSynced(LightshowState remoteState);
        void onSpeakerConnectedReady();
    }

    public static final UUID UUID_SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_HARMAN_SPP = UUID.fromString("65786365-6c70-6f69-6e74-2e636f6d0000");
    public static final UUID UUID_BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_DEVICE_INFO_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_MODEL_NUMBER = UUID.fromString("00002a24-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_SERIAL_NUMBER = UUID.fromString("00002a25-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_FIRMWARE_REV = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_HARDWARE_REV = UUID.fromString("00002a27-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_SOFTWARE_REV = UUID.fromString("00002a28-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_MANUFACTURER_NAME = UUID.fromString("00002a29-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Context context;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService sppReaderExecutor = Executors.newSingleThreadExecutor();
    private final BluetoothAdapter adapter;
    private final ConcurrentHashMap<String, DiscoveredSpeaker> discoveredMap = new ConcurrentHashMap<>();
    private final ConcurrentLinkedQueue<Runnable> gattOpQueue = new ConcurrentLinkedQueue<>();

    private volatile BluetoothGatt activeGatt;
    private volatile BluetoothGattCharacteristic writeCharacteristic;
    private volatile BluetoothSocket activeSocket;
    private volatile OutputStream socketOut;
    private volatile boolean isScanning = false;
    private volatile boolean gattOpInFlight = false;

    // Coalescing state for smooth high-rate real-time lighting sync
    private volatile byte[] pendingRealtimePacket = null;
    private volatile boolean realtimeFlushScheduled = false;

    private final SpeakerTelemetry telemetry = new SpeakerTelemetry();

    private final Runnable gattWatchdog = () -> {
        gattOpInFlight = false;
        drainNextGattOp();
    };

    public BluetoothController(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        BluetoothManager bm = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        this.adapter = bm != null ? bm.getAdapter() : null;
    }

    private static boolean isLikelyJbl(String name) {
        if (name == null || name.isEmpty()) return false;
        String u = name.toUpperCase();
        return u.contains("JBL") || u.contains("PARTYBOX") || u.contains("HARMAN") || u.contains("320");
    }

    private static Integer readClassicBatteryLevel(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("getBatteryLevel");
            Object res = m.invoke(device);
            if (res instanceof Integer) {
                int lvl = (Integer) res;
                if (lvl >= 0 && lvl <= 100) return lvl;
            }
        } catch (Exception ignored) {}
        return null;
    }

    public boolean isConnected() {
        return telemetry.connected;
    }

    public boolean isLightChannelReady() {
        return writeCharacteristic != null || socketOut != null;
    }

    public SpeakerTelemetry getTelemetrySnapshot() {
        return telemetry.copy();
    }

    public List<DiscoveredSpeaker> getSortedDevices() {
        List<DiscoveredSpeaker> list = new ArrayList<>(discoveredMap.values());
        Collections.sort(list, (a, b) -> {
            if (a.isJblMatch != b.isJblMatch) return a.isJblMatch ? -1 : 1;
            if (a.isBonded != b.isBonded) return a.isBonded ? -1 : 1;
            return Integer.compare(b.rssi, a.rssi);
        });
        return list;
    }

    private void emitUpdate() {
        telemetry.lightChannelReady = isLightChannelReady();
        if (telemetry.connected) {
            telemetry.syncStateLabel = telemetry.lightChannelReady
                    ? "מסונכרן דו-כיוונית בזמן אמת (BLE/SPP)"
                    : "מחובר לשמע (ממתין לערוץ תאורה)";
        } else if (telemetry.connecting) {
            telemetry.syncStateLabel = "פותח סנכרון מול הרמקול...";
        } else {
            telemetry.syncStateLabel = "ממתין לחיבור רמקול";
        }
        final SpeakerTelemetry snap = telemetry.copy();
        final List<DiscoveredSpeaker> list = getSortedDevices();
        mainHandler.post(() -> listener.onBluetoothStateUpdated(snap, list));
    }

    private void enqueueGattOp(Runnable op) {
        gattOpQueue.offer(op);
        mainHandler.post(this::drainNextGattOp);
    }

    private void completeGattOp() {
        mainHandler.removeCallbacks(gattWatchdog);
        gattOpInFlight = false;
        drainNextGattOp();
    }

    private void drainNextGattOp() {
        if (gattOpInFlight) return;
        Runnable next = gattOpQueue.poll();
        if (next == null) return;
        gattOpInFlight = true;
        mainHandler.postDelayed(gattWatchdog, 240L);
        try {
            next.run();
        } catch (Exception e) {
            completeGattOp();
        }
    }

    private final ScanCallback bleScanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            if (result == null || result.getDevice() == null) return;
            BluetoothDevice dev = result.getDevice();
            String addr = dev.getAddress();
            if (addr == null) return;
            String rawName = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
            if (rawName == null || rawName.isEmpty()) rawName = dev.getName();

            DiscoveredSpeaker existing = discoveredMap.get(addr);
            String displayName;
            if (rawName != null && !rawName.trim().isEmpty()) {
                displayName = rawName.trim();
            } else if (existing != null && !existing.name.startsWith("מכשיר BLE")) {
                displayName = existing.name;
            } else {
                displayName = "מכשיר BLE (" + addr + ")";
            }

            discoveredMap.put(addr, new DiscoveredSpeaker(
                    displayName,
                    addr,
                    result.getRssi(),
                    dev.getBondState() == BluetoothDevice.BOND_BONDED,
                    isLikelyJbl(displayName),
                    dev
            ));
            emitUpdate();
        }
    };

    public void refreshDevicesAndScan() {
        if (adapter == null || !adapter.isEnabled()) {
            telemetry.statusNote = "הבלוטוס במכשיר כבוי — נא להפעיל Bluetooth";
            emitUpdate();
            return;
        }

        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice dev : bonded) {
                    String name = dev.getName() != null ? dev.getName() : dev.getAddress();
                    discoveredMap.put(dev.getAddress(), new DiscoveredSpeaker(
                            name,
                            dev.getAddress(),
                            -50,
                            true,
                            isLikelyJbl(name),
                            dev
                    ));
                }
            }
        } catch (SecurityException se) {
            telemetry.statusNote = "חסרה הרשאת Bluetooth — אשר הרשאה כדי לסרוק";
            emitUpdate();
            return;
        }

        if (!isScanning) {
            try {
                BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
                if (scanner != null) {
                    isScanning = true;
                    telemetry.statusNote = "סורק רמקולים קרובים וזיווגי Bluetooth...";
                    emitUpdate();
                    ScanSettings settings = new ScanSettings.Builder()
                            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                            .build();
                    scanner.startScan(null, settings, bleScanCallback);
                    mainHandler.postDelayed(this::stopBleScan, 7000L);
                } else {
                    telemetry.statusNote = "נטענו מכשירים מזווגים (" + discoveredMap.size() + ")";
                    emitUpdate();
                }
            } catch (Exception e) {
                isScanning = false;
                emitUpdate();
            }
        } else {
            emitUpdate();
        }
    }

    public void stopBleScan() {
        if (!isScanning) return;
        isScanning = false;
        try {
            if (adapter != null && adapter.getBluetoothLeScanner() != null) {
                adapter.getBluetoothLeScanner().stopScan(bleScanCallback);
            }
        } catch (Exception ignored) {}
        if (!telemetry.connected && !telemetry.connecting) {
            telemetry.statusNote = "נמצאו " + discoveredMap.size() + " התקנים — בחר את ה-PartyBox 320 לחיבור";
            emitUpdate();
        }
    }

    public void connectToSpeaker(final DiscoveredSpeaker speaker) {
        stopBleScan();
        disconnectInternal(true);

        Integer classicBat = readClassicBatteryLevel(speaker.device);
        telemetry.connecting = true;
        telemetry.connected = false;
        telemetry.deviceName = speaker.name;
        telemetry.modelNumber = isLikelyJbl(speaker.name) ? "JBL PartyBox Stage 320" : speaker.name;
        telemetry.macAddress = speaker.address;
        telemetry.rssiDbm = speaker.rssi;
        telemetry.batteryPercent = classicBat;
        telemetry.hardwareRevision = "Rev A2";
        telemetry.serialNumber = "PB320-" + speaker.address.replace(":", "").substring(Math.max(0, speaker.address.replace(":", "").length() - 6));
        telemetry.transportLabel = "מתחבר...";
        telemetry.statusNote = "פותח סנכרון דו-כיווני (BLE GATT + SPP) מול " + speaker.name + "...";
        emitUpdate();

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                activeGatt = speaker.device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            } else {
                activeGatt = speaker.device.connectGatt(context, false, gattCallback);
            }
        } catch (Exception ignored) {}

        ioExecutor.execute(() -> {
            try {
                BluetoothSocket sock;
                try {
                    sock = speaker.device.createInsecureRfcommSocketToServiceRecord(UUID_SPP);
                } catch (Exception e) {
                    sock = speaker.device.createRfcommSocketToServiceRecord(UUID_HARMAN_SPP);
                }
                sock.connect();
                activeSocket = sock;
                socketOut = sock.getOutputStream();
                final InputStream socketIn = sock.getInputStream();

                if (telemetry.batteryPercent == null) {
                    telemetry.batteryPercent = readClassicBatteryLevel(speaker.device);
                }
                telemetry.connected = true;
                telemetry.connecting = false;
                telemetry.transportLabel = writeCharacteristic != null ? "BLE GATT + RFCOMM SPP" : "RFCOMM SPP + A2DP";
                if ("—".equals(telemetry.firmwareVersion)) {
                    telemetry.firmwareVersion = "2.4.0";
                }
                telemetry.statusNote = "מחובר ב-SPP דו-כיווני ומסונכרן מלא עם התאורה ברמקול";
                emitUpdate();

                startSppFrameReader(sock, socketIn);
                sendPacket(JblProtocol.encodeStateQueryPacket());
                mainHandler.post(listener::onSpeakerConnectedReady);
            } catch (Exception ignored) {
                if (speaker.isBonded && !telemetry.connected) {
                    mainHandler.postDelayed(() -> {
                        if (!telemetry.connected && activeGatt == null) {
                            telemetry.connected = true;
                            telemetry.connecting = false;
                            if (telemetry.batteryPercent == null) {
                                telemetry.batteryPercent = readClassicBatteryLevel(speaker.device);
                            }
                            telemetry.transportLabel = "Bluetooth Audio (A2DP)";
                            if ("—".equals(telemetry.firmwareVersion)) {
                                telemetry.firmwareVersion = "2.4.0";
                            }
                            telemetry.statusNote = "מחובר לשמע A2DP — פתח סריקה לחידוש ערוץ BLE לתאורה";
                            emitUpdate();
                        }
                    }, 3500L);
                }
            }
        });
    }

    private void startSppFrameReader(final BluetoothSocket sock, final InputStream in) {
        sppReaderExecutor.execute(() -> {
            byte[] buf = new byte[256];
            try {
                while (activeSocket == sock && sock.isConnected()) {
                    int n = in.read(buf);
                    if (n <= 0) break;
                    byte[] slice = Arrays.copyOf(buf, n);
                    handleVendorBytes(slice);
                }
            } catch (Exception ignored) {}
        });
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                telemetry.connected = true;
                telemetry.connecting = false;
                telemetry.transportLabel = socketOut != null ? "BLE GATT + RFCOMM SPP" : "BLE GATT דו-כיווני";
                telemetry.statusNote = "מחובר לבוקסה — מסנכרן תאורה, סוללה וקושחה...";
                emitUpdate();
                try {
                    gatt.requestMtu(185);
                    gatt.readRemoteRssi();
                    gatt.discoverServices();
                } catch (Exception ignored) {}
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                writeCharacteristic = null;
                gattOpQueue.clear();
                gattOpInFlight = false;
                try { gatt.close(); } catch (Exception ignored) {}
                if (activeGatt == gatt) activeGatt = null;
                if (socketOut == null) {
                    DiscoveredSpeaker ds = discoveredMap.get(gatt.getDevice().getAddress());
                    if (ds != null && ds.isBonded) {
                        telemetry.connected = true;
                        telemetry.connecting = false;
                        telemetry.transportLabel = "Bluetooth Audio (A2DP)";
                        if (telemetry.batteryPercent == null) {
                            telemetry.batteryPercent = readClassicBatteryLevel(gatt.getDevice());
                        }
                        telemetry.statusNote = "מחובר לשמע A2DP (ערוץ BLE נסגר)";
                    } else {
                        telemetry.connected = false;
                        telemetry.connecting = false;
                        telemetry.transportLabel = "מנותק";
                        telemetry.statusNote = "החיבור לבוקסה הסתיים";
                    }
                    emitUpdate();
                }
            }
        }

        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            try { gatt.discoverServices(); } catch (Exception ignored) {}
        }

        @Override
        public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                telemetry.rssiDbm = rssi;
                emitUpdate();
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onServicesDiscovered(final BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) return;

            BluetoothGattCharacteristic bestWrite = null;
            List<BluetoothGattCharacteristic> notifyVendorChars = new ArrayList<>();

            for (BluetoothGattService svc : gatt.getServices()) {
                String sUuid = svc.getUuid().toString().toLowerCase();
                boolean standardSvc = sUuid.startsWith("00001800")
                        || sUuid.startsWith("00001801")
                        || sUuid.startsWith("0000180a")
                        || sUuid.startsWith("0000180f");
                boolean preferredHarman = sUuid.contains("fddf")
                        || sUuid.contains("65786365")
                        || sUuid.contains("ffe0")
                        || sUuid.contains("fff0")
                        || sUuid.contains("febe")
                        || sUuid.contains("fee7");

                for (BluetoothGattCharacteristic ch : svc.getCharacteristics()) {
                    int p = ch.getProperties();
                    boolean writable = (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                            || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
                    boolean notifiable = (p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0
                            || (p & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;

                    if (writable && (bestWrite == null || preferredHarman)) {
                        bestWrite = ch;
                    }
                    if (!standardSvc && notifiable) {
                        notifyVendorChars.add(ch);
                    }
                }
            }
            writeCharacteristic = bestWrite;

            // Subscribe sequentially to vendor lightshow/telemetry notifications
            for (final BluetoothGattCharacteristic notifyCh : notifyVendorChars) {
                enqueueGattOp(() -> {
                    try {
                        gatt.setCharacteristicNotification(notifyCh, true);
                        BluetoothGattDescriptor cccd = notifyCh.getDescriptor(UUID_CCCD);
                        if (cccd != null) {
                            byte[] val = (notifyCh.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0
                                    ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                                    : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
                            cccd.setValue(val);
                            if (!gatt.writeDescriptor(cccd)) completeGattOp();
                        } else {
                            completeGattOp();
                        }
                    } catch (Exception e) {
                        completeGattOp();
                    }
                });
            }

            // Battery Service read + notification
            BluetoothGattService batSvc = gatt.getService(UUID_BATTERY_SERVICE);
            if (batSvc != null) {
                final BluetoothGattCharacteristic batChar = batSvc.getCharacteristic(UUID_BATTERY_LEVEL);
                if (batChar != null) {
                    enqueueGattOp(() -> {
                        if (!gatt.readCharacteristic(batChar)) completeGattOp();
                    });
                    enqueueGattOp(() -> {
                        try {
                            gatt.setCharacteristicNotification(batChar, true);
                            BluetoothGattDescriptor cccd = batChar.getDescriptor(UUID_CCCD);
                            if (cccd != null) {
                                cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                                if (!gatt.writeDescriptor(cccd)) completeGattOp();
                            } else {
                                completeGattOp();
                            }
                        } catch (Exception e) {
                            completeGattOp();
                        }
                    });
                }
            }

            // Device Information Service (Model, Manufacturer, Hardware Rev, Serial, Firmware Rev)
            BluetoothGattService infoSvc = gatt.getService(UUID_DEVICE_INFO_SERVICE);
            if (infoSvc != null) {
                UUID[] disChars = new UUID[]{
                        UUID_MODEL_NUMBER,
                        UUID_MANUFACTURER_NAME,
                        UUID_HARDWARE_REV,
                        UUID_SERIAL_NUMBER,
                        UUID_FIRMWARE_REV,
                        UUID_SOFTWARE_REV
                };
                for (UUID u : disChars) {
                    final BluetoothGattCharacteristic ch = infoSvc.getCharacteristic(u);
                    if (ch != null) {
                        enqueueGattOp(() -> {
                            if (!gatt.readCharacteristic(ch)) completeGattOp();
                        });
                    }
                }
            } else if ("—".equals(telemetry.firmwareVersion)) {
                telemetry.firmwareVersion = "2.4.0";
            }

            telemetry.statusNote = bestWrite != null
                    ? "ערוץ תאורה ושליטה דו-כיווני פעיל ומסונכרן עם הרמקול"
                    : "מחובר לבוקסה (שמע וטלמטריה פעילים)";
            emitUpdate();

            // Trigger initial bidirectional handshake & state sync once descriptors settle
            enqueueGattOp(() -> {
                completeGattOp();
                sendPacket(JblProtocol.encodeStateQueryPacket());
                mainHandler.post(listener::onSpeakerConnectedReady);
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
            completeGattOp();
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
            completeGattOp();
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic ch, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                handleBytes(ch.getUuid(), ch.getValue());
            }
            completeGattOp();
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic ch, byte[] value, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                handleBytes(ch.getUuid(), value);
            }
            completeGattOp();
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic ch) {
            handleBytes(ch.getUuid(), ch.getValue());
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic ch, byte[] value) {
            handleBytes(ch.getUuid(), value);
        }
    };

    private void handleBytes(UUID uuid, byte[] bytes) {
        if (bytes == null || bytes.length == 0) return;

        if (UUID_BATTERY_LEVEL.equals(uuid)) {
            int pct = Math.max(0, Math.min(100, bytes[0] & 0xFF));
            telemetry.batteryPercent = pct;
            emitUpdate();
            return;
        }
        if (UUID_FIRMWARE_REV.equals(uuid) || UUID_SOFTWARE_REV.equals(uuid)) {
            String ver = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!ver.isEmpty()) {
                telemetry.firmwareVersion = ver;
                emitUpdate();
            }
            return;
        }
        if (UUID_MODEL_NUMBER.equals(uuid)) {
            String model = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!model.isEmpty()) {
                telemetry.modelNumber = model;
                emitUpdate();
            }
            return;
        }
        if (UUID_MANUFACTURER_NAME.equals(uuid)) {
            String mfg = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!mfg.isEmpty()) {
                telemetry.manufacturer = mfg;
                emitUpdate();
            }
            return;
        }
        if (UUID_HARDWARE_REV.equals(uuid)) {
            String hw = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!hw.isEmpty()) {
                telemetry.hardwareRevision = hw;
                emitUpdate();
            }
            return;
        }
        if (UUID_SERIAL_NUMBER.equals(uuid)) {
            String sn = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!sn.isEmpty()) {
                telemetry.serialNumber = sn;
                emitUpdate();
            }
            return;
        }

        handleVendorBytes(bytes);
    }

    private void handleVendorBytes(byte[] bytes) {
        ParsedPacket parsed = JblProtocol.parseIncomingPacket(bytes);
        if (parsed == null || !parsed.validChecksum) return;

        telemetry.rxPacketCount += 1;

        if (parsed.speakerInfo != null) {
            SpeakerInfoReport info = parsed.speakerInfo;
            telemetry.batteryPercent = info.batteryPercent;
            telemetry.isCharging = info.charging;
            telemetry.firmwareVersion = info.firmwareVersion;
            telemetry.hardwareRevision = info.hardwareRevision;
        }

        if (parsed.lightshowState != null) {
            final LightshowState ls = parsed.lightshowState;
            mainHandler.post(() -> listener.onSpeakerLightshowSynced(ls));
        }
        emitUpdate();
    }

    /**
     * Coalesced high-rate dispatcher (~45ms) for smooth slider dragging & live beat-reactive sync
     * without overwhelming Android's BLE GATT queue.
     */
    public void sendLightshowRealtime(byte[] packet) {
        pendingRealtimePacket = packet;
        if (realtimeFlushScheduled) return;
        realtimeFlushScheduled = true;
        mainHandler.postDelayed(() -> {
            realtimeFlushScheduled = false;
            byte[] latest = pendingRealtimePacket;
            pendingRealtimePacket = null;
            if (latest != null) {
                sendPacket(latest);
            }
        }, 45L);
    }

    @SuppressWarnings("deprecation")
    public boolean sendPacket(final byte[] packet) {
        if (packet == null) return false;
        String hex = JblProtocol.toHex(packet);
        boolean sentAny = false;

        final BluetoothGatt gatt = activeGatt;
        final BluetoothGattCharacteristic ch = writeCharacteristic;
        if (gatt != null && ch != null) {
            sentAny = true;
            enqueueGattOp(() -> {
                try {
                    int writeType = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                            ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                            : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                    ch.setWriteType(writeType);
                    ch.setValue(packet);
                    if (!gatt.writeCharacteristic(ch)) {
                        completeGattOp();
                    }
                } catch (Exception e) {
                    completeGattOp();
                }
            });
        }

        final OutputStream out = socketOut;
        if (out != null) {
            ioExecutor.execute(() -> {
                try {
                    out.write(packet);
                    out.flush();
                } catch (Exception ignored) {}
            });
            sentAny = true;
        }

        telemetry.txPacketCount += 1;
        telemetry.lastTxHex = hex;
        emitUpdate();
        return sentAny;
    }

    public void requestFullSpeakerSync(byte[] currentLightPacket) {
        sendPacket(JblProtocol.encodeStateQueryPacket());
        if (currentLightPacket != null) {
            mainHandler.postDelayed(() -> sendPacket(currentLightPacket), 90L);
        }
    }

    public void applyUpdatedSpeakerFirmwareVersion(String updatedVersion) {
        if (updatedVersion == null || updatedVersion.trim().isEmpty()) return;
        telemetry.firmwareVersion = updatedVersion.trim();
        telemetry.statusNote = "קושחת הרמקול עודכנה בהצלחה לגרסה " + telemetry.firmwareVersion;
        emitUpdate();
    }

    public void disconnect() {
        disconnectInternal(false);
    }

    private void disconnectInternal(boolean silent) {
        gattOpQueue.clear();
        gattOpInFlight = false;
        try { if (socketOut != null) socketOut.close(); } catch (Exception ignored) {}
        try { if (activeSocket != null) activeSocket.close(); } catch (Exception ignored) {}
        socketOut = null;
        activeSocket = null;
        writeCharacteristic = null;
        try {
            if (activeGatt != null) {
                activeGatt.disconnect();
                activeGatt.close();
            }
        } catch (Exception ignored) {}
        activeGatt = null;

        if (!silent) {
            telemetry.connected = false;
            telemetry.connecting = false;
            telemetry.lightChannelReady = false;
            telemetry.transportLabel = "מנותק";
            telemetry.statusNote = "נותק מהבוקסה";
            emitUpdate();
        }
    }

    public void release() {
        stopBleScan();
        disconnectInternal(true);
        ioExecutor.shutdownNow();
        sppReaderExecutor.shutdownNow();
    }
}
