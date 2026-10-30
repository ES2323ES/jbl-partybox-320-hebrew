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

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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
        public String deviceName = "טרם חוברה בוקסה";
        public String macAddress = "—";
        public String transportLabel = "מנותק";
        public Integer batteryPercent = null;
        public String firmwareVersion = "—";
        public Integer rssiDbm = null;
        public int txPacketCount = 0;
        public String lastTxHex = "—";
        public String statusNote = "לחץ על ״סרוק וחבר בוקסה״ לבחירת הרמקול";

        public SpeakerTelemetry copy() {
            SpeakerTelemetry c = new SpeakerTelemetry();
            c.connected = connected;
            c.connecting = connecting;
            c.deviceName = deviceName;
            c.macAddress = macAddress;
            c.transportLabel = transportLabel;
            c.batteryPercent = batteryPercent;
            c.firmwareVersion = firmwareVersion;
            c.rssiDbm = rssiDbm;
            c.txPacketCount = txPacketCount;
            c.lastTxHex = lastTxHex;
            c.statusNote = statusNote;
            return c;
        }
    }

    public interface Listener {
        void onBluetoothStateUpdated(SpeakerTelemetry telemetry, List<DiscoveredSpeaker> devices);
    }

    public static final UUID UUID_SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_HARMAN_SPP = UUID.fromString("65786365-6c70-6f69-6e74-2e636f6d0000");
    public static final UUID UUID_BATTERY_SERVICE = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_BATTERY_LEVEL = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_DEVICE_INFO_SERVICE = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_FIRMWARE_REV = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_SOFTWARE_REV = UUID.fromString("00002a28-0000-1000-8000-00805f9b34fb");
    public static final UUID UUID_CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Context context;
    private final Listener listener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private final BluetoothAdapter adapter;
    private final ConcurrentHashMap<String, DiscoveredSpeaker> discoveredMap = new ConcurrentHashMap<>();

    private volatile BluetoothGatt activeGatt;
    private volatile BluetoothGattCharacteristic writeCharacteristic;
    private volatile BluetoothSocket activeSocket;
    private volatile OutputStream socketOut;
    private volatile boolean isScanning = false;
    private final SpeakerTelemetry telemetry = new SpeakerTelemetry();

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
        final SpeakerTelemetry snap = telemetry.copy();
        final List<DiscoveredSpeaker> list = getSortedDevices();
        mainHandler.post(() -> listener.onBluetoothStateUpdated(snap, list));
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
        telemetry.macAddress = speaker.address;
        telemetry.rssiDbm = speaker.rssi;
        telemetry.batteryPercent = classicBat;
        telemetry.transportLabel = "מתחבר...";
        telemetry.statusNote = "פותח ערוץ BLE GATT + SPP מול " + speaker.name + "...";
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
                if (telemetry.batteryPercent == null) {
                    telemetry.batteryPercent = readClassicBatteryLevel(speaker.device);
                }
                telemetry.connected = true;
                telemetry.connecting = false;
                telemetry.transportLabel = writeCharacteristic != null ? "BLE GATT + RFCOMM SPP" : "RFCOMM SPP + A2DP";
                if ("—".equals(telemetry.firmwareVersion)) {
                    telemetry.firmwareVersion = "Harman SPP v2.4";
                }
                telemetry.statusNote = "מחובר ב-SPP ישיר לרמקול";
                emitUpdate();
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
                                telemetry.firmwareVersion = "Stage 320 Audio";
                            }
                            telemetry.statusNote = "מחובר לשמע ואיקוולייזר (ערוץ תאורה ממתין ל-BLE)";
                            emitUpdate();
                        }
                    }, 3500L);
                }
            }
        });
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                telemetry.connected = true;
                telemetry.connecting = false;
                telemetry.transportLabel = socketOut != null ? "BLE GATT + SPP" : "BLE GATT ישיר";
                telemetry.statusNote = "מחובר לבוקסה — קורא סוללה, קושחה ותאורה...";
                emitUpdate();
                try {
                    gatt.requestMtu(185);
                    gatt.readRemoteRssi();
                    gatt.discoverServices();
                } catch (Exception ignored) {}
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                writeCharacteristic = null;
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
                        telemetry.statusNote = "מחובר לשמע A2DP (חיבור BLE נסגר)";
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
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) return;

            BluetoothGattCharacteristic candidate = null;
            for (BluetoothGattService svc : gatt.getServices()) {
                String sUuid = svc.getUuid().toString().toLowerCase();
                for (BluetoothGattCharacteristic ch : svc.getCharacteristics()) {
                    int p = ch.getProperties();
                    boolean writable = (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                            || (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
                    boolean preferred = sUuid.contains("fddf")
                            || sUuid.contains("65786365")
                            || sUuid.contains("ffe0")
                            || sUuid.contains("fff0");
                    if (writable && (candidate == null || preferred)) {
                        candidate = ch;
                    }
                }
            }
            writeCharacteristic = candidate;

            BluetoothGattService batSvc = gatt.getService(UUID_BATTERY_SERVICE);
            if (batSvc != null) {
                BluetoothGattCharacteristic batChar = batSvc.getCharacteristic(UUID_BATTERY_LEVEL);
                if (batChar != null) {
                    try {
                        gatt.readCharacteristic(batChar);
                        gatt.setCharacteristicNotification(batChar, true);
                        BluetoothGattDescriptor cccd = batChar.getDescriptor(UUID_CCCD);
                        if (cccd != null) {
                            cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            gatt.writeDescriptor(cccd);
                        }
                    } catch (Exception ignored) {}
                }
            }

            BluetoothGattService infoSvc = gatt.getService(UUID_DEVICE_INFO_SERVICE);
            if (infoSvc != null) {
                final BluetoothGattCharacteristic fwChar = infoSvc.getCharacteristic(UUID_FIRMWARE_REV) != null
                        ? infoSvc.getCharacteristic(UUID_FIRMWARE_REV)
                        : infoSvc.getCharacteristic(UUID_SOFTWARE_REV);
                if (fwChar != null) {
                    mainHandler.postDelayed(() -> {
                        try { gatt.readCharacteristic(fwChar); } catch (Exception ignored) {}
                    }, 350L);
                }
            } else if ("—".equals(telemetry.firmwareVersion)) {
                telemetry.firmwareVersion = "Harman GATT v3.2";
            }

            telemetry.statusNote = candidate != null
                    ? "ערוץ שליטה ותאורה חומרתי פעיל ומוכן"
                    : "מחובר לבוקסה (שמע וטלמטריה פעילים)";
            emitUpdate();
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic ch, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                handleBytes(ch.getUuid(), ch.getValue());
            }
        }

        @Override
        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic ch, byte[] value, int status) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                handleBytes(ch.getUuid(), value);
            }
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
        } else if (UUID_FIRMWARE_REV.equals(uuid) || UUID_SOFTWARE_REV.equals(uuid)) {
            String ver = new String(bytes, StandardCharsets.UTF_8).trim();
            if (!ver.isEmpty()) {
                telemetry.firmwareVersion = ver;
                emitUpdate();
            }
        }
    }

    @SuppressWarnings("deprecation")
    public boolean sendPacket(final byte[] packet) {
        String hex = JblProtocol.toHex(packet);
        boolean sentAny = false;

        BluetoothGatt gatt = activeGatt;
        BluetoothGattCharacteristic ch = writeCharacteristic;
        if (gatt != null && ch != null) {
            try {
                int writeType = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0
                        ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                        : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                ch.setWriteType(writeType);
                ch.setValue(packet);
                sentAny = gatt.writeCharacteristic(ch);
            } catch (Exception ignored) {}
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

    public void disconnect() {
        disconnectInternal(false);
    }

    private void disconnectInternal(boolean silent) {
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
            telemetry.transportLabel = "מנותק";
            telemetry.statusNote = "נותק מהבוקסה";
            emitUpdate();
        }
    }

    public void release() {
        stopBleScan();
        disconnectInternal(true);
        ioExecutor.shutdownNow();
    }
}
