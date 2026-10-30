package com.jblpartybox320.hebrewcontrol.protocol;

public final class JblProtocol {
    public static final byte HEADER_HARMAN = (byte) 0xAA;
    public static final byte CMD_LIGHTSHOW = 0x31;
    public static final byte CMD_EQUALIZER = 0x32;
    public static final byte CMD_SYSTEM_SETTINGS = 0x33;
    public static final byte CMD_SOUND_TONES = 0x34;

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
