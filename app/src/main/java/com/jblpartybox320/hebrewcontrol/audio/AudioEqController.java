package com.jblpartybox320.hebrewcontrol.audio;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.audiofx.BassBoost;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;

import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.BassMode;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class AudioEqController {

    public static final class EqPreset {
        public final String id;
        public final String nameHe;
        public final float[] gainsDb;

        public EqPreset(String id, String nameHe, float[] gainsDb) {
            this.id = id;
            this.nameHe = nameHe;
            this.gainsDb = Arrays.copyOf(gainsDb, gainsDb.length);
        }
    }

    public final String[] bandLabels = new String[]{
            "63Hz", "125Hz", "250Hz", "500Hz", "1kHz", "4kHz", "12kHz"
    };
    private final int[] targetFreqHz = new int[]{63, 125, 250, 500, 1000, 4000, 12000};
    public final List<EqPreset> builtInPresets;

    private final SharedPreferences prefs;
    private Equalizer equalizer;
    private BassBoost bassBoostFx;
    private LoudnessEnhancer loudnessFx;

    private float[] currentGainsDb;
    private String activePresetId;
    private BassMode bassMode;

    public AudioEqController(Context context) {
        this.prefs = context.getSharedPreferences("jbl_native_eq_prefs", Context.MODE_PRIVATE);
        this.builtInPresets = Arrays.asList(
                new EqPreset("jbl_sig", "חתימת JBL", new float[]{3.5f, 2.5f, 0.5f, 0.0f, 1.5f, 2.5f, 3.0f}),
                new EqPreset("party", "מסיבה", new float[]{5.0f, 4.0f, 1.0f, 0.0f, 1.5f, 3.5f, 4.5f}),
                new EqPreset("deep_bass", "בס עמוק", new float[]{6.0f, 5.0f, 2.0f, 0.0f, -0.5f, 1.0f, 2.0f}),
                new EqPreset("vocal", "שירה ודיבור", new float[]{-1.5f, -0.5f, 1.5f, 3.5f, 4.0f, 2.5f, 1.0f}),
                new EqPreset("outdoor", "שטח פתוח", new float[]{4.5f, 3.5f, 2.0f, 1.0f, 2.0f, 3.5f, 4.0f}),
                new EqPreset("flat", "מאוזן (0dB)", new float[]{0f, 0f, 0f, 0f, 0f, 0f, 0f})
        );

        this.currentGainsDb = loadInitialGains();
        this.activePresetId = prefs.getString("active_preset", "jbl_sig");
        int bassOrd = prefs.getInt("bass_mode", 1);
        BassMode[] modes = BassMode.values();
        this.bassMode = (bassOrd >= 0 && bassOrd < modes.length) ? modes[bassOrd] : BassMode.DEEP;

        attachToSession(0);
    }

    private float[] loadInitialGains() {
        String raw = prefs.getString("gains_json", null);
        if (raw == null) return Arrays.copyOf(builtInPresets.get(0).gainsDb, 7);
        try {
            JSONArray arr = new JSONArray(raw);
            float[] out = new float[7];
            for (int i = 0; i < 7; i++) {
                float v = (float) arr.optDouble(i, 0.0);
                out[i] = Math.max(-6f, Math.min(6f, v));
            }
            return out;
        } catch (Exception e) {
            return Arrays.copyOf(builtInPresets.get(0).gainsDb, 7);
        }
    }

    public float[] getCurrentGainsDb() {
        return Arrays.copyOf(currentGainsDb, currentGainsDb.length);
    }

    public String getActivePresetId() {
        return activePresetId;
    }

    public BassMode getBassMode() {
        return bassMode;
    }

    public void attachToSession(int audioSessionId) {
        releaseEffects();
        try {
            equalizer = new Equalizer(0, audioSessionId);
            equalizer.setEnabled(true);
        } catch (Exception e) {
            equalizer = null;
        }
        try {
            bassBoostFx = new BassBoost(0, audioSessionId);
            bassBoostFx.setEnabled(true);
        } catch (Exception e) {
            bassBoostFx = null;
        }
        try {
            loudnessFx = new LoudnessEnhancer(audioSessionId);
            loudnessFx.setEnabled(false);
        } catch (Exception e) {
            loudnessFx = null;
        }
        applyCurrentToHardware();
    }

    public void setBandGain(int index, float gainDb) {
        if (index < 0 || index >= 7) return;
        currentGainsDb[index] = Math.max(-6f, Math.min(6f, gainDb));
        activePresetId = "custom";
        persistState();
        applyCurrentToHardware();
    }

    public void applyPreset(EqPreset preset) {
        currentGainsDb = Arrays.copyOf(preset.gainsDb, 7);
        activePresetId = preset.id;
        persistState();
        applyCurrentToHardware();
    }

    public void setBassBoost(BassMode mode) {
        this.bassMode = mode;
        prefs.edit().putInt("bass_mode", mode.ordinal()).apply();
        applyCurrentToHardware();
    }

    public void setPlaytimeLoudnessBoost(boolean playtimeSaver) {
        try {
            if (loudnessFx != null) {
                loudnessFx.setTargetGain(playtimeSaver ? 0 : 250);
                loudnessFx.setEnabled(!playtimeSaver);
            }
        } catch (Exception ignored) {}
    }

    public List<EqPreset> getCustomProfiles() {
        String raw = prefs.getString("custom_profiles", null);
        List<EqPreset> out = new ArrayList<>();
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                JSONArray gArr = obj.getJSONArray("gains");
                float[] g = new float[7];
                for (int k = 0; k < 7; k++) g[k] = (float) gArr.optDouble(k, 0.0);
                out.add(new EqPreset(obj.getString("id"), obj.getString("name"), g));
            }
        } catch (Exception ignored) {}
        return out;
    }

    public EqPreset saveCustomProfile(String name) {
        String cleanName = (name == null || name.trim().isEmpty()) ? "פרופיל אישי" : name.trim();
        List<EqPreset> list = new ArrayList<>(getCustomProfiles());
        EqPreset created = new EqPreset("user_" + System.currentTimeMillis(), cleanName, currentGainsDb);
        list.add(0, created);

        try {
            JSONArray outArr = new JSONArray();
            int limit = Math.min(8, list.size());
            for (int i = 0; i < limit; i++) {
                EqPreset p = list.get(i);
                JSONArray gArr = new JSONArray();
                for (float v : p.gainsDb) gArr.put(v);
                JSONObject obj = new JSONObject();
                obj.put("id", p.id);
                obj.put("name", p.nameHe);
                obj.put("gains", gArr);
                outArr.put(obj);
            }
            activePresetId = created.id;
            prefs.edit()
                    .putString("custom_profiles", outArr.toString())
                    .putString("active_preset", activePresetId)
                    .apply();
        } catch (Exception ignored) {}
        return created;
    }

    private void persistState() {
        try {
            JSONArray arr = new JSONArray();
            for (float v : currentGainsDb) arr.put(v);
            prefs.edit()
                    .putString("gains_json", arr.toString())
                    .putString("active_preset", activePresetId)
                    .apply();
        } catch (Exception ignored) {}
    }

    private void applyCurrentToHardware() {
        if (equalizer != null) {
            try {
                int numBands = equalizer.getNumberOfBands();
                short[] range = equalizer.getBandLevelRange();
                int minMb = range[0];
                int maxMb = range[1];
                for (short b = 0; b < numBands; b++) {
                    int centerHz = equalizer.getCenterFreq(b) / 1000;
                    int closestIdx = 0;
                    int bestDist = Integer.MAX_VALUE;
                    for (int i = 0; i < targetFreqHz.length; i++) {
                        int d = Math.abs(centerHz - targetFreqHz[i]);
                        if (d < bestDist) {
                            bestDist = d;
                            closestIdx = i;
                        }
                    }
                    int mb = Math.round(currentGainsDb[closestIdx] * 100f);
                    mb = Math.max(minMb, Math.min(maxMb, mb));
                    equalizer.setBandLevel(b, (short) mb);
                }
            } catch (Exception ignored) {}
        }

        if (bassBoostFx != null) {
            try {
                short strength;
                switch (bassMode) {
                    case OFF:
                        strength = 0;
                        break;
                    case PUNCHY:
                        strength = 600;
                        break;
                    case DEEP:
                    default:
                        strength = 850;
                        break;
                }
                bassBoostFx.setStrength(strength);
            } catch (Exception ignored) {}
        }
    }

    public void releaseEffects() {
        try { if (equalizer != null) equalizer.release(); } catch (Exception ignored) {}
        try { if (bassBoostFx != null) bassBoostFx.release(); } catch (Exception ignored) {}
        try { if (loudnessFx != null) loudnessFx.release(); } catch (Exception ignored) {}
        equalizer = null;
        bassBoostFx = null;
        loudnessFx = null;
    }
}
