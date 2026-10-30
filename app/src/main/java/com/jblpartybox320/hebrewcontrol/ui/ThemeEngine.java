package com.jblpartybox320.hebrewcontrol.ui;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;

public final class ThemeEngine {

    public enum ThemeModePref {
        SYSTEM("system", "לפי מערכת"),
        LIGHT("light", "מצב בהיר"),
        DARK("dark", "מצב כהה");

        public final String key;
        public final String labelHe;

        ThemeModePref(String key, String labelHe) {
            this.key = key;
            this.labelHe = labelHe;
        }

        public static ThemeModePref fromKey(String key) {
            for (ThemeModePref p : values()) {
                if (p.key.equals(key)) return p;
            }
            return SYSTEM;
        }
    }

    public static final class Palette {
        public final boolean isDark;
        public final int bgPrimary;
        public final int surface;
        public final int surfaceSubtle;
        public final int border;
        public final int textPrimary;
        public final int textSecondary;
        public final int accent;
        public final int accentSoft;
        public final int success;

        public Palette(
                boolean isDark,
                int bgPrimary,
                int surface,
                int surfaceSubtle,
                int border,
                int textPrimary,
                int textSecondary,
                int accent,
                int accentSoft,
                int success
        ) {
            this.isDark = isDark;
            this.bgPrimary = bgPrimary;
            this.surface = surface;
            this.surfaceSubtle = surfaceSubtle;
            this.border = border;
            this.textPrimary = textPrimary;
            this.textSecondary = textSecondary;
            this.accent = accent;
            this.accentSoft = accentSoft;
            this.success = success;
        }
    }

    public static final Palette LIGHT = new Palette(
            false,
            Color.parseColor("#F6F7F9"),
            Color.parseColor("#FFFFFF"),
            Color.parseColor("#EEF1F6"),
            Color.parseColor("#E2E8F0"),
            Color.parseColor("#0F172A"),
            Color.parseColor("#64748B"),
            Color.parseColor("#EA580C"),
            Color.parseColor("#FFF2EC"),
            Color.parseColor("#16A34A")
    );

    public static final Palette DARK = new Palette(
            true,
            Color.parseColor("#0B0F17"),
            Color.parseColor("#131A26"),
            Color.parseColor("#1C2536"),
            Color.parseColor("#263248"),
            Color.parseColor("#F8FAFC"),
            Color.parseColor("#94A3B8"),
            Color.parseColor("#FF692E"),
            Color.parseColor("#2B1B17"),
            Color.parseColor("#22C55E")
    );

    private ThemeEngine() {}

    public static Palette resolvePalette(Context context, ThemeModePref pref) {
        boolean useDark;
        if (pref == ThemeModePref.LIGHT) {
            useDark = false;
        } else if (pref == ThemeModePref.DARK) {
            useDark = true;
        } else {
            int mask = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            useDark = (mask == Configuration.UI_MODE_NIGHT_YES);
        }
        return useDark ? DARK : LIGHT;
    }

    public static int dp(Context context, float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }

    public static GradientDrawable roundedBg(
            Context context,
            int fillColor,
            float radiusDp,
            Integer strokeColor
    ) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.RECTANGLE);
        gd.setCornerRadius(dp(context, radiusDp));
        gd.setColor(fillColor);
        if (strokeColor != null) {
            gd.setStroke(Math.max(1, dp(context, 1f)), strokeColor);
        }
        return gd;
    }

    public static GradientDrawable circleBg(int fillColor, Integer strokeColor, int strokePx) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(fillColor);
        if (strokeColor != null && strokePx > 0) {
            gd.setStroke(strokePx, strokeColor);
        }
        return gd;
    }
}
