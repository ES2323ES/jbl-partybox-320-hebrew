package com.jblpartybox320.hebrewcontrol;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
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
import android.text.TextUtils;
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
import com.jblpartybox320.hebrewcontrol.player.MediaSessionListenerService;
import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController;
import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController.ExternalTrackInfo;
import com.jblpartybox320.hebrewcontrol.player.MusicPlayerController.MusicAppShortcut;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.BassMode;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightPreset;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.LightshowState;
import com.jblpartybox320.hebrewcontrol.protocol.JblProtocol.ProtocolMode;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine.Palette;
import com.jblpartybox320.hebrewcontrol.ui.ThemeEngine.ThemeModePref;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater;
import com.jblpartybox320.hebrewcontrol.update.GithubAutoUpdater.ReleaseInfo;
import com.jblpartybox320.hebrewcontrol.update.SpeakerFirmwareUpdater;
import com.jblpartybox320.hebrewcontrol.update.SpeakerFirmwareUpdater.FirmwareCheckResult;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * 100% Native Android (Java 17) Controller for JBL PartyBox Stage 320.
 * Zero WebView, zero HTML assets, zero file uploads — full bidirectional speaker lighting sync,
 * portable speaker info & direct firmware OTA update in Settings, and universal external music detection.
 */
public class MainActivity extends Activity {

    private static final int REQ_PERMISSIONS_BT = 101;

    private SharedPreferences prefs;
    private BluetoothController btController;
    private AudioEqController eqController;
    private MusicPlayerController playerController;

    private ThemeModePref themePref = ThemeModePref.SYSTEM;
    private Palette palette;
    private int activeTabIndex = 0;

    // Hardware & Full Bidirectional Lightshow Sync State
    private boolean lightEnabled = true;
    private LightPreset lightPreset = LightPreset.NEON;
    private int zoneMask = 0x1F;
    private int lightBrightness = 85;
    private int lightSpeedTenths = 10;
    private String primaryColorHex = "#00F0FF";
    private String secondaryColorHex = "#E838FF";
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
    private FirmwareCheckResult latestSpeakerFwResult = null;

    private LinearLayout rootLayout;
    private FrameLayout contentFrame;

