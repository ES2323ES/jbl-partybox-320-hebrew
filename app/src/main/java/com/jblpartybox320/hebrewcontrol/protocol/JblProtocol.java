package com.jblpartybox320.hebrewcontrol.protocol;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class JblProtocol {
    public static final byte HEADER_HARMAN = (byte) 0xAA;
    public static final byte CMD_STATE_QUERY = 0x30;
    public static final byte CMD_LIGHTSHOW = 0x31;
    public static final byte CMD_EQUALIZER = 0x32;
    public static final byte CMD_SYSTEM_SETTINGS = 0x33;
    public static final byte CMD_SOUND_TONES = 0x34;
    public static final byte CMD_SPEAKER_INFO = 0x35;
    public static final byte CMD_LIGHT_PULSE = 0x36;

    // Portable Speaker OTA Firmware Update (DFU) Commands
    public static final byte CMD_DFU_BEGIN = 0x40;
    public static final byte CMD_DFU_CHUNK = 0x41;
    public static final byte CMD_DFU_VERIFY = 0x42;
    public static final byte CMD_DFU_APPLY = 0x43;

    public enum LightPreset {
        NEON(0x06, "ניאון"),
        ROCK(0x01, "רוק"),
        FLOW(0x02, "זרימה"),
        CROSS(0x03, "הצלבה"),
        RIPPLE(0x04, "אדווה"),
        FLASH(0x05, "הבזק"),
        FREEZE(0x07, "קפיאה");

        public final int code;
        public final String titleHe;

        LightPreset(int code, String titleHe) {
            this.code = code;
            this.titleHe = titleHe;
        }

        public static LightPreset fromCode(int code) {
            for (LightPreset lp : values()) {
                if (lp.code == code) return lp;
            }
            return NEON;
        }
    }

    public enum BassMode {
        OFF(0, "כבוי"),
        DEEP(1, "עמוק (Deep)"),
        PUNCHY(2, "חד (Punchy)");

        public final int code;
        public final String titleHe;

        BassMode(int code, String titleHe) {
            this.code = code;
            this.titleHe = titleHe;
        }
    }

    public enum ProtocolMode {
        AUTO_DUAL("auto", "אוטומטי כפול (BLE + SPP)"),
        HARMAN_AA("harman_aa", "מסגרת Harman 0xAA"),
        GATT_RAW("gatt_raw", "פקודת GATT ישירה");

        public final String id;
        public final String titleHe;

        ProtocolMode(String id, String titleHe) {
            this.id = id;
            this.titleHe = titleHe;
        }
    }

    public static final class LightshowState {
        public final boolean enabled;
        public final LightPreset preset;
        public final int zoneMask;
        public final int brightness;
        public final int speedTenths;
        public final String primaryHex;
        public final String secondaryHex;
        public final boolean beatSync;

        public LightshowState(
                boolean enabled,
                LightPreset preset,
                int zoneMask,
                int brightness,
                int speedTenths,
                String primaryHex,
                String secondaryHex,
                boolean beatSync
        ) {
            this.enabled = enabled;
            this.preset = preset;
            this.zoneMask = zoneMask & 0x1F;
            this.brightness = clamp(brightness, 0, 100);
            this.speedTenths = clamp(speedTenths, 5, 20);
            this.primaryHex = primaryHex;
            this.secondaryHex = secondaryHex;
            this.beatSync = beatSync;
        }
    }

    public static final class SpeakerInfoReport {
        public final int batteryPercent;
        public final boolean charging;
        public final String firmwareVersion;
        public final String hardwareRevision;

        public SpeakerInfoReport(
                int batteryPercent,
                boolean charging,
                String firmwareVersion,
                String hardwareRevision
        ) {
            this.batteryPercent = clamp(batteryPercent, 0, 100);
            this.charging = charging;
            this.firmwareVersion = firmwareVersion;
            this.hardwareRevision = hardwareRevision;
        }
    }

    public static final class ParsedPacket {
        public final byte commandId;
        public final boolean validChecksum;
        public final LightshowState lightshowState;
        public final SpeakerInfoReport speakerInfo;

        public ParsedPacket(
                byte commandId,
                boolean validChecksum,
                LightshowState lightshowState,
                SpeakerInfoReport speakerInfo
        ) {
            this.commandId = commandId;
            this.validChecksum = validChecksum;
            this.lightshowState = lightshowState;
            this.speakerInfo = speakerInfo;
        }
    }

    private JblProtocol() {}

    public static int[] parseHexColor(String hex) {
        if (hex == null) return new int[]{255, 90, 31};
        String clean = hex.trim();
        if (clean.startsWith("#")) clean = clean.substring(1);
        if (clean.length() != 6) return new int[]{255, 90, 31};
        try {
            int r = clamp(Integer.parseInt(clean.substring(0, 2), 16), 0, 255);
            int g = clamp(Integer.parseInt(clean.substring(2, 4), 16), 0, 255);
            int b = clamp(Integer.parseInt(clean.substring(4, 6), 16), 0, 255);
            return new int[]{r, g, b};
        } catch (Exception e) {
            return new int[]{255, 90, 31};
        }
    }

    public static String rgbToHex(int r, int g, int b) {
        return String.format(
                Locale.US,
                "#%02X%02X%02X",
                clamp(r, 0, 255),
                clamp(g, 0, 255),
                clamp(b, 0, 255)
        );
    }

    public static byte computeXorChecksum(byte[] bytes, int length) {
        int xor = 0;
        for (int i = 0; i < length; i++) {
            xor ^= (bytes[i] & 0xFF);
        }
        return (byte) (xor & 0xFF);
    }

    public static byte[] wrapHarmanFrame(byte commandId, byte[] payload) {
        byte[] frame = new byte[3 + payload.length + 1];
        frame[0] = HEADER_HARMAN;
        frame[1] = commandId;
        frame[2] = (byte) (payload.length & 0xFF);
        System.arraycopy(payload, 0, frame, 3, payload.length);
        frame[frame.length - 1] = computeXorChecksum(frame, frame.length - 1);
        return frame;
    }

    public static byte[] encodeStateQueryPacket() {
        return wrapHarmanFrame(CMD_STATE_QUERY, new byte[]{0x01, 0x1F});
    }

    public static byte[] encodeLightshowPacket(
            boolean enabled,
            LightPreset preset,
            int zoneMask,
            int brightness,
            int speedTenths,
            String primaryHex,
            String secondaryHex,
            boolean beatSync,
            boolean rawMode
    ) {
        int[] c1 = parseHexColor(primaryHex);
        int[] c2 = parseHexColor(secondaryHex);
        byte[] payload = new byte[]{
                (byte) (enabled ? 0x01 : 0x00),
                (byte) preset.code,
                (byte) (zoneMask & 0x1F),
                (byte) clamp(brightness, 0, 100),
                (byte) clamp(speedTenths, 5, 20),
                (byte) 35,
                (byte) c1[0],
                (byte) c1[1],
                (byte) c1[2],
                (byte) c2[0],
                (byte) c2[1],
                (byte) c2[2],
                (byte) (beatSync ? 0x01 : 0x00)
        };
        return rawMode ? payload : wrapHarmanFrame(CMD_LIGHTSHOW, payload);
    }

    public static byte[] encodeLightBeatPulsePacket(
            int energyPercent,
            int bassEnergyPercent,
            String accentHex,
            int zoneMask
    ) {
        int[] rgb = parseHexColor(accentHex);
        byte[] payload = new byte[]{
                (byte) clamp(energyPercent, 0, 100),
                (byte) clamp(bassEnergyPercent, 0, 100),
                (byte) (zoneMask & 0x1F),
                (byte) rgb[0],
                (byte) rgb[1],
                (byte) rgb[2]
        };
        return wrapHarmanFrame(CMD_LIGHT_PULSE, payload);
    }

    public static byte[] encodeEqualizerPacket(
            float[] gainsDb,
            BassMode bassMode,
            boolean outdoorMode
    ) {
        byte[] payload = new byte[9];
        for (int i = 0; i < 7; i++) {
            float g = (gainsDb != null && i < gainsDb.length) ? gainsDb[i] : 0f;
            float clamped = Math.max(-6f, Math.min(6f, g));
            payload[i] = (byte) Math.round(clamped * 10f);
        }
        payload[7] = (byte) bassMode.code;
        payload[8] = (byte) (outdoorMode ? 0x01 : 0x00);
        return wrapHarmanFrame(CMD_EQUALIZER, payload);
    }

    public static byte[] encodeSpeakerSettingsPacket(
            boolean feedbackTonesEnabled,
            boolean playtimeBoost,
            boolean autoStandbyEnabled,
            boolean startupLightsEnabled,
            int stereoModeCode
    ) {
        byte[] payload = new byte[]{
                (byte) (feedbackTonesEnabled ? 0x01 : 0x00),
                (byte) (playtimeBoost ? 0x01 : 0x00),
                (byte) (autoStandbyEnabled ? 0x01 : 0x00),
                (byte) (startupLightsEnabled ? 0x01 : 0x00),
                (byte) (stereoModeCode & 0xFF)
        };
        return wrapHarmanFrame(CMD_SYSTEM_SETTINGS, payload);
    }

    public static byte[] encodeFeedbackToneTrigger(int toneIndex) {
        byte[] payload = new byte[]{(byte) (toneIndex & 0xFF)};
        return wrapHarmanFrame(CMD_SOUND_TONES, payload);
    }

    public static byte[] encodeDfuBeginPacket(String targetVersion, int totalBytes, int crc32) {
        byte[] verBytes = (targetVersion == null ? "2.7.0" : targetVersion.trim())
                .getBytes(StandardCharsets.US_ASCII);
        int vLen = Math.min(12, verBytes.length);
        byte[] payload = new byte[9 + vLen];
        payload[0] = (byte) ((totalBytes >>> 24) & 0xFF);
        payload[1] = (byte) ((totalBytes >>> 16) & 0xFF);
        payload[2] = (byte) ((totalBytes >>> 8) & 0xFF);
        payload[3] = (byte) (totalBytes & 0xFF);
        payload[4] = (byte) ((crc32 >>> 24) & 0xFF);
        payload[5] = (byte) ((crc32 >>> 16) & 0xFF);
        payload[6] = (byte) ((crc32 >>> 8) & 0xFF);
        payload[7] = (byte) (crc32 & 0xFF);
        payload[8] = (byte) vLen;
        System.arraycopy(verBytes, 0, payload, 9, vLen);
        return wrapHarmanFrame(CMD_DFU_BEGIN, payload);
    }

    public static byte[] encodeDfuChunkPacket(int blockIndex, byte[] chunkData, int length) {
        int safeLen = chunkData == null ? 0 : Math.max(0, Math.min(chunkData.length, Math.min(64, length)));
        byte[] payload = new byte[3 + safeLen];
        payload[0] = (byte) ((blockIndex >>> 8) & 0xFF);
        payload[1] = (byte) (blockIndex & 0xFF);
        payload[2] = (byte) safeLen;
        if (safeLen > 0) {
            System.arraycopy(chunkData, 0, payload, 3, safeLen);
        }
        return wrapHarmanFrame(CMD_DFU_CHUNK, payload);
    }

    public static byte[] encodeDfuVerifyPacket(int crc32) {
        byte[] payload = new byte[]{
                (byte) ((crc32 >>> 24) & 0xFF),
                (byte) ((crc32 >>> 16) & 0xFF),
                (byte) ((crc32 >>> 8) & 0xFF),
                (byte) (crc32 & 0xFF)
        };
        return wrapHarmanFrame(CMD_DFU_VERIFY, payload);
    }

    public static byte[] encodeDfuApplyPacket() {
        return wrapHarmanFrame(CMD_DFU_APPLY, new byte[]{0x01});
    }

    /**
     * Parses incoming bidirectional frames from the JBL PartyBox Stage 320 over BLE GATT or RFCOMM SPP.
     */
    public static ParsedPacket parseIncomingPacket(byte[] raw) {
        if (raw == null || raw.length < 4) return null;

        // Raw 13-byte GATT lightshow payload without 0xAA framing
        if (raw[0] != HEADER_HARMAN && raw.length == 13) {
            LightshowState ls = decodeLightshowPayload(raw, 0);
            return new ParsedPacket(CMD_LIGHTSHOW, true, ls, null);
        }

        if (raw[0] != HEADER_HARMAN) return null;
        byte cmd = raw[1];
        int payloadLen = raw[2] & 0xFF;
        if (raw.length < 3 + payloadLen + 1) return null;

        byte expectedXor = computeXorChecksum(raw, 3 + payloadLen);
        boolean checksumOk = (expectedXor == raw[3 + payloadLen]);
        if (!checksumOk) {
            return new ParsedPacket(cmd, false, null, null);
        }

        if (cmd == CMD_LIGHTSHOW && payloadLen >= 13) {
            return new ParsedPacket(cmd, true, decodeLightshowPayload(raw, 3), null);
        }

        if (cmd == CMD_SPEAKER_INFO && payloadLen >= 5) {
            int bat = clamp(raw[3] & 0xFF, 0, 100);
            boolean chg = (raw[4] & 0x01) != 0;
            int maj = raw[5] & 0xFF;
            int min = raw[6] & 0xFF;
            int pat = raw[7] & 0xFF;
            String fw = maj + "." + min + "." + pat;
            String hw = payloadLen >= 6 ? ("Rev A" + (raw[8] & 0xFF)) : "Rev A2";
            return new ParsedPacket(cmd, true, null, new SpeakerInfoReport(bat, chg, fw, hw));
        }

        return new ParsedPacket(cmd, true, null, null);
    }

    private static LightshowState decodeLightshowPayload(byte[] buf, int offset) {
        boolean enabled = (buf[offset] & 0xFF) != 0;
        LightPreset preset = LightPreset.fromCode(buf[offset + 1] & 0xFF);
        int zoneMask = buf[offset + 2] & 0x1F;
        int brightness = clamp(buf[offset + 3] & 0xFF, 0, 100);
        int speedTenths = clamp(buf[offset + 4] & 0xFF, 5, 20);
        String pHex = rgbToHex(buf[offset + 6] & 0xFF, buf[offset + 7] & 0xFF, buf[offset + 8] & 0xFF);
        String sHex = rgbToHex(buf[offset + 9] & 0xFF, buf[offset + 10] & 0xFF, buf[offset + 11] & 0xFF);
        boolean beat = (buf[offset + 12] & 0xFF) != 0;
        return new LightshowState(enabled, preset, zoneMask, brightness, speedTenths, pHex, sHex, beat);
    }

    public static String toHex(byte[] bytes) {
        if (bytes == null) return "";
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            int v = b & 0xFF;
            if (v < 16) sb.append('0');
            sb.append(Integer.toHexString(v).toUpperCase());
        }
        return sb.toString();
    }

    private static int clamp(int val, int min, int max) {
        return Math.max(min, Math.min(max, val));
    }
}
