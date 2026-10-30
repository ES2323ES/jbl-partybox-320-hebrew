package com.jblpartybox320.hebrewcontrol;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.jblpartybox320.hebrewcontrol.audio.AudioEqController;
import com.jblpartybox320.hebrewcontrol.audio.AudioEqController.EqPreset;
import com.jblpartybox320.hebrewcontrol.bluetooth.BluetoothController;
import com.jblpartybox320.hebrewcontrol.bluetooth.BluetoothController.DiscoveredSpeaker;
import com.jblpartybox320.hebrewcontrol.bluetooth.BluetoothController.SpeakerTelemetry;
import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController;
import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController.SongItem;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.BassMode;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightPreset;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.ProtocolMode;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine.Palette;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine.ThemeModePref;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater.ReleaseInfo;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * 100% Native Android (Java 17) Controller for JBL PartyBox Stage 320.
 * Zero WebView, zero HTML assets, instant startup, 100% VectorDrawable SVG icons,
 * full RTL Hebrew layout with Right Settings, Left About, and 5-tab Bottom Bar.
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMISSIONS_BT = 101;
    private static final int REQ_PERMISSIONS_AUDIO = 102;
    private static final int REQ_PICK_AUDIO_FILES = 201;

    private SharedPreferences prefs;
    private BluetoothController btController;
    private AudioEqController eqController;
    private MusicPlayerController playerController;

    private ThemeModePref themePref = ThemeModePref.SYSTEM;
    private Palette palette;
    private int activeTabIndex = 0;

    // Hardware & Lightshow State
    private boolean lightEnabled = true;
    private LightPreset lightPreset = LightPreset.NEON;
    private int zoneMask = 0x1F;
    private int lightBrightness = 85;
    private int lightSpeedTenths = 10;
    private String primaryColorHex = "#00F0FF";
    private String secondaryColorHex = "#FF5A1F";
    private boolean beatSync = true;
    private int micVolume = 65;
    private int micEcho = 30;

    // Speaker System Settings State
    private boolean feedbackTonesEnabled = true;
    private boolean playtimeBoost = false;
    private boolean outdoorAcoustic = false;
    private boolean autoStandbyEnabled = true;
    private boolean startupLightsEnabled = true;
    private int stereoModeCode = 0;
    private ProtocolMode protocolMode = ProtocolMode.AUTO_DUAL;
    private boolean autoCheckGithubUpdates = true;

    private SpeakerTelemetry latestTelemetry = new SpeakerTelemetry();
    private List<DiscoveredSpeaker> latestDevices = Collections.emptyList();
    private ReleaseInfo latestReleaseInfo = null;

    private LinearLayout rootLayout;
    private FrameLayout contentFrame;

    // Live UI References
    private View headerConnDot;
    private TextView connNameTv, connStatusTv, connBatTv, connVerTv, connTransTv, connMacTv;
    private LinearLayout connDevicesList;
    private TextView songNowTitleTv, songNowSubTv, songCountTv;
    private ImageView songPlayPauseImg;
    private SeekBar songSeekBar;
    private LinearLayout songListLayout;
    private TextView txHexLabel;

    private interface IntSliderListener {
        void onValueChanged(int value, TextView valueLabel);
    }

    private interface BoolToggleListener {
        void onToggle(boolean checked);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        prefs = getSharedPreferences("jbl_pb320_native_state", Context.MODE_PRIVATE);
        loadPersistedSettings();
        palette = ThemeEngine.resolvePalette(this, themePref);
        applySystemBarsPalette();

        eqController = new AudioEqController(this);
        playerController = new MusicPlayerController(
                this,
                sessionId -> eqController.attachToSession(sessionId),
                this::refreshSongsDynamicUi
        );
        btController = new BluetoothController(this, (tel, devs) -> {
            latestTelemetry = tel;
            latestDevices = devs;
            refreshConnectionDynamicUi();
            if (txHexLabel != null) {
                txHexLabel.setText("חבילה אחרונה (" + tel.txPacketCount + "): " + tel.lastTxHex);
            }
        });

        rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootLayout);

        rebuildEntireChrome();
        ensureBluetoothAndScan(true);
        tryLoadMusicIfPermitted();

        if (autoCheckGithubUpdates) {
            GithubAutoUpdater.checkLatestRelease(new GithubAutoUpdater.ReleaseCheckCallback() {
                @Override
                public void onSuccess(ReleaseInfo info) {
                    latestReleaseInfo = info;
                    if (info.isNewer) {
                        Toast.makeText(
                                MainActivity.this,
                                "זמין עדכון חדש ב-GitHub (" + info.tagName + ") — פתח הגדרות להתקנה",
                                Toast.LENGTH_LONG
                        ).show();
                    }
                }

                @Override
                public void onError(String message) {}
            });
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (themePref == ThemeModePref.SYSTEM) {
            palette = ThemeEngine.resolvePalette(this, themePref);
            applySystemBarsPalette();
            rebuildEntireChrome();
        }
    }

    @Override
    protected void onDestroy() {
        btController.release();
        playerController.release();
        eqController.releaseEffects();
        super.onDestroy();
    }

    private void loadPersistedSettings() {
        themePref = ThemeModePref.fromKey(prefs.getString("theme_mode", "system"));
        lightEnabled = prefs.getBoolean("light_enabled", true);
        LightPreset[] lp = LightPreset.values();
        int lpOrd = prefs.getInt("light_preset", 0);
        lightPreset = (lpOrd >= 0 && lpOrd < lp.length) ? lp[lpOrd] : LightPreset.NEON;
        zoneMask = prefs.getInt("zone_mask", 0x1F);
        lightBrightness = prefs.getInt("light_brightness", 85);
        lightSpeedTenths = prefs.getInt("light_speed", 10);
        primaryColorHex = prefs.getString("primary_hex", "#00F0FF");
        secondaryColorHex = prefs.getString("secondary_hex", "#FF5A1F");
        beatSync = prefs.getBoolean("beat_sync", true);
        feedbackTonesEnabled = prefs.getBoolean("feedback_tones", true);
        playtimeBoost = prefs.getBoolean("playtime_boost", false);
        outdoorAcoustic = prefs.getBoolean("outdoor_acoustic", false);
        autoStandbyEnabled = prefs.getBoolean("auto_standby", true);
        startupLightsEnabled = prefs.getBoolean("startup_lights", true);
        stereoModeCode = prefs.getInt("stereo_mode", 0);
        ProtocolMode[] pm = ProtocolMode.values();
        int pmOrd = prefs.getInt("protocol_mode", 0);
        protocolMode = (pmOrd >= 0 && pmOrd < pm.length) ? pm[pmOrd] : ProtocolMode.AUTO_DUAL;
        autoCheckGithubUpdates = prefs.getBoolean("auto_check_gh", true);
    }

    private void savePersistedSettings() {
        prefs.edit()
                .putString("theme_mode", themePref.key)
                .putBoolean("light_enabled", lightEnabled)
                .putInt("light_preset", lightPreset.ordinal())
                .putInt("zone_mask", zoneMask)
                .putInt("light_brightness", lightBrightness)
                .putInt("light_speed", lightSpeedTenths)
                .putString("primary_hex", primaryColorHex)
                .putString("secondary_hex", secondaryColorHex)
                .putBoolean("beat_sync", beatSync)
                .putBoolean("feedback_tones", feedbackTonesEnabled)
                .putBoolean("playtime_boost", playtimeBoost)
                .putBoolean("outdoor_acoustic", outdoorAcoustic)
                .putBoolean("auto_standby", autoStandbyEnabled)
                .putBoolean("startup_lights", startupLightsEnabled)
                .putInt("stereo_mode", stereoModeCode)
                .putInt("protocol_mode", protocolMode.ordinal())
                .putBoolean("auto_check_gh", autoCheckGithubUpdates)
                .apply();
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarsPalette() {
        getWindow().setStatusBarColor(palette.surface);
        getWindow().setNavigationBarColor(palette.surface);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = getWindow().getDecorView().getSystemUiVisibility();
            if (!palette.isDark) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            } else {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    private int dp(float v) {
        return ThemeEngine.dp(this, v);
    }

    private ImageView svgIcon(int resId, int tintColor, float sizeDp) {
        ImageView iv = new ImageView(this);
        iv.setImageResource(resId);
        iv.setImageTintList(ColorStateList.valueOf(tintColor));
        iv.setLayoutParams(new LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp)));
        iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
        return iv;
    }

    private void rebuildEntireChrome() {
        rootLayout.removeAllViews();
        rootLayout.setBackgroundColor(palette.bgPrimary);

        // 1. TOP HEADER BAR (RTL: Start = Right = Settings, End = Left = About)
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(palette.surface);
        header.setPadding(dp(12f), dp(8f), dp(12f), dp(8f));
        header.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(56f)
        ));

        // Right button: Settings
        LinearLayout settingsBtn = new LinearLayout(this);
        settingsBtn.setOrientation(LinearLayout.HORIZONTAL);
        settingsBtn.setGravity(Gravity.CENTER);
        settingsBtn.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, palette.border));
        settingsBtn.setMinimumWidth(dp(44f));
        settingsBtn.setMinimumHeight(dp(40f));
        settingsBtn.setPadding(dp(10f), dp(8f), dp(10f), dp(8f));
        settingsBtn.addView(svgIcon(R.drawable.ic_settings, palette.textPrimary, 20f));
        settingsBtn.setContentDescription("הגדרות");
        settingsBtn.setOnClickListener(v -> openSettingsDialog());
        header.addView(settingsBtn);

        // Center Title + Live Dot
        LinearLayout titleWrap = new LinearLayout(this);
        titleWrap.setOrientation(LinearLayout.HORIZONTAL);
        titleWrap.setGravity(Gravity.CENTER);
        titleWrap.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        headerConnDot = new View(this);
        LinearLayout.LayoutParams dotLp = new LinearLayout.LayoutParams(dp(8f), dp(8f));
        dotLp.setMarginEnd(dp(8f));
        headerConnDot.setLayoutParams(dotLp);
        headerConnDot.setBackground(ThemeEngine.circleBg(
                latestTelemetry.connected ? palette.success : palette.textSecondary, null, 0
        ));

        TextView titleTv = new TextView(this);
        titleTv.setText("JBL PartyBox 320");
        titleTv.setTextSize(16.5f);
        titleTv.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        titleTv.setTextColor(palette.textPrimary);
        titleTv.setMaxLines(1);
        titleTv.setEllipsize(TextUtils.TruncateAt.END);

        titleWrap.addView(headerConnDot);
        titleWrap.addView(titleTv);
        header.addView(titleWrap);

        // Left button: About (אודות)
        LinearLayout aboutBtn = new LinearLayout(this);
        aboutBtn.setOrientation(LinearLayout.HORIZONTAL);
        aboutBtn.setGravity(Gravity.CENTER_VERTICAL);
        aboutBtn.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, palette.border));
        aboutBtn.setMinimumHeight(dp(40f));
        aboutBtn.setPadding(dp(10f), dp(8f), dp(10f), dp(8f));
        aboutBtn.addView(svgIcon(R.drawable.ic_info, palette.textPrimary, 18f));
        TextView aboutLabel = new TextView(this);
        aboutLabel.setText("אודות");
        aboutLabel.setTextSize(12.5f);
        aboutLabel.setTypeface(Typeface.DEFAULT_BOLD);
        aboutLabel.setTextColor(palette.textPrimary);
        aboutLabel.setPadding(0, 0, dp(6f), 0);
        aboutBtn.addView(aboutLabel);
        aboutBtn.setOnClickListener(v -> openAboutDialog());
        header.addView(aboutBtn);

        rootLayout.addView(header);
        rootLayout.addView(hairlineDivider());

        // 2. BODY CONTENT HOST
        contentFrame = new FrameLayout(this);
        contentFrame.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ));
        rootLayout.addView(contentFrame);

        // 3. FIXED BOTTOM NAVIGATION BAR (RTL order from Right to Left!)
        rootLayout.addView(hairlineDivider());
        LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.HORIZONTAL);
        bottomBar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        bottomBar.setBackgroundColor(palette.surface);
        bottomBar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(62f)
        ));

        String[] tabLabels = new String[]{"חיבור", "שליטה", "איקוולייזר", "שירים", "הבוקסה"};
        int[] tabIcons = new int[]{
                R.drawable.ic_speaker_bt,
                R.drawable.ic_controls_light,
                R.drawable.ic_equalizer,
                R.drawable.ic_music,
                R.drawable.ic_speaker_tune
        };

        for (int i = 0; i < tabLabels.length; i++) {
            final int idx = i;
            boolean isSelected = (idx == activeTabIndex);
            int itemColor = isSelected ? palette.accent : palette.textSecondary;

            LinearLayout tabView = new LinearLayout(this);
            tabView.setOrientation(LinearLayout.VERTICAL);
            tabView.setGravity(Gravity.CENTER);
            tabView.setLayoutParams(new LinearLayout.LayoutParams(
                    0, ViewGroup.LayoutParams.MATCH_PARENT, 1f
            ));
            tabView.setPadding(dp(2f), dp(6f), dp(2f), dp(6f));

            if (isSelected) {
                View indicator = new View(this);
                indicator.setBackground(ThemeEngine.roundedBg(this, palette.accent, 4f, null));
                LinearLayout.LayoutParams indLp = new LinearLayout.LayoutParams(dp(22f), dp(2.5f));
                indLp.bottomMargin = dp(4f);
                indicator.setLayoutParams(indLp);
                tabView.addView(indicator);
            }
            tabView.addView(svgIcon(tabIcons[i], itemColor, 20f));

            TextView lbl = new TextView(this);
            lbl.setText(tabLabels[i]);
            lbl.setTextSize(11f);
            lbl.setTypeface(isSelected ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            lbl.setTextColor(itemColor);
            lbl.setGravity(Gravity.CENTER);
            lbl.setPadding(0, dp(3f), 0, 0);
            tabView.addView(lbl);

            tabView.setOnClickListener(v -> {
                if (activeTabIndex != idx) {
                    activeTabIndex = idx;
                    rebuildEntireChrome();
                }
            });
            bottomBar.addView(tabView);
        }
        rootLayout.addView(bottomBar);

        renderActiveTab();
    }

    private View hairlineDivider() {
        View div = new View(this);
        div.setBackgroundColor(palette.border);
        div.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1));
        return div;
    }

    private void renderActiveTab() {
        connNameTv = null;
        songNowTitleTv = null;
        txHexLabel = null;
        contentFrame.removeAllViews();

        View v;
        switch (activeTabIndex) {
            case 0:
                v = buildConnectionTab();
                break;
            case 1:
                v = buildSpeakerControlTab();
                break;
            case 2:
                v = buildEqualizerTab();
                break;
            case 3:
                v = buildSongsTab();
                break;
            default:
                v = buildSpeakerHardwareSettingsTab();
                break;
        }
        contentFrame.addView(v);
    }

    private LinearLayout createCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        card.setBackground(ThemeEngine.roundedBg(this, palette.surface, 16f, palette.border));
        card.setPadding(dp(16f), dp(14f), dp(16f), dp(14f));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.bottomMargin = dp(12f);
        card.setLayoutParams(lp);
        return card;
    }

    private LinearLayout sectionTitle(String title, String subtitle) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.bottomMargin = dp(10f);
        wrap.setLayoutParams(lp);

        TextView t = new TextView(this);
        t.setText(title);
        t.setTextSize(15.5f);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setTextColor(palette.textPrimary);
        wrap.addView(t);

        if (subtitle != null) {
            TextView s = new TextView(this);
            s.setText(subtitle);
            s.setTextSize(12.5f);
            s.setTextColor(palette.textSecondary);
            s.setPadding(0, dp(2f), 0, 0);
            wrap.addView(s);
        }
        return wrap;
    }

    private LinearLayout primaryActionButton(
            String label,
            Integer iconRes,
            boolean filled,
            Runnable onClick
    ) {
        int bgColor = filled ? palette.accent : palette.surfaceSubtle;
        int fgColor = filled ? Color.WHITE : palette.textPrimary;
        Integer borderColor = filled ? null : palette.border;

        LinearLayout btn = new LinearLayout(this);
        btn.setOrientation(LinearLayout.HORIZONTAL);
        btn.setGravity(Gravity.CENTER);
        btn.setMinimumHeight(dp(46f));
        btn.setBackground(ThemeEngine.roundedBg(this, bgColor, 12f, borderColor));
        btn.setPadding(dp(14f), dp(10f), dp(14f), dp(10f));
        if (iconRes != null) {
            btn.addView(svgIcon(iconRes, fgColor, 18f));
        }
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(13.5f);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setTextColor(fgColor);
        if (iconRes != null) tv.setPadding(0, 0, dp(8f), 0);
        btn.addView(tv);
        btn.setOnClickListener(v -> onClick.run());
        return btn;
    }

    // =========================================================================
    // TAB 0 (Rightmost): חיבור ופרטי בוקסה
    // =========================================================================
    private View buildConnectionTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        LinearLayout infoCard = createCard();
        infoCard.addView(sectionTitle("פרטי הבוקסה המחוברת", "שם התקן, סוללה, גרסת קושחה וערוץ תקשורת"));

        connNameTv = new TextView(this);
        connNameTv.setTextSize(18f);
        connNameTv.setTypeface(Typeface.DEFAULT_BOLD);
        connNameTv.setTextColor(palette.textPrimary);
        infoCard.addView(connNameTv);

        connStatusTv = new TextView(this);
        connStatusTv.setTextSize(13f);
        connStatusTv.setTextColor(palette.textSecondary);
        connStatusTv.setPadding(0, dp(2f), 0, dp(12f));
        infoCard.addView(connStatusTv);

        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams r1Lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        r1Lp.bottomMargin = dp(8f);
        row1.setLayoutParams(r1Lp);

        connBatTv = new TextView(this);
        connVerTv = new TextView(this);
        LinearLayout batBox = buildMetricTile("סוללה", connBatTv);
        LinearLayout verBox = buildMetricTile("גרסת קושחה / פרוטוקול", connVerTv);
        LinearLayout.LayoutParams col1Lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        col1Lp.setMarginEnd(dp(8f));
        row1.addView(batBox, col1Lp);
        row1.addView(verBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        infoCard.addView(row1);

        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams r2Lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        r2Lp.bottomMargin = dp(12f);
        row2.setLayoutParams(r2Lp);

        connTransTv = new TextView(this);
        connMacTv = new TextView(this);
        LinearLayout transBox = buildMetricTile("ערוץ חיבור", connTransTv);
        LinearLayout macBox = buildMetricTile("כתובת MAC / אות", connMacTv);
        LinearLayout.LayoutParams col2Lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        col2Lp.setMarginEnd(dp(8f));
        row2.addView(transBox, col2Lp);
        row2.addView(macBox, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        infoCard.addView(row2);

        LinearLayout actionsRow = new LinearLayout(this);
        actionsRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout scanBtn = primaryActionButton("סרוק וחבר בוקסה", R.drawable.ic_refresh, true,
                () -> ensureBluetoothAndScan(false));
        LinearLayout discBtn = primaryActionButton("נתק", null, false,
                () -> btController.disconnect());
        LinearLayout.LayoutParams scanLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        scanLp.setMarginEnd(dp(8f));
        actionsRow.addView(scanBtn, scanLp);
        actionsRow.addView(discBtn);
        infoCard.addView(actionsRow);
        container.addView(infoCard);

        LinearLayout listCard = createCard();
        listCard.addView(sectionTitle("התקני Bluetooth זמינים", "מכשירי JBL PartyBox 320 מזוהים ראשונים ברשימה"));
        connDevicesList = new LinearLayout(this);
        connDevicesList.setOrientation(LinearLayout.VERTICAL);
        listCard.addView(connDevicesList);
        container.addView(listCard);

        refreshConnectionDynamicUi();
        scroll.addView(container);
        return scroll;
    }

    private LinearLayout buildMetricTile(String caption, TextView valTv) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, null));
        box.setPadding(dp(12f), dp(10f), dp(12f), dp(10f));

        TextView capTv = new TextView(this);
        capTv.setText(caption);
        capTv.setTextSize(11.5f);
        capTv.setTextColor(palette.textSecondary);

        valTv.setText("—");
        valTv.setTextSize(14f);
        valTv.setTypeface(Typeface.DEFAULT_BOLD);
        valTv.setTextColor(palette.textPrimary);
        valTv.setPadding(0, dp(3f), 0, 0);

        box.addView(capTv);
        box.addView(valTv);
        return box;
    }

    private void refreshConnectionDynamicUi() {
        if (headerConnDot != null) {
            headerConnDot.setBackground(ThemeEngine.circleBg(
                    latestTelemetry.connected ? palette.success : palette.textSecondary, null, 0
            ));
        }
        if (connNameTv == null) return;

        connNameTv.setText(latestTelemetry.deviceName);
        connStatusTv.setText(latestTelemetry.statusNote);
        connBatTv.setText(latestTelemetry.batteryPercent != null ? (latestTelemetry.batteryPercent + "%") : "לא זמין");
        connVerTv.setText(latestTelemetry.firmwareVersion);
        connTransTv.setText(latestTelemetry.transportLabel);
        String rssiStr = latestTelemetry.rssiDbm != null ? (" · " + latestTelemetry.rssiDbm + "dBm") : "";
        connMacTv.setText(latestTelemetry.macAddress + rssiStr);

        connDevicesList.removeAllViews();
        if (latestDevices.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("לא נמצאו התקנים עדיין. ודא שהרמקול דלוק ולחץ על ״סרוק וחבר בוקסה״.");
            empty.setTextSize(13f);
            empty.setTextColor(palette.textSecondary);
            empty.setPadding(0, dp(6f), 0, dp(6f));
            connDevicesList.addView(empty);
            return;
        }

        for (final DiscoveredSpeaker dev : latestDevices) {
            boolean isActive = latestTelemetry.connected && dev.address.equals(latestTelemetry.macAddress);
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackground(ThemeEngine.roundedBg(
                    this,
                    isActive ? palette.accentSoft : palette.surfaceSubtle,
                    12f,
                    (isActive || dev.isJblMatch) ? palette.accent : palette.border
            ));
            row.setPadding(dp(12f), dp(10f), dp(12f), dp(10f));
            LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            rLp.bottomMargin = dp(8f);
            row.setLayoutParams(rLp);

            row.addView(svgIcon(R.drawable.ic_speaker_bt, dev.isJblMatch ? palette.accent : palette.textSecondary, 20f));

            LinearLayout meta = new LinearLayout(this);
            meta.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams mLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            mLp.setMarginStart(dp(10f));
            mLp.setMarginEnd(dp(8f));
            meta.setLayoutParams(mLp);

            TextView dName = new TextView(this);
            dName.setText(dev.name);
            dName.setTextSize(14f);
            dName.setTypeface(Typeface.DEFAULT_BOLD);
            dName.setTextColor(palette.textPrimary);
            meta.addView(dName);

            TextView dSub = new TextView(this);
            String bondStr = dev.isBonded ? "מזווג" : "זמין בסריקה";
            dSub.setText(bondStr + " · " + dev.address + " · " + dev.rssi + "dBm");
            dSub.setTextSize(11.5f);
            dSub.setTextColor(palette.textSecondary);
            meta.addView(dSub);
            row.addView(meta);

            TextView actTv = new TextView(this);
            actTv.setText(isActive ? "מחובר" : "התחבר");
            actTv.setTextSize(12.5f);
            actTv.setTypeface(Typeface.DEFAULT_BOLD);
            actTv.setTextColor(isActive ? palette.success : palette.accent);
            actTv.setPadding(dp(8f), dp(4f), dp(8f), dp(4f));
            row.addView(actTv);

            row.setOnClickListener(v -> btController.connectToSpeaker(dev));
            connDevicesList.addView(row);
        }
    }

    // =========================================================================
    // TAB 1: שליטה ותאורה בבוקסה
    // =========================================================================
    private View buildSpeakerControlTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        // 1. Volume & Bass Boost Card
        LinearLayout audioCard = createCard();
        audioCard.addView(sectionTitle("עוצמת שמע והדגשת בס", "שליטה מהירה בעוצמה ובמצב Bass Boost של הבוקסה"));

        int curVol = playerController.getMasterVolumePercent();
        audioCard.addView(labeledSliderRow("עוצמה ראשית", curVol + "%", 0, 100, curVol, (val, tv) -> {
            tv.setText(val + "%");
            playerController.setMasterVolumePercent(val);
        }));

        TextView bassTitle = new TextView(this);
        bassTitle.setText("מצב Bass Boost");
        bassTitle.setTextSize(13f);
        bassTitle.setTypeface(Typeface.DEFAULT_BOLD);
        bassTitle.setTextColor(palette.textPrimary);
        bassTitle.setPadding(0, dp(8f), 0, dp(6f));
        audioCard.addView(bassTitle);

        LinearLayout bassRow = new LinearLayout(this);
        bassRow.setOrientation(LinearLayout.HORIZONTAL);
        BassMode[] bassModes = BassMode.values();
        for (int i = 0; i < bassModes.length; i++) {
            final BassMode mode = bassModes[i];
            boolean active = (eqController.getBassMode() == mode);
            TextView chip = selectableChip(mode.titleHe, active, () -> {
                eqController.setBassBoost(mode);
                transmitCurrentEq();
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i < bassModes.length - 1) lp.setMarginEnd(dp(6f));
            bassRow.addView(chip, lp);
        }
        audioCard.addView(bassRow);
        container.addView(audioCard);

        // 2. Lightshow Controls Card
        LinearLayout lightCard = createCard();
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams hrLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        hrLp.bottomMargin = dp(10f);
        headerRow.setLayoutParams(hrLp);

        TextView lTitle = new TextView(this);
        lTitle.setText("תאורת מופע בבוקסה (Lightshow)");
        lTitle.setTextSize(15.5f);
        lTitle.setTypeface(Typeface.DEFAULT_BOLD);
        lTitle.setTextColor(palette.textPrimary);
        lTitle.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        headerRow.addView(lTitle);

        Switch lSwitch = new Switch(this);
        lSwitch.setChecked(lightEnabled);
        lSwitch.setOnCheckedChangeListener((btn, checked) -> {
            lightEnabled = checked;
            savePersistedSettings();
            transmitCurrentLightshow();
        });
        headerRow.addView(lSwitch);
        lightCard.addView(headerRow);

        HorizontalScrollView presetsScroll = new HorizontalScrollView(this);
        presetsScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams psLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        psLp.bottomMargin = dp(12f);
        presetsScroll.setLayoutParams(psLp);

        LinearLayout presetsRow = new LinearLayout(this);
        presetsRow.setOrientation(LinearLayout.HORIZONTAL);
        for (final LightPreset preset : LightPreset.values()) {
            boolean active = (lightPreset == preset);
            TextView chip = selectableChip(preset.titleHe, active, () -> {
                lightPreset = preset;
                if (preset == LightPreset.NEON) {
                    primaryColorHex = "#00F0FF";
                    secondaryColorHex = "#E838FF";
                }
                savePersistedSettings();
                transmitCurrentLightshow();
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams cLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            cLp.setMarginEnd(dp(8f));
            presetsRow.addView(chip, cLp);
        }
        presetsScroll.addView(presetsRow);
        lightCard.addView(presetsScroll);

        TextView colorLabel = new TextView(this);
        colorLabel.setText("צבע תאורה ראשי");
        colorLabel.setTextSize(13f);
        colorLabel.setTypeface(Typeface.DEFAULT_BOLD);
        colorLabel.setTextColor(palette.textPrimary);
        colorLabel.setPadding(0, 0, 0, dp(6f));
        lightCard.addView(colorLabel);

        String[] swatchColors = new String[]{
                "#00F0FF", "#FF5A1F", "#E838FF", "#22C55E",
                "#3B82F6", "#FACC15", "#EF4444", "#FFFFFF"
        };
        LinearLayout swatchRow = new LinearLayout(this);
        swatchRow.setOrientation(LinearLayout.HORIZONTAL);
        swatchRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams srLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        srLp.bottomMargin = dp(12f);
        swatchRow.setLayoutParams(srLp);

        for (final String hex : swatchColors) {
            boolean sel = hex.equalsIgnoreCase(primaryColorHex);
            View sw = new View(this);
            int sz = sel ? dp(34f) : dp(28f);
            LinearLayout.LayoutParams swLp = new LinearLayout.LayoutParams(sz, sz);
            swLp.setMarginEnd(dp(8f));
            sw.setLayoutParams(swLp);
            sw.setBackground(ThemeEngine.circleBg(
                    Color.parseColor(hex),
                    sel ? palette.textPrimary : palette.border,
                    sel ? dp(2.5f) : dp(1f)
            ));
            sw.setOnClickListener(v -> {
                primaryColorHex = hex;
                savePersistedSettings();
                transmitCurrentLightshow();
                rebuildEntireChrome();
            });
            swatchRow.addView(sw);
        }
        lightCard.addView(swatchRow);

        lightCard.addView(labeledSliderRow("בהירות תאורה", lightBrightness + "%", 0, 100, lightBrightness, (val, tv) -> {
            lightBrightness = val;
            tv.setText(val + "%");
            savePersistedSettings();
            transmitCurrentLightshow();
        }));
        lightCard.addView(labeledSliderRow("מהירות תנועה", (lightSpeedTenths / 10f) + "x", 5, 20, lightSpeedTenths, (val, tv) -> {
            lightSpeedTenths = val;
            tv.setText((val / 10f) + "x");
            savePersistedSettings();
            transmitCurrentLightshow();
        }));

        TextView zTitle = new TextView(this);
        zTitle.setText("אזורי תאורה פעילים ברמקול");
        zTitle.setTextSize(13f);
        zTitle.setTypeface(Typeface.DEFAULT_BOLD);
        zTitle.setTextColor(palette.textPrimary);
        zTitle.setPadding(0, dp(8f), 0, dp(6f));
        lightCard.addView(zTitle);

        String[] zoneNames = new String[]{
                "טבעות וופרים", "סטרוב עליון", "סטרוב תחתון", "נצנוץ כוכבים", "פסי צד"
        };
        for (int b = 0; b < zoneNames.length; b++) {
            final int bit = b;
            boolean active = (zoneMask & (1 << bit)) != 0;
            lightCard.addView(toggleRow(zoneNames[b], active, checked -> {
                if (checked) zoneMask |= (1 << bit);
                else zoneMask &= ~(1 << bit);
                savePersistedSettings();
                transmitCurrentLightshow();
            }));
        }
        lightCard.addView(toggleRow("סנכרון תאורה לקצב המוזיקה (Beat Sync)", beatSync, checked -> {
            beatSync = checked;
            savePersistedSettings();
            transmitCurrentLightshow();
        }));
        container.addView(lightCard);

        // 3. Mic / Guitar Quick Card
        LinearLayout micCard = createCard();
        micCard.addView(sectionTitle("כניסת מיקרופון וגיטרה", "איזון עוצמת מיקרופון ואפקט Echo"));
        micCard.addView(labeledSliderRow("עוצמת מיקרופון", micVolume + "%", 0, 100, micVolume, (val, tv) -> {
            micVolume = val;
            tv.setText(val + "%");
        }));
        micCard.addView(labeledSliderRow("אפקט הד (Echo)", micEcho + "%", 0, 100, micEcho, (val, tv) -> {
            micEcho = val;
            tv.setText(val + "%");
        }));
        container.addView(micCard);

        scroll.addView(container);
        return scroll;
    }

    // =========================================================================
    // TAB 2: איקוולייזר
    // =========================================================================
    private View buildEqualizerTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        LinearLayout presetsCard = createCard();
        presetsCard.addView(sectionTitle("פרופילי איקוולייזר", "עיבוד חומרתי בזמן אמת ושידור לבוקסה"));

        List<EqPreset> allPresets = new ArrayList<>(eqController.builtInPresets);
        allPresets.addAll(eqController.getCustomProfiles());

        HorizontalScrollView hScroll = new HorizontalScrollView(this);
        hScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);

        for (final EqPreset preset : allPresets) {
            boolean active = preset.id.equals(eqController.getActivePresetId());
            TextView chip = selectableChip(preset.nameHe, active, () -> {
                eqController.applyPreset(preset);
                transmitCurrentEq();
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams cLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            cLp.setMarginEnd(dp(8f));
            row.addView(chip, cLp);
        }
        hScroll.addView(row);
        presetsCard.addView(hScroll);
        container.addView(presetsCard);

        LinearLayout bandsCard = createCard();
        bandsCard.addView(sectionTitle("כיוון 7 ערוצי תדר (-6dB עד +6dB)", null));

        float[] gains = eqController.getCurrentGainsDb();
        for (int i = 0; i < eqController.bandLabels.length; i++) {
            final int bandIdx = i;
            String freqLabel = eqController.bandLabels[i];
            float curDb = gains[i];
            int progressVal = Math.max(0, Math.min(24, Math.round((curDb + 6f) * 2f)));
            String formatted = (curDb > 0 ? "+" : "") + String.format(Locale.US, "%.1f dB", curDb);

            bandsCard.addView(labeledSliderRow(freqLabel, formatted, 0, 24, progressVal, (p, tv) -> {
                float db = (p / 2f) - 6f;
                eqController.setBandGain(bandIdx, db);
                tv.setText((db > 0 ? "+" : "") + String.format(Locale.US, "%.1f dB", db));
                transmitCurrentEq();
            }));
        }

        LinearLayout eqActions = new LinearLayout(this);
        eqActions.setOrientation(LinearLayout.HORIZONTAL);
        eqActions.setPadding(0, dp(8f), 0, 0);
        LinearLayout saveBtn = primaryActionButton("שמור פרופיל אישי", null, true, this::promptSaveCustomEqProfile);
        LinearLayout resetBtn = primaryActionButton("איפוס (0dB)", null, false, () -> {
            List<EqPreset> bp = eqController.builtInPresets;
            eqController.applyPreset(bp.get(bp.size() - 1));
            transmitCurrentEq();
            rebuildEntireChrome();
        });
        LinearLayout.LayoutParams sLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        sLp.setMarginEnd(dp(8f));
        eqActions.addView(saveBtn, sLp);
        eqActions.addView(resetBtn);
        bandsCard.addView(eqActions);
        container.addView(bandsCard);

        scroll.addView(container);
        return scroll;
    }

    private void promptSaveCustomEqProfile() {
        final EditText input = new EditText(this);
        input.setHint("שם הפרופיל (לדוגמה: באס חצר)");
        input.setTextColor(palette.textPrimary);
        input.setHintTextColor(palette.textSecondary);
        input.setPadding(dp(16f), dp(12f), dp(16f), dp(12f));

        new AlertDialog.Builder(this)
                .setTitle("שמירת פרופיל איקוולייזר")
                .setView(input)
                .setPositiveButton("שמור", (d, w) -> {
                    eqController.saveCustomProfile(input.getText().toString());
                    rebuildEntireChrome();
                })
                .setNegativeButton("ביטול", null)
                .show();
    }

    // =========================================================================
    // TAB 3: בחירת שירים ונגן
    // =========================================================================
    private View buildSongsTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        LinearLayout playerCard = createCard();
        playerCard.addView(sectionTitle("נגן ושליטה בשירים", "ניגון ישיר מהמכשיר או שליטה בנגן המערכת הפעיל"));

        songNowTitleTv = new TextView(this);
        songNowTitleTv.setTextSize(15.5f);
        songNowTitleTv.setTypeface(Typeface.DEFAULT_BOLD);
        songNowTitleTv.setTextColor(palette.textPrimary);
        playerCard.addView(songNowTitleTv);

        songNowSubTv = new TextView(this);
        songNowSubTv.setTextSize(12.5f);
        songNowSubTv.setTextColor(palette.textSecondary);
        songNowSubTv.setPadding(0, dp(2f), 0, dp(10f));
        playerCard.addView(songNowSubTv);

        songSeekBar = new SeekBar(this);
        songSeekBar.setMax(1000);
        songSeekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int p, boolean fromUser) {
                if (fromUser && playerController.getDurationMs() > 0) {
                    int target = Math.round((p / 1000f) * playerController.getDurationMs());
                    playerController.seekToMs(target);
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar sb) {}

            @Override
            public void onStopTrackingTouch(SeekBar sb) {}
        });
        playerCard.addView(songSeekBar);

        LinearLayout controlsRow = new LinearLayout(this);
        controlsRow.setOrientation(LinearLayout.HORIZONTAL);
        controlsRow.setGravity(Gravity.CENTER);
        controlsRow.setPadding(0, dp(10f), 0, dp(4f));

        LinearLayout prevBtn = iconCircleButton(R.drawable.ic_next, () -> playerController.playPrevious());
        songPlayPauseImg = svgIcon(
                playerController.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play,
                Color.WHITE, 22f
        );
        LinearLayout playBtn = new LinearLayout(this);
        playBtn.setGravity(Gravity.CENTER);
        playBtn.setBackground(ThemeEngine.circleBg(palette.accent, null, 0));
        LinearLayout.LayoutParams playLp = new LinearLayout.LayoutParams(dp(52f), dp(52f));
        playLp.setMarginStart(dp(18f));
        playLp.setMarginEnd(dp(18f));
        playBtn.setLayoutParams(playLp);
        playBtn.addView(songPlayPauseImg);
        playBtn.setOnClickListener(v -> playerController.togglePlayPause());

        LinearLayout nextBtn = iconCircleButton(R.drawable.ic_prev, () -> playerController.playNext());
        controlsRow.addView(prevBtn);
        controlsRow.addView(playBtn);
        controlsRow.addView(nextBtn);
        playerCard.addView(controlsRow);
        container.addView(playerCard);

        LinearLayout libCard = createCard();
        libCard.addView(sectionTitle("ספריית שירים במכשיר", "טעינה אוטומטית מהמכשיר או בחירת קובצי שמע מתיקייה"));

        LinearLayout btnsRow = new LinearLayout(this);
        btnsRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams brLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        brLp.bottomMargin = dp(10f);
        btnsRow.setLayoutParams(brLp);

        LinearLayout scanSongsBtn = primaryActionButton("סרוק שירי מכשיר", R.drawable.ic_refresh, true,
                this::requestAudioLibraryPermissionAndLoad);
        LinearLayout pickFilesBtn = primaryActionButton("בחר קבצים", R.drawable.ic_folder, false,
                this::openSafAudioPicker);
        LinearLayout.LayoutParams ssLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        ssLp.setMarginEnd(dp(8f));
        btnsRow.addView(scanSongsBtn, ssLp);
        btnsRow.addView(pickFilesBtn);
        libCard.addView(btnsRow);

        EditText searchBox = new EditText(this);
        searchBox.setHint("חיפוש שיר או אמן...");
        searchBox.setText(playerController.getSearchQuery());
        searchBox.setTextSize(13.5f);
        searchBox.setTextColor(palette.textPrimary);
        searchBox.setHintTextColor(palette.textSecondary);
        searchBox.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, palette.border));
        searchBox.setPadding(dp(12f), dp(10f), dp(12f), dp(10f));
        searchBox.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                playerController.setFilter(s != null ? s.toString() : "");
            }

            @Override
            public void afterTextChanged(Editable s) {}
        });
        libCard.addView(searchBox);

        songCountTv = new TextView(this);
        songCountTv.setTextSize(12f);
        songCountTv.setTextColor(palette.textSecondary);
        songCountTv.setPadding(0, dp(8f), 0, dp(6f));
        libCard.addView(songCountTv);

        songListLayout = new LinearLayout(this);
        songListLayout.setOrientation(LinearLayout.VERTICAL);
        libCard.addView(songListLayout);
        container.addView(libCard);

        refreshSongsDynamicUi();
        scroll.addView(container);
        return scroll;
    }

    private LinearLayout iconCircleButton(int iconRes, Runnable onClick) {
        LinearLayout btn = new LinearLayout(this);
        btn.setGravity(Gravity.CENTER);
        btn.setBackground(ThemeEngine.circleBg(palette.surfaceSubtle, palette.border, dp(1f)));
        btn.setLayoutParams(new LinearLayout.LayoutParams(dp(44f), dp(44f)));
        btn.addView(svgIcon(iconRes, palette.textPrimary, 18f));
        btn.setOnClickListener(v -> onClick.run());
        return btn;
    }

    private void refreshSongsDynamicUi() {
        if (songNowTitleTv == null) return;
        SongItem cur = playerController.getCurrentSong();
        songNowTitleTv.setText(cur != null ? cur.title : "לא נבחר שיר מהרשימה");
        songNowSubTv.setText(cur != null
                ? (cur.artist + " · " + cur.formattedDuration())
                : "בחר שיר מהרשימה או השתמש בכפתורי הניגון לשליטה בנגן המערכת");
        songPlayPauseImg.setImageResource(
                playerController.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play
        );
        if (playerController.getDurationMs() > 0) {
            int pct = (int) ((playerController.getCurrentPositionMs() * 1000L) / playerController.getDurationMs());
            songSeekBar.setProgress(pct);
        }

        List<SongItem> songs = playerController.getFilteredSongs();
        songCountTv.setText("נמצאו " + songs.size() + " שירים");
        songListLayout.removeAllViews();

        if (songs.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("לחץ על ״סרוק שירי מכשיר״ או ״בחר קבצים״ כדי להציג את השירים שלך.");
            empty.setTextSize(13f);
            empty.setTextColor(palette.textSecondary);
            empty.setPadding(0, dp(6f), 0, dp(6f));
            songListLayout.addView(empty);
            return;
        }

        int maxItems = Math.min(80, songs.size());
        for (int i = 0; i < maxItems; i++) {
            final int idx = i;
            SongItem song = songs.get(i);
            boolean isCur = (idx == playerController.getCurrentIndex());

            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackground(ThemeEngine.roundedBg(
                    this,
                    isCur ? palette.accentSoft : palette.surfaceSubtle,
                    10f,
                    isCur ? palette.accent : null
            ));
            row.setPadding(dp(12f), dp(9f), dp(12f), dp(9f));
            LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            rLp.bottomMargin = dp(6f);
            row.setLayoutParams(rLp);

            LinearLayout meta = new LinearLayout(this);
            meta.setOrientation(LinearLayout.VERTICAL);
            meta.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

            TextView t = new TextView(this);
            t.setText(song.title);
            t.setTextSize(13.5f);
            t.setTypeface(isCur ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            t.setTextColor(isCur ? palette.accent : palette.textPrimary);
            t.setMaxLines(1);
            t.setEllipsize(TextUtils.TruncateAt.END);
            meta.addView(t);

            TextView a = new TextView(this);
            a.setText(song.artist);
            a.setTextSize(11.5f);
            a.setTextColor(palette.textSecondary);
            a.setMaxLines(1);
            a.setEllipsize(TextUtils.TruncateAt.END);
            meta.addView(a);
            row.addView(meta);

            if (song.durationMs > 0) {
                TextView dur = new TextView(this);
                dur.setText(song.formattedDuration());
                dur.setTextSize(11.5f);
                dur.setTextColor(palette.textSecondary);
                dur.setPadding(dp(8f), 0, 0, 0);
                row.addView(dur);
            }
            row.setOnClickListener(v -> playerController.playAtIndex(idx));
            songListLayout.addView(row);
        }
    }

    // =========================================================================
    // TAB 4 (Leftmost): הגדרות הבוקסה
    // =========================================================================
    private View buildSpeakerHardwareSettingsTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        LinearLayout hwCard = createCard();
        hwCard.addView(sectionTitle("הגדרות מערכת וצלילי חיווי בבוקסה", "שליטה בצלילי ההדלקה/חיבור, חיסכון בסוללה ומצב אקוסטי"));

        hwCard.addView(toggleRow("צלילי חיווי מערכת בבוקסה (הדלקה / חיבור BT)", feedbackTonesEnabled, checked -> {
            feedbackTonesEnabled = checked;
            savePersistedSettings();
            transmitSpeakerSettings();
        }));
        hwCard.addView(toggleRow("Playtime Boost (הארכת חיי סוללה בבוקסה)", playtimeBoost, checked -> {
            playtimeBoost = checked;
            eqController.setPlaytimeLoudnessBoost(checked);
            savePersistedSettings();
            transmitSpeakerSettings();
        }));
        hwCard.addView(toggleRow("התאמה אקוסטית לשטח פתוח (Outdoor Mode)", outdoorAcoustic, checked -> {
            outdoorAcoustic = checked;
            savePersistedSettings();
            transmitCurrentEq();
        }));
        hwCard.addView(toggleRow("המתנה אוטומטית (Auto-Standby לאחר 20 דק׳)", autoStandbyEnabled, checked -> {
            autoStandbyEnabled = checked;
            savePersistedSettings();
            transmitSpeakerSettings();
        }));
        hwCard.addView(toggleRow("הדלקת תאורת מופע בעת הפעלת הבוקסה", startupLightsEnabled, checked -> {
            startupLightsEnabled = checked;
            savePersistedSettings();
            transmitSpeakerSettings();
        }));
        container.addView(hwCard);

        LinearLayout tonesCard = createCard();
        tonesCard.addView(sectionTitle("בדיקת צלילים ואפקטי בוקסה", "שליחת אות צליל ישיר לרמקול"));
        LinearLayout tonesGrid = new LinearLayout(this);
        tonesGrid.setOrientation(LinearLayout.HORIZONTAL);
        String[] toneLabels = new String[]{"צליל חיבור", "צופר מסיבה", "פולס בס"};
        for (int i = 0; i < toneLabels.length; i++) {
            final int code = i + 1;
            final String tName = toneLabels[i];
            TextView btn = selectableChip(tName, false, () -> {
                btController.sendPacket(JblProtocol.encodeFeedbackToneTrigger(code));
                Toast.makeText(this, "נשלח לבוקסה: " + tName, Toast.LENGTH_SHORT).show();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i < toneLabels.length - 1) lp.setMarginEnd(dp(6f));
            tonesGrid.addView(btn, lp);
        }
        tonesCard.addView(tonesGrid);
        container.addView(tonesCard);

        LinearLayout stereoCard = createCard();
        stereoCard.addView(sectionTitle("מצב רמקולים ו-Auracast", "הגדרת ערוץ שמע יחיד, סטריאו או שידור משותף"));
        String[] stereoLabels = new String[]{"יחיד", "סטריאו ימין", "סטריאו שמאל", "Auracast"};
        LinearLayout stereoRow = new LinearLayout(this);
        stereoRow.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < stereoLabels.length; i++) {
            final int code = i;
            TextView chip = selectableChip(stereoLabels[i], stereoModeCode == code, () -> {
                stereoModeCode = code;
                savePersistedSettings();
                transmitSpeakerSettings();
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i < stereoLabels.length - 1) lp.setMarginEnd(dp(4f));
            stereoRow.addView(chip, lp);
        }
        stereoCard.addView(stereoRow);
        container.addView(stereoCard);

        LinearLayout protoCard = createCard();
        protoCard.addView(sectionTitle("פרוטוקול תקשורת ואבחון חבילות", null));
        for (final ProtocolMode pm : ProtocolMode.values()) {
            TextView row = selectableChip(pm.titleHe, protocolMode == pm, () -> {
                protocolMode = pm;
                savePersistedSettings();
                transmitCurrentLightshow();
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            lp.bottomMargin = dp(6f);
            protoCard.addView(row, lp);
        }

        txHexLabel = new TextView(this);
        txHexLabel.setText("חבילה אחרונה (" + latestTelemetry.txPacketCount + "): " + latestTelemetry.lastTxHex);
        txHexLabel.setTextSize(11.5f);
        txHexLabel.setTypeface(Typeface.MONOSPACE);
        txHexLabel.setTextColor(palette.textSecondary);
        txHexLabel.setPadding(0, dp(6f), 0, 0);
        protoCard.addView(txHexLabel);
        container.addView(protoCard);

        scroll.addView(container);
        return scroll;
    }

    // =========================================================================
    // HEADER RIGHT MODAL: מסך הגדרות (Theme + User Guide + GitHub Auto-Update)
    // =========================================================================
    private void openSettingsDialog() {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackground(ThemeEngine.roundedBg(this, palette.bgPrimary, 20f, palette.border));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setPadding(dp(18f), dp(18f), dp(18f), dp(18f));

        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams trLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        trLp.bottomMargin = dp(14f);
        topRow.setLayoutParams(trLp);

        topRow.addView(svgIcon(R.drawable.ic_settings, palette.accent, 22f));
        TextView mTitle = new TextView(this);
        mTitle.setText("הגדרות האפליקציה");
        mTitle.setTextSize(17.5f);
        mTitle.setTypeface(Typeface.DEFAULT_BOLD);
        mTitle.setTextColor(palette.textPrimary);
        LinearLayout.LayoutParams mtLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        mtLp.setMarginStart(dp(10f));
        mTitle.setLayoutParams(mtLp);
        topRow.addView(mTitle);
        topRow.addView(selectableChip("סגור", false, dialog::dismiss));
        root.addView(topRow);

        // 1. Theme Mode Selector
        LinearLayout themeCard = createCard();
        themeCard.addView(sectionTitle("ערכת נושא ותצוגה", "בחר מצב בהיר, מצב כהה או התאמה אוטומטית למערכת"));
        LinearLayout themeRow = new LinearLayout(this);
        themeRow.setOrientation(LinearLayout.HORIZONTAL);
        ThemeModePref[] modes = new ThemeModePref[]{ThemeModePref.LIGHT, ThemeModePref.DARK, ThemeModePref.SYSTEM};
        for (int i = 0; i < modes.length; i++) {
            final ThemeModePref mode = modes[i];
            TextView chip = selectableChip(mode.labelHe, themePref == mode, () -> {
                themePref = mode;
                savePersistedSettings();
                palette = ThemeEngine.resolvePalette(this, themePref);
                applySystemBarsPalette();
                rebuildEntireChrome();
                dialog.dismiss();
                openSettingsDialog();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            if (i < modes.length - 1) lp.setMarginEnd(dp(6f));
            themeRow.addView(chip, lp);
        }
        themeCard.addView(themeRow);
        root.addView(themeCard);

        // 2. GitHub Releases Auto-Update
        LinearLayout updateCard = createCard();
        updateCard.addView(sectionTitle(
                "עדכון אוטומטי מ-GitHub Releases",
                "גרסה מותקנת: " + AppMetadata.VERSION_NAME + " (תג מובנה v" + AppMetadata.RELEASE_TAG_NUMBER + ")"
        ));
        updateCard.addView(toggleRow("בדיקת עדכונים אוטומטית בהפעלת האפליקציה", autoCheckGithubUpdates, checked -> {
            autoCheckGithubUpdates = checked;
            savePersistedSettings();
        }));

        final TextView statusTv = new TextView(this);
        if (latestReleaseInfo != null) {
            statusTv.setText(latestReleaseInfo.isNewer
                    ? ("נמצא עדכון חדש: " + latestReleaseInfo.tagName + " — " + latestReleaseInfo.title)
                    : ("האפליקציה מעודכנת לגרסה האחרונה (" + latestReleaseInfo.tagName + ")"));
        } else {
            statusTv.setText("לחץ לבדיקת התג האחרון במאגר GitHub Releases.");
        }
        statusTv.setTextSize(12.5f);
        statusTv.setTextColor(palette.textSecondary);
        statusTv.setPadding(0, dp(6f), 0, dp(8f));
        updateCard.addView(statusTv);

        final ProgressBar progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        updateCard.addView(progressBar);

        final FrameLayout installBtnHost = new FrameLayout(this);
        final Runnable renderInstallBtn = () -> {
            installBtnHost.removeAllViews();
            if (latestReleaseInfo == null || latestReleaseInfo.apkDownloadUrl == null) return;
            final ReleaseInfo info = latestReleaseInfo;
            String lbl = info.isNewer
                    ? ("הורד והתקן עדכון (" + info.tagName + ")")
                    : ("התקן מחדש מהתג האחרון (" + info.tagName + ")");
            LinearLayout dlBtn = primaryActionButton(lbl, R.drawable.ic_download, info.isNewer, () -> {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(0);
                statusTv.setText("מוריד עדכון " + info.tagName + " מ-GitHub...");
                GithubAutoUpdater.downloadAndInstall(this, info.apkDownloadUrl, info.tagName,
                        new GithubAutoUpdater.DownloadCallback() {
                            @Override
                            public void onProgress(int percent) {
                                progressBar.setProgress(percent);
                                statusTv.setText("מוריד עדכון " + info.tagName + ": " + percent + "%");
                            }

                            @Override
                            public void onComplete(File downloadedApk) {
                                progressBar.setVisibility(View.GONE);
                                statusTv.setText("ההורדה הושלמה — פותח מתקין חבילות אנדרואיד");
                            }

                            @Override
                            public void onError(String message) {
                                progressBar.setVisibility(View.GONE);
                                statusTv.setText("שגיאה בהורדה: " + message);
                            }
                        });
            });
            FrameLayout.LayoutParams flp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            flp.topMargin = dp(8f);
            installBtnHost.addView(dlBtn, flp);
        };
        renderInstallBtn.run();

        LinearLayout checkBtn = primaryActionButton("בדוק עדכונים ב-GitHub עכשיו", R.drawable.ic_refresh, true, () -> {
            statusTv.setText("בודק מול GitHub Releases...");
            GithubAutoUpdater.checkLatestRelease(new GithubAutoUpdater.ReleaseCheckCallback() {
                @Override
                public void onSuccess(ReleaseInfo info) {
                    latestReleaseInfo = info;
                    String previewNotes = info.notes.length() > 220 ? info.notes.substring(0, 220) + "..." : info.notes;
                    statusTv.setText(info.isNewer
                            ? ("זמינה גרסה חדשה ב-Releases: " + info.tagName + "\n" + previewNotes)
                            : ("מותקנת הגרסה העדכנית ביותר (תג אחרון ב-GitHub: " + info.tagName + ")"));
                    renderInstallBtn.run();
                }

                @Override
                public void onError(String message) {
                    statusTv.setText("לא ניתן לבדוק עדכונים כעת: " + message);
                }
            });
        });
        updateCard.addView(checkBtn);
        updateCard.addView(installBtnHost);
        root.addView(updateCard);

        // 3. User Guide & Detailed App Overview
        LinearLayout guideCard = createCard();
        guideCard.addView(sectionTitle("מדריך שימוש ופירוט על האפליקציה", null));
        String[][] guideItems = new String[][]{
                {"ארכיטקטורת Native מלאה", "האפליקציה כתובה ב-100% Java 17 נייטיב לאנדרואיד ללא WebView וללא HTML, להזנקה מיידית, משקל מזערי ויציבות מרבית."},
                {"1. חיבור ופרטי בוקסה (לשונית ימנית)", "הדלק את ה-JBL PartyBox 320, עבור ללשונית ״חיבור״ ולחץ על ״סרוק וחבר בוקסה״. האפליקציה פותחת ערוץ BLE GATT + SPP ומציגה שם בוקסה, סוללה, גרסת קושחה ועוצמת קליטה."},
                {"2. שליטה ותאורה", "כיוון עוצמה ראשית, 3 מצבי Bass Boost, הדלקה וכיבוי תאורת מופע, 7 אפקטים כולל ניאון, צבעים, מהירות, בהירות ו-5 אזורי LED."},
                {"3. איקוולייזר חומרתי", "7 ערוצי תדר (-6dB עד +6dB) המחוברים ישירות למנוע ה-AudioFX של אנדרואיד ולבוקסה, עם שמירת פרופילים אישיים."},
                {"4. בחירת שירים ונגן", "סריקה ישירה של כל השירים במכשיר דרך MediaStore או בחירת קבצים מתיקייה, כולל שליטה בנגן המערכת הפעיל."},
                {"5. הגדרות הבוקסה", "כיבוי/הדלקת צלילי חיווי מערכת בבוקסה, Playtime Boost, מצב שטח פתוח, הגדרת סטריאו/Auracast ובחירת פרוטוקול שידור."}
        };
        for (String[] item : guideItems) {
            TextView h = new TextView(this);
            h.setText(item[0]);
            h.setTextSize(13.5f);
            h.setTypeface(Typeface.DEFAULT_BOLD);
            h.setTextColor(palette.accent);
            h.setPadding(0, dp(6f), 0, dp(2f));
            guideCard.addView(h);

            TextView d = new TextView(this);
            d.setText(item[1]);
            d.setTextSize(12.5f);
            d.setTextColor(palette.textSecondary);
            d.setPadding(0, 0, 0, dp(6f));
            guideCard.addView(d);
        }
        root.addView(guideCard);

        scroll.addView(root);
        dialog.setContentView(scroll);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            dialog.getWindow().setLayout(
                    (int) (getResources().getDisplayMetrics().widthPixels * 0.94f),
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
        }
        dialog.show();
    }

    // =========================================================================
    // HEADER LEFT MODAL: מסך אודות (Credit "אש התורה", GitHub & Mitmachim Top, Version & What's New)
    // =========================================================================
    private void openAboutDialog() {
        final Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        ScrollView scroll = new ScrollView(this);
        scroll.setBackground(ThemeEngine.roundedBg(this, palette.bgPrimary, 20f, palette.border));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        root.setPadding(dp(18f), dp(18f), dp(18f), dp(18f));

        LinearLayout topRow = new LinearLayout(this);
        topRow.setOrientation(LinearLayout.HORIZONTAL);
        topRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams trLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        trLp.bottomMargin = dp(14f);
        topRow.setLayoutParams(trLp);

        topRow.addView(svgIcon(R.drawable.ic_info, palette.accent, 22f));
        TextView mTitle = new TextView(this);
        mTitle.setText("אודות האפליקציה");
        mTitle.setTextSize(17.5f);
        mTitle.setTypeface(Typeface.DEFAULT_BOLD);
        mTitle.setTextColor(palette.textPrimary);
        LinearLayout.LayoutParams mtLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        mtLp.setMarginStart(dp(10f));
        mTitle.setLayoutParams(mtLp);
        topRow.addView(mTitle);
        topRow.addView(selectableChip("סגור", false, dialog::dismiss));
        root.addView(topRow);

        // Developer Credit Card ("אש התורה")
        LinearLayout devCard = createCard();
        TextView appHeading = new TextView(this);
        appHeading.setText("JBL PartyBox Stage 320 — שליטה בעברית");
        appHeading.setTextSize(16f);
        appHeading.setTypeface(Typeface.DEFAULT_BOLD);
        appHeading.setTextColor(palette.textPrimary);
        devCard.addView(appHeading);

        TextView devCredit = new TextView(this);
        devCredit.setText("פיתוח והנדסה: ״" + AppMetadata.DEVELOPER_NAME + "״");
        devCredit.setTextSize(14.5f);
        devCredit.setTypeface(Typeface.DEFAULT_BOLD);
        devCredit.setTextColor(palette.accent);
        devCredit.setPadding(0, dp(4f), 0, dp(8f));
        devCard.addView(devCredit);

        TextView verDetails = new TextView(this);
        verDetails.setText(
                "גרסת אפליקציה: " + AppMetadata.VERSION_NAME
                        + " (Build " + AppMetadata.VERSION_CODE + " · Release v" + AppMetadata.RELEASE_TAG_NUMBER + ")\n"
                        + "מנוע: 100% Native Android (Java 17 + Vector SVG)"
        );
        verDetails.setTextSize(12.5f);
        verDetails.setTextColor(palette.textSecondary);
        verDetails.setPadding(0, 0, 0, dp(12f));
        devCard.addView(verDetails);

        LinearLayout githubBtn = primaryActionButton("פרופיל מפתח ב-GitHub", R.drawable.ic_github, true,
                () -> openExternalUrl(AppMetadata.GITHUB_PROFILE_URL));
        LinearLayout mitmachimBtn = primaryActionButton("פרופיל ״אש התורה״ במתמחים טופ", R.drawable.ic_forum, false,
                () -> openExternalUrl(AppMetadata.MITMACHIM_PROFILE_URL));
        LinearLayout repoBtn = primaryActionButton("מאגר הפרויקט ו-Releases ב-GitHub", R.drawable.ic_download, false,
                () -> openExternalUrl("https://github.com/" + AppMetadata.GITHUB_REPO + "/releases"));

        LinearLayout.LayoutParams btnLp1 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp1.bottomMargin = dp(8f);
        LinearLayout.LayoutParams btnLp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp2.bottomMargin = dp(8f);

        devCard.addView(githubBtn, btnLp1);
        devCard.addView(mitmachimBtn, btnLp2);
        devCard.addView(repoBtn);
        root.addView(devCard);

        // What's New Card ("מה חדש")
        LinearLayout whatsNewCard = createCard();
        whatsNewCard.addView(sectionTitle("מה חדש בגרסה " + AppMetadata.VERSION_NAME, null));
        String[] bullets = new String[]{
                "מעבר מלא לאפליקציית Native Android טהורה ב-Java 17 (ללא WebView / HTML) לביצועים מיידיים ויציבות מרבית.",
                "ממשק מודרני, נקי ומינימליסטי עם 100% אייקוני וקטור SVG ותמיכה מלאה בבהיר / כהה / מערכת.",
                "מנגנון עדכון אוטומטי ישירות מ-GitHub Releases לפי תג גרסה (הורדה והתקנה מתוך מסך ההגדרות).",
                "סרגל תחתון קבוע ומהיר (מימין לשמאל): חיבור ופרטי בוקסה, שליטה ותאורה, איקוולייזר חומרתי, בחירת שירים והגדרות מערכת הבוקסה.",
                "קריאת סוללה, גרסת קושחה ועוצמת קליטה מהבוקסה + שליטה בצלילי חיווי ומצבי Bass / Neon."
        };
        for (String line : bullets) {
            TextView b = new TextView(this);
            b.setText("• " + line);
            b.setTextSize(12.5f);
            b.setTextColor(palette.textSecondary);
            b.setPadding(0, dp(3f), 0, dp(4f));
            whatsNewCard.addView(b);
        }
        root.addView(whatsNewCard);

        scroll.addView(root);
        dialog.setContentView(scroll);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            dialog.getWindow().setLayout(
                    (int) (getResources().getDisplayMetrics().widthPixels * 0.94f),
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
        }
        dialog.show();
    }

    // =========================================================================
    // UI Helpers & Transmitters
    // =========================================================================
    private TextView selectableChip(String label, boolean active, Runnable onClick) {
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(12.5f);
        tv.setTypeface(active ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        tv.setGravity(Gravity.CENTER);
        tv.setMinimumHeight(dp(40f));
        tv.setTextColor(active ? Color.WHITE : palette.textPrimary);
        tv.setBackground(ThemeEngine.roundedBg(
                this,
                active ? palette.accent : palette.surfaceSubtle,
                10f,
                active ? null : palette.border
        ));
        tv.setPadding(dp(12f), dp(8f), dp(12f), dp(8f));
        tv.setOnClickListener(v -> onClick.run());
        return tv;
    }

    private LinearLayout toggleRow(String label, boolean checked, BoolToggleListener listener) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setMinimumHeight(dp(44f));
        row.setPadding(0, dp(4f), 0, dp(4f));

        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(13f);
        tv.setTextColor(palette.textPrimary);
        tv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(tv);

        Switch sw = new Switch(this);
        sw.setChecked(checked);
        sw.setOnCheckedChangeListener((b, isChecked) -> listener.onToggle(isChecked));
        row.addView(sw);
        return row;
    }

    private LinearLayout labeledSliderRow(
            String label,
            String valueText,
            final int minVal,
            int maxVal,
            int currentVal,
            final IntSliderListener listener
    ) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(0, dp(4f), 0, dp(6f));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView lTv = new TextView(this);
        lTv.setText(label);
        lTv.setTextSize(13f);
        lTv.setTextColor(palette.textPrimary);
        lTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(lTv);

        final TextView vTv = new TextView(this);
        vTv.setText(valueText);
        vTv.setTextSize(12.5f);
        vTv.setTypeface(Typeface.DEFAULT_BOLD);
        vTv.setTextColor(palette.accent);
        header.addView(vTv);
        wrap.addView(header);

        SeekBar sb = new SeekBar(this);
        int max = Math.max(1, maxVal - minVal);
        sb.setMax(max);
        sb.setProgress(Math.max(0, Math.min(max, currentVal - minVal)));
        sb.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int p, boolean fromUser) {
                if (fromUser) listener.onValueChanged(minVal + p, vTv);
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {}

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {}
        });
        wrap.addView(sb);
        return wrap;
    }

    private void transmitCurrentLightshow() {
        boolean raw = (protocolMode == ProtocolMode.GATT_RAW);
        byte[] packet = JblProtocol.encodeLightshowPacket(
                lightEnabled,
                lightPreset,
                zoneMask,
                lightBrightness,
                lightSpeedTenths,
                primaryColorHex,
                secondaryColorHex,
                beatSync,
                raw
        );
        btController.sendPacket(packet);
    }

    private void transmitCurrentEq() {
        byte[] packet = JblProtocol.encodeEqualizerPacket(
                eqController.getCurrentGainsDb(),
                eqController.getBassMode(),
                outdoorAcoustic
        );
        btController.sendPacket(packet);
    }

    private void transmitSpeakerSettings() {
        byte[] packet = JblProtocol.encodeSpeakerSettingsPacket(
                feedbackTonesEnabled,
                playtimeBoost,
                autoStandbyEnabled,
                startupLightsEnabled,
                stereoModeCode
        );
        btController.sendPacket(packet);
    }

    private void openExternalUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, url, Toast.LENGTH_SHORT).show();
        }
    }

    // =========================================================================
    // Runtime Permissions & Media Picker
    // =========================================================================
    private void ensureBluetoothAndScan(boolean initial) {
        List<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.BLUETOOTH_SCAN);
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
            }
        }

        if (!needed.isEmpty()) {
            if (!initial || Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                requestPermissions(needed.toArray(new String[0]), REQ_PERMISSIONS_BT);
            }
            return;
        }
        btController.refreshDevicesAndScan();
    }

    private void tryLoadMusicIfPermitted() {
        String perm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED) {
            playerController.loadDeviceMusicLibrary(null);
        }
    }

    private void requestAudioLibraryPermissionAndLoad() {
        String perm = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{perm}, REQ_PERMISSIONS_AUDIO);
            return;
        }
        playerController.loadDeviceMusicLibrary(count ->
                Toast.makeText(this, "נטענו " + count + " שירים מהמכשיר", Toast.LENGTH_SHORT).show()
        );
    }

    private void openSafAudioPicker() {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("audio/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            startActivityForResult(intent, REQ_PICK_AUDIO_FILES);
        } catch (Exception e) {
            Toast.makeText(this, "לא נמצא סייר קבצים זמין במכשיר", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean anyGranted = false;
        for (int g : grantResults) {
            if (g == PackageManager.PERMISSION_GRANTED) {
                anyGranted = true;
                break;
            }
        }
        if (requestCode == REQ_PERMISSIONS_BT && anyGranted) {
            btController.refreshDevicesAndScan();
        } else if (requestCode == REQ_PERMISSIONS_AUDIO && anyGranted) {
            playerController.loadDeviceMusicLibrary(null);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_PICK_AUDIO_FILES && resultCode == RESULT_OK && data != null) {
            List<Uri> uris = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
            for (Uri u : uris) {
                try {
                    getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                } catch (Exception ignored) {}
            }
            playerController.addPickedUris(uris);
        }
    }
}