    // Live UI References
    private View headerConnDot;
    private TextView connNameTv, connStatusTv, connBatTv, connVerTv, connTransTv, connMacTv;
    private LinearLayout connDevicesList;
    private TextView lightSyncStatusTv;
    private TextView songSourceBadgeTv, songNowTitleTv, songNowSubTv, songTimeTv;
    private ImageView songPlayPauseImg;
    private SeekBar songSeekBar;
    private FrameLayout songPermissionHost;
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
                this::refreshSongsDynamicUi,
                this::onExternalMusicBeatPulse
        );
        btController = new BluetoothController(this, new BluetoothController.Listener() {
            @Override
            public void onBluetoothStateUpdated(SpeakerTelemetry tel, List<DiscoveredSpeaker> devs) {
                latestTelemetry = tel;
                latestDevices = devs;
                refreshConnectionDynamicUi();
                refreshLightSyncBanner();
                if (txHexLabel != null) {
                    txHexLabel.setText(
                            "TX (" + tel.txPacketCount + ") · RX (" + tel.rxPacketCount + "): " + tel.lastTxHex
                    );
                }
            }

            @Override
            public void onSpeakerLightshowSynced(LightshowState remoteState) {
                if (remoteState == null) return;
                lightEnabled = remoteState.enabled;
                lightPreset = remoteState.preset;
                zoneMask = remoteState.zoneMask;
                lightBrightness = remoteState.brightness;
                lightSpeedTenths = remoteState.speedTenths;
                primaryColorHex = remoteState.primaryHex;
                secondaryColorHex = remoteState.secondaryHex;
                beatSync = remoteState.beatSync;
                savePersistedSettings();
                if (activeTabIndex == 1) {
                    renderActiveTab();
                }
            }

            @Override
            public void onSpeakerConnectedReady() {
                // Full initial lockstep sync between app state and portable speaker hardware
                transmitCurrentLightshow(false);
                transmitCurrentEq();
                transmitSpeakerSettings();
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

        if (autoCheckGithubUpdates) {
            GithubAutoUpdater.checkLatestRelease(new GithubAutoUpdater.ReleaseCheckCallback() {
                @Override
                public void onSuccess(ReleaseInfo info) {
                    latestReleaseInfo = info;
                    if (info.isNewer) {
                        Toast.makeText(
                                MainActivity.this,
                                "זמין עדכון אפליקציה ב-GitHub (" + info.tagName + ") — פתח הגדרות להתקנה",
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
    protected void onResume() {
        super.onResume();
        MediaSessionListenerService.triggerManualRefresh(this);
        refreshSongsDynamicUi();
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

    private void onExternalMusicBeatPulse(int energyPercent, int bassPercent, boolean isPlaying) {
        if (!isPlaying || !lightEnabled || !beatSync || !btController.isConnected()) {
            return;
        }
        byte[] pulseFrame = JblProtocol.encodeLightBeatPulsePacket(
                energyPercent,
                bassPercent,
                primaryColorHex,
                zoneMask
        );
        btController.sendLightshowRealtime(pulseFrame);
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
        secondaryColorHex = prefs.getString("secondary_hex", "#E838FF");
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

        // Right button: Settings (הגדרות + מידע ועדכון רמקול נייד)
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
        lightSyncStatusTv = null;
        songNowTitleTv = null;
        songPermissionHost = null;
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
        infoCard.addView(sectionTitle(
                "פרטי הבוקסה והסנכרון החי",
                "שם הרמקול, סוללה, גרסת קושחה וסנכרון דו-כיווני מלא"
        ));

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
        LinearLayout verBox = buildMetricTile("גרסת קושחת רמקול", connVerTv);
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
        LinearLayout transBox = buildMetricTile("ערוץ סנכרון", connTransTv);
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
        String batText = latestTelemetry.batteryPercent != null
                ? (latestTelemetry.batteryPercent + "%" + (latestTelemetry.isCharging ? " (בטעינה)" : ""))
                : "לא זמין";
        connBatTv.setText(batText);
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
    // TAB 1: שליטה וסנכרון תאורה מלא עם הרמקול
    // =========================================================================
    private View buildSpeakerControlTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        // 1. Lightshow Full Sync Card
        LinearLayout lightCard = createCard();
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams hrLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        hrLp.bottomMargin = dp(8f);
        headerRow.setLayoutParams(hrLp);

        TextView lTitle = new TextView(this);
        lTitle.setText("תאורת מופע בסנכרון מלא עם הרמקול");
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
            transmitCurrentLightshow(false);
            refreshLightSyncBanner();
        });
        headerRow.addView(lSwitch);
        lightCard.addView(headerRow);

        // Live Bidirectional Sync Banner + Immediate Force Sync Action
        LinearLayout syncBox = new LinearLayout(this);
        syncBox.setOrientation(LinearLayout.HORIZONTAL);
        syncBox.setGravity(Gravity.CENTER_VERTICAL);
        syncBox.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, palette.border));
        syncBox.setPadding(dp(12f), dp(9f), dp(12f), dp(9f));
        LinearLayout.LayoutParams sbLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        sbLp.bottomMargin = dp(12f);
        syncBox.setLayoutParams(sbLp);

        lightSyncStatusTv = new TextView(this);
        lightSyncStatusTv.setTextSize(12f);
        lightSyncStatusTv.setTextColor(palette.textSecondary);
        lightSyncStatusTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        syncBox.addView(lightSyncStatusTv);

        TextView forceSyncBtn = selectableChip("סנכרן עכשיו", false, () -> {
            byte[] fullPkt = buildLightshowPacket();
            btController.requestFullSpeakerSync(fullPkt);
            Toast.makeText(this, "נשלחה בקשת סנכרון מלאה מול הרמקול", Toast.LENGTH_SHORT).show();
        });
        syncBox.addView(forceSyncBtn);
        lightCard.addView(syncBox);
        refreshLightSyncBanner();

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
                transmitCurrentLightshow(false);
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

        String[] swatchColors = new String[]{
                "#00F0FF", "#FF5A1F", "#E838FF", "#22C55E",
                "#3B82F6", "#FACC15", "#EF4444", "#FFFFFF"
        };

        TextView colorLabel = new TextView(this);
        colorLabel.setText("צבע תאורה ראשי");
        colorLabel.setTextSize(13f);
        colorLabel.setTypeface(Typeface.DEFAULT_BOLD);
        colorLabel.setTextColor(palette.textPrimary);
        colorLabel.setPadding(0, 0, 0, dp(6f));
        lightCard.addView(colorLabel);
        lightCard.addView(buildColorSwatchesRow(swatchColors, primaryColorHex, hex -> {
            primaryColorHex = hex;
            savePersistedSettings();
            transmitCurrentLightshow(false);
            rebuildEntireChrome();
        }));

        TextView secColorLabel = new TextView(this);
        secColorLabel.setText("צבע תאורה משני (למעברי ניאון / זרימה)");
        secColorLabel.setTextSize(12.5f);
        secColorLabel.setTypeface(Typeface.DEFAULT_BOLD);
        secColorLabel.setTextColor(palette.textPrimary);
        secColorLabel.setPadding(0, 0, 0, dp(6f));
        lightCard.addView(secColorLabel);
        lightCard.addView(buildColorSwatchesRow(swatchColors, secondaryColorHex, hex -> {
            secondaryColorHex = hex;
            savePersistedSettings();
            transmitCurrentLightshow(false);
            rebuildEntireChrome();
        }));

        lightCard.addView(labeledSliderRow("בהירות תאורה ברמקול", lightBrightness + "%", 0, 100, lightBrightness, (val, tv) -> {
            lightBrightness = val;
            tv.setText(val + "%");
            savePersistedSettings();
            transmitCurrentLightshow(true);
        }));
        lightCard.addView(labeledSliderRow("מהירות תנועה", (lightSpeedTenths / 10f) + "x", 5, 20, lightSpeedTenths, (val, tv) -> {
            lightSpeedTenths = val;
            tv.setText((val / 10f) + "x");
            savePersistedSettings();
            transmitCurrentLightshow(true);
        }));

        TextView zTitle = new TextView(this);
        zTitle.setText("5 אזורי תאורה מסונכרנים ברמקול");
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
                transmitCurrentLightshow(false);
            }));
        }
        lightCard.addView(toggleRow("סנכרון חי אוטומטי לקצב השיר המתנגן (Beat Sync)", beatSync, checked -> {
            beatSync = checked;
            savePersistedSettings();
            transmitCurrentLightshow(false);
            refreshLightSyncBanner();
        }));
        container.addView(lightCard);

        // 2. Volume & Bass Boost Card
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

    private interface HexPickListener {
        void onPick(String hex);
    }

    private LinearLayout buildColorSwatchesRow(String[] colors, String selectedHex, HexPickListener listener) {
        LinearLayout swatchRow = new LinearLayout(this);
        swatchRow.setOrientation(LinearLayout.HORIZONTAL);
        swatchRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams srLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        srLp.bottomMargin = dp(10f);
        swatchRow.setLayoutParams(srLp);

        for (final String hex : colors) {
            boolean sel = hex.equalsIgnoreCase(selectedHex);
            View sw = new View(this);
            int sz = sel ? dp(32f) : dp(26f);
            LinearLayout.LayoutParams swLp = new LinearLayout.LayoutParams(sz, sz);
            swLp.setMarginEnd(dp(8f));
            sw.setLayoutParams(swLp);
            sw.setBackground(ThemeEngine.circleBg(
                    Color.parseColor(hex),
                    sel ? palette.textPrimary : palette.border,
                    sel ? dp(2.5f) : dp(1f)
            ));
            sw.setOnClickListener(v -> listener.onPick(hex));
            swatchRow.addView(sw);
        }
        return swatchRow;
    }

    private void refreshLightSyncBanner() {
        if (lightSyncStatusTv == null) return;
        if (!latestTelemetry.connected) {
            lightSyncStatusTv.setText("סטטוס סנכרון: הרמקול מנותק — חבר בלשונית ״חיבור״ לסנכרון חי");
            lightSyncStatusTv.setTextColor(palette.textSecondary);
            return;
        }
        String musicStr = (beatSync && playerController.isPlaying())
                ? " · פועם חי לפי השיר המתנגן!"
                : "";
        lightSyncStatusTv.setText(latestTelemetry.syncStateLabel + musicStr);
        lightSyncStatusTv.setTextColor(latestTelemetry.lightChannelReady ? palette.success : palette.accent);
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
        presetsCard.addView(sectionTitle("פרופילי איקוולייזר", "עיבוד חומרתי בזמן אמת לכל שיר מתנגן ושידור לבוקסה"));

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
    // TAB 3: שירים — זיהוי אוטומטי מכל אפליקציה במכשיר (ללא שום העלאת קבצים!)
    // =========================================================================
    private View buildSongsTab() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(dp(16f), dp(16f), dp(16f), dp(24f));

        // 1. Live Detected External Song Card
        LinearLayout liveCard = createCard();
        liveCard.addView(sectionTitle(
                "שיר מתנגן כעת במכשיר (זיהוי אוטומטי)",
                "שים שיר בכל אפליקציה שתבחר — האפליקציה קולטת אותו אוטומטית ללא העלאת קבצים"
        ));

        songSourceBadgeTv = new TextView(this);
        songSourceBadgeTv.setTextSize(12f);
        songSourceBadgeTv.setTypeface(Typeface.DEFAULT_BOLD);
        songSourceBadgeTv.setTextColor(palette.accent);
        songSourceBadgeTv.setPadding(0, 0, 0, dp(4f));
        liveCard.addView(songSourceBadgeTv);

        songNowTitleTv = new TextView(this);
        songNowTitleTv.setTextSize(16.5f);
        songNowTitleTv.setTypeface(Typeface.DEFAULT_BOLD);
        songNowTitleTv.setTextColor(palette.textPrimary);
        liveCard.addView(songNowTitleTv);

        songNowSubTv = new TextView(this);
        songNowSubTv.setTextSize(13f);
        songNowSubTv.setTextColor(palette.textSecondary);
        songNowSubTv.setPadding(0, dp(3f), 0, dp(10f));
        liveCard.addView(songNowSubTv);

        songSeekBar = new SeekBar(this);
        songSeekBar.setMax(1000);
        songSeekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar sb, int p, boolean fromUser) {
                if (fromUser) {
                    ExternalTrackInfo info = playerController.getExternalTrackInfo();
                    if (info.durationMs > 0) {
                        long target = (p * info.durationMs) / 1000L;
                        playerController.seekToMs(target);
                    }
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar sb) {}

            @Override
            public void onStopTrackingTouch(SeekBar sb) {}
        });
        liveCard.addView(songSeekBar);

        songTimeTv = new TextView(this);
        songTimeTv.setTextSize(11.5f);
        songTimeTv.setTypeface(Typeface.MONOSPACE);
        songTimeTv.setTextColor(palette.textSecondary);
        songTimeTv.setGravity(Gravity.CENTER);
        songTimeTv.setPadding(0, dp(2f), 0, dp(8f));
        liveCard.addView(songTimeTv);

        LinearLayout controlsRow = new LinearLayout(this);
        controlsRow.setOrientation(LinearLayout.HORIZONTAL);
        controlsRow.setGravity(Gravity.CENTER);
        controlsRow.setPadding(0, dp(4f), 0, dp(10f));

        LinearLayout prevBtn = iconCircleButton(R.drawable.ic_next, () -> playerController.playPrevious());
        songPlayPauseImg = svgIcon(
                playerController.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play,
                Color.WHITE, 22f
        );
        LinearLayout playBtn = new LinearLayout(this);
        playBtn.setGravity(Gravity.CENTER);
        playBtn.setBackground(ThemeEngine.circleBg(palette.accent, null, 0));
        LinearLayout.LayoutParams playLp = new LinearLayout.LayoutParams(dp(54f), dp(54f));
        playLp.setMarginStart(dp(18f));
        playLp.setMarginEnd(dp(18f));
        playBtn.setLayoutParams(playLp);
        playBtn.addView(songPlayPauseImg);
        playBtn.setOnClickListener(v -> playerController.togglePlayPause());

        LinearLayout nextBtn = iconCircleButton(R.drawable.ic_prev, () -> playerController.playNext());
        controlsRow.addView(prevBtn);
        controlsRow.addView(playBtn);
        controlsRow.addView(nextBtn);
        liveCard.addView(controlsRow);

        liveCard.addView(toggleRow("סנכרון אוטומטי של תאורת הרמקול לשיר המתנגן", beatSync, checked -> {
            beatSync = checked;
            savePersistedSettings();
            transmitCurrentLightshow(false);
        }));

        LinearLayout openActiveBtn = primaryActionButton(
                "עבור לאפליקציית המוזיקה הפעילה",
                R.drawable.ic_external_app,
                false,
                () -> {
                    if (!playerController.openActiveOrDefaultMusicApp()) {
                        Toast.makeText(this, "בחר אחת מאפליקציות המוזיקה למטה להפעלת שיר", Toast.LENGTH_SHORT).show();
                    }
                }
        );
        LinearLayout.LayoutParams oaLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        );
        oaLp.topMargin = dp(8f);
        liveCard.addView(openActiveBtn, oaLp);
        container.addView(liveCard);

        // 2. Optional 1-Tap Media Session Metadata Access Card (shown only until granted)
        songPermissionHost = new FrameLayout(this);
        container.addView(songPermissionHost);

        // 3. Quick Launch Any Music App on the Phone (Zero Uploads!)
        LinearLayout appsCard = createCard();
        appsCard.addView(sectionTitle(
                "נגן מכל אפליקציה שתבחר",
                "פתח Spotify, YouTube Music, Apple Music, YouTube או כל נגן אחר — השיר ייקלט כאן אוטומטית"
        ));

        List<MusicAppShortcut> shortcuts = playerController.getMusicAppShortcuts();
        for (final MusicAppShortcut sc : shortcuts) {
            LinearLayout appRow = new LinearLayout(this);
            appRow.setOrientation(LinearLayout.HORIZONTAL);
            appRow.setGravity(Gravity.CENTER_VERTICAL);
            appRow.setBackground(ThemeEngine.roundedBg(this, palette.surfaceSubtle, 12f, palette.border));
            appRow.setPadding(dp(12f), dp(10f), dp(12f), dp(10f));
            LinearLayout.LayoutParams arLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            arLp.bottomMargin = dp(8f);
            appRow.setLayoutParams(arLp);

            appRow.addView(svgIcon(R.drawable.ic_music, palette.accent, 18f));

            LinearLayout txtCol = new LinearLayout(this);
            txtCol.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams tcLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            tcLp.setMarginStart(dp(10f));
            txtCol.setLayoutParams(tcLp);

            TextView nameTv = new TextView(this);
            nameTv.setText(sc.labelHe);
            nameTv.setTextSize(13.5f);
            nameTv.setTypeface(Typeface.DEFAULT_BOLD);
            nameTv.setTextColor(palette.textPrimary);
            txtCol.addView(nameTv);

            TextView subTv = new TextView(this);
            subTv.setText(sc.installed ? "מותקן במכשיר — לחץ לפתיחה וניגון" : "פתיחה מהירה — קליטת שמע אוטומטית");
            subTv.setTextSize(11.5f);
            subTv.setTextColor(palette.textSecondary);
            txtCol.addView(subTv);

            appRow.addView(txtCol);
            appRow.addView(svgIcon(R.drawable.ic_external_app, palette.textSecondary, 16f));
            appRow.setOnClickListener(v -> playerController.launchShortcut(sc));
            appsCard.addView(appRow);
        }
        container.addView(appsCard);

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
        ExternalTrackInfo info = playerController.getExternalTrackInfo();

        String statusPrefix = info.isPlaying ? "מתנגן כעת · " : "בהמתנה · ";
        songSourceBadgeTv.setText(statusPrefix + info.sourceAppName);
        songSourceBadgeTv.setTextColor(info.isPlaying ? palette.success : palette.accent);

        songNowTitleTv.setText(info.title);
        String subLine = info.album != null && !info.album.isEmpty()
                ? (info.artist + " · " + info.album)
                : info.artist;
        songNowSubTv.setText(subLine);

        songPlayPauseImg.setImageResource(
                info.isPlaying ? R.drawable.ic_pause : R.drawable.ic_play
        );

        if (info.durationMs > 0) {
            int pct = (int) Math.min(1000L, (info.positionMs * 1000L) / info.durationMs);
            songSeekBar.setProgress(pct);
            songTimeTv.setText(
                    ExternalTrackInfo.formatTime(info.positionMs)
                            + " / "
                            + ExternalTrackInfo.formatTime(info.durationMs)
            );
        } else {
            songSeekBar.setProgress(info.isPlaying ? 500 : 0);
            songTimeTv.setText(info.isPlaying ? "שמע חי מזוהה בזמן אמת" : "0:00 / 0:00");
        }

        if (songPermissionHost != null) {
            songPermissionHost.removeAllViews();
            if (!info.notificationListenerEnabled) {
                LinearLayout permCard = createCard();
                permCard.addView(sectionTitle(
                        "הצגת שם השיר והאמן מכל האפליקציות",
                        "זיהוי השמע, השליטה והתאורה כבר עובדים אוטומטית. להצגת שם השיר המדויק מ-Spotify / YouTube Music אשר גישה חד-פעמית:"
                ));
                permCard.addView(primaryActionButton(
                        "אפשר זיהוי שם שיר ואמן מכל אפליקציה",
                        R.drawable.ic_music,
                        true,
                        () -> playerController.openNotificationAccessSettings()
                ));
                songPermissionHost.addView(permCard);
            }
        }
        refreshLightSyncBanner();
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
        protoCard.addView(sectionTitle("פרוטוקול תקשורת ואבחון סנכרון", null));
        for (final ProtocolMode pm : ProtocolMode.values()) {
            TextView row = selectableChip(pm.titleHe, protocolMode == pm, () -> {
                protocolMode = pm;
                savePersistedSettings();
                transmitCurrentLightshow(false);
                rebuildEntireChrome();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            );
            lp.bottomMargin = dp(6f);
            protoCard.addView(row, lp);
        }

        txHexLabel = new TextView(this);
        txHexLabel.setText(
                "TX (" + latestTelemetry.txPacketCount + ") · RX (" + latestTelemetry.rxPacketCount + "): "
                        + latestTelemetry.lastTxHex
        );
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
    // HEADER RIGHT MODAL: מסך הגדרות (Theme + Portable Speaker Info & Direct FW Update + App Update + Guide)
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
        mTitle.setText("הגדרות ומידע על הרמקול");
        mTitle.setTextSize(17f);
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

        // 2. Portable Speaker Info & Direct Firmware Update Card
        LinearLayout speakerCard = createCard();
        speakerCard.addView(sectionTitle(
                "מידע על הרמקול הנייד ועדכון קושחה",
                "פרטי ה-JBL PartyBox 320 המחובר, גרסת קושחה נוכחית ועדכון ישיר לרמקול"
        ));

        speakerCard.addView(detailKeyValueRow("דגם הרמקול הנייד", latestTelemetry.modelNumber));
        speakerCard.addView(detailKeyValueRow("שם התקן ומצב", latestTelemetry.connected
                ? (latestTelemetry.deviceName + " · מחובר")
                : "מנותק כרגע"));
        speakerCard.addView(detailKeyValueRow("ערוץ תקשורת", latestTelemetry.transportLabel));
        final TextView spkFwValueTv = new TextView(this);
        speakerCard.addView(detailKeyValueRowDynamic(
                "גרסת רמקול מותקנת",
                latestTelemetry.connected ? latestTelemetry.firmwareVersion : "חבר רמקול לזיהוי גרסה",
                spkFwValueTv
        ));
        speakerCard.addView(detailKeyValueRow("סוללת רמקול", latestTelemetry.batteryPercent != null
                ? (latestTelemetry.batteryPercent + "%" + (latestTelemetry.isCharging ? " (בטעינה)" : ""))
                : "לא זמין"));
        speakerCard.addView(detailKeyValueRow("כתובת MAC וחומרה", latestTelemetry.macAddress
                + ("—".equals(latestTelemetry.hardwareRevision) ? "" : (" · " + latestTelemetry.hardwareRevision))));

        final TextView fwStatusTv = new TextView(this);
        fwStatusTv.setTextSize(12.5f);
        fwStatusTv.setTextColor(palette.textSecondary);
        fwStatusTv.setPadding(0, dp(8f), 0, dp(8f));
        fwStatusTv.setText("בודק גרסת קושחה זמינה עבור הרמקול הנייד...");
        speakerCard.addView(fwStatusTv);

        final ProgressBar fwProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        fwProgressBar.setMax(100);
        fwProgressBar.setVisibility(View.GONE);
        speakerCard.addView(fwProgressBar);

        final FrameLayout fwDirectActionHost = new FrameLayout(this);
        final Runnable renderSpeakerFwAction = () -> {
            fwDirectActionHost.removeAllViews();
            if (latestSpeakerFwResult == null) return;
            final FirmwareCheckResult res = latestSpeakerFwResult;

            if (!res.speakerConnected) {
                fwStatusTv.setText(
                        "גרסת קושחה אחרונה זמינה לרמקול: v" + res.manifest.latestVersion
                                + "\nחבר את ה-JBL PartyBox 320 כדי לקרוא את גרסתו ולעדכן ישירות במידת הצורך."
                );
                fwStatusTv.setTextColor(palette.textSecondary);
                LinearLayout goConnectBtn = primaryActionButton(
                        "עבור ללשונית חיבור רמקול",
                        R.drawable.ic_speaker_bt,
                        false,
                        () -> {
                            dialog.dismiss();
                            activeTabIndex = 0;
                            rebuildEntireChrome();
                        }
                );
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                );
                lp.topMargin = dp(8f);
                fwDirectActionHost.addView(goConnectBtn, lp);
                return;
            }

            spkFwValueTv.setText(res.installedVersion);
            if (res.updateAvailable) {
                fwStatusTv.setText(
                        "נמצא עדכון קושחה חדש לרמקול הנייד: v" + res.manifest.latestVersion
                                + " (מותקן ברמקול: " + res.installedVersion + ")\n"
                                + res.manifest.changelogHe
                );
                fwStatusTv.setTextColor(palette.accent);

                LinearLayout otaBtn = primaryActionButton(
                        "עדכן קושחת רמקול נייד כעת (v" + res.manifest.latestVersion + ")",
                        R.drawable.ic_firmware_chip,
                        true,
                        () -> {
                            fwProgressBar.setVisibility(View.VISIBLE);
                            fwProgressBar.setProgress(0);
                            SpeakerFirmwareUpdater.startDirectSpeakerOtaUpdate(
                                    btController,
                                    res.manifest,
                                    new SpeakerFirmwareUpdater.OtaUpdateCallback() {
                                        @Override
                                        public void onProgress(int percent, String stageHe) {
                                            fwProgressBar.setProgress(percent);
                                            fwStatusTv.setText(stageHe + " (" + percent + "%)");
                                        }

                                        @Override
                                        public void onCompleted(String newFirmwareVersion) {
                                            fwProgressBar.setVisibility(View.GONE);
                                            spkFwValueTv.setText(newFirmwareVersion);
                                            latestSpeakerFwResult = new FirmwareCheckResult(
                                                    newFirmwareVersion,
                                                    res.manifest,
                                                    true,
                                                    false
                                            );
                                            fwStatusTv.setText(
                                                    "הרמקול הנייד עודכן בהצלחה לגרסה האחרונה (v" + newFirmwareVersion + ")!"
                                            );
                                            fwStatusTv.setTextColor(palette.success);
                                            fwDirectActionHost.removeAllViews();
                                            refreshConnectionDynamicUi();
                                        }

                                        @Override
                                        public void onError(String messageHe) {
                                            fwProgressBar.setVisibility(View.GONE);
                                            fwStatusTv.setText("עדכון הרמקול הופסק: " + messageHe);
                                        }
                                    }
                            );
                        }
                );
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                );
                lp.topMargin = dp(8f);
                fwDirectActionHost.addView(otaBtn, lp);
            } else {
                fwStatusTv.setText(
                        "הרמקול הנייד מעודכן לגרסת הקושחה האחרונה (v" + res.installedVersion + ")."
                );
                fwStatusTv.setTextColor(palette.success);
            }
        };

        LinearLayout checkSpkFwBtn = primaryActionButton(
                "בדוק עדכון קושחה לרמקול הנייד",
                R.drawable.ic_firmware_chip,
                false,
                () -> {
                    fwStatusTv.setText("בודק גרסת קושחה מול הרמקול הנייד...");
                    SpeakerFirmwareUpdater.checkSpeakerFirmware(latestTelemetry, result -> {
                        latestSpeakerFwResult = result;
                        renderSpeakerFwAction.run();
                    });
                }
        );
        speakerCard.addView(checkSpkFwBtn);
        speakerCard.addView(fwDirectActionHost);
        root.addView(speakerCard);

        // Auto-check speaker firmware immediately when Settings opens
        SpeakerFirmwareUpdater.checkSpeakerFirmware(latestTelemetry, result -> {
            latestSpeakerFwResult = result;
            renderSpeakerFwAction.run();
        });

        // 3. GitHub Releases Auto-Update (For the Android App)
        LinearLayout updateCard = createCard();
        updateCard.addView(sectionTitle(
                "עדכון אוטומטי לאפליקציה (GitHub Releases)",
                "גרסת אפליקציה: " + AppMetadata.VERSION_NAME + " (תג מובנה v" + AppMetadata.RELEASE_TAG_NUMBER + ")"
        ));
        updateCard.addView(toggleRow("בדיקת עדכונים אוטומטית בהפעלת האפליקציה", autoCheckGithubUpdates, checked -> {
            autoCheckGithubUpdates = checked;
            savePersistedSettings();
        }));

        final TextView statusTv = new TextView(this);
        if (latestReleaseInfo != null) {
            statusTv.setText(latestReleaseInfo.isNewer
                    ? ("נמצא עדכון חדש לאפליקציה: " + latestReleaseInfo.tagName + " — " + latestReleaseInfo.title)
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
                    ? ("הורד והתקן עדכון אפליקציה (" + info.tagName + ")")
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

        LinearLayout checkBtn = primaryActionButton("בדוק עדכוני אפליקציה ב-GitHub", R.drawable.ic_refresh, true, () -> {
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

        // 4. User Guide & Detailed App Overview
        LinearLayout guideCard = createCard();
        guideCard.addView(sectionTitle("מדריך שימוש ופירוט על האפליקציה", null));
        String[][] guideItems = new String[][]{
                {"סנכרון תאורה מלא עם הרמקול", "התאורה פועלת בסנכרון דו-כיווני מלא (BLE GATT + RFCOMM SPP) מול ה-JBL PartyBox 320, כולל סנכרון אוטומטי לקצב השיר המתנגן וקריאת שינויים מהרמקול עצמו."},
                {"מידע ועדכון קושחה לרמקול הנייד", "במסך הגדרות זה מוצגים כל פרטי הרמקול הנייד כולל גרסת הקושחה המותקנת בו ואפשרות ישירה לעדכון קושחת הרמקול במידה וקיים עדכון."},
                {"זיהוי שירים אוטומטי מכל אפליקציה", "אין צורך בשום העלאת קבצים! פשוט הפעל שיר ב-Spotify, YouTube Music, Apple Music או כל אפליקציה אחרת במכשיר — לשונית ״שירים״ קולטת את השיר המתנגן אוטומטית."},
                {"איקוולייזר חומרתי והגדרות בוקסה", "7 ערוצי תדר חומרתיים (-6dB עד +6dB), מצבי Bass Boost, צלילי חיווי, Playtime Boost ו-Auracast."}
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

    private LinearLayout detailKeyValueRow(String key, String value) {
        return detailKeyValueRowDynamic(key, value, new TextView(this));
    }

    private LinearLayout detailKeyValueRowDynamic(String key, String value, TextView valTv) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(4f), 0, dp(4f));

        TextView kTv = new TextView(this);
        kTv.setText(key + ":");
        kTv.setTextSize(12.5f);
        kTv.setTextColor(palette.textSecondary);
        kTv.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(kTv);

        valTv.setText(value);
        valTv.setTextSize(12.5f);
        valTv.setTypeface(Typeface.DEFAULT_BOLD);
        valTv.setTextColor(palette.textPrimary);
        row.addView(valTv);
        return row;
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
                "סנכרון תאורה מלא ודו-כיווני מול הרמקול (BLE GATT + RFCOMM SPP) כולל Beat Sync חי לקצב המוזיקה.",
                "מידע מלא על הרמקול הנייד במסך ההגדרות כולל זיהוי גרסת קושחת הרמקול ואפשרות ישירה לעדכון קושחה (OTA).",
                "זיהוי אוטומטי של שירים מתנגנים מכל אפליקציה במכשיר (Spotify, YouTube Music, Apple Music ועוד) — ללא צורך בשום העלאת קבצים.",
                "ממשק 100% Native Android ב-Java 17 עם אייקוני SVG וקטוריים ועדכון אוטומטי מ-GitHub Releases."
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

    private byte[] buildLightshowPacket() {
        boolean raw = (protocolMode == ProtocolMode.GATT_RAW);
        return JblProtocol.encodeLightshowPacket(
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
    }

    private void transmitCurrentLightshow(boolean coalescedSliderDrag) {
        byte[] packet = buildLightshowPacket();
        if (coalescedSliderDrag) {
            btController.sendLightshowRealtime(packet);
        } else {
            btController.sendPacket(packet);
        }
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
    // Runtime Bluetooth Permissions (Zero File/Storage Permissions!)
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
        }
    }
}
