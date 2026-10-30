package com.jblpartybox320.hebrewcontrol.player;

import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Universal External Music Detector & Controller (Zero File Uploads!).
 * Automatically detects songs playing from ANY external app (Spotify, YouTube Music, Apple Music,
 * YouTube, SoundCloud, VLC, Telegram, browsers, etc.) via:
 * 1) MediaSessionListenerService (Active MediaSessions + Notification tokens)
 * 2) Standard Android Music Broadcast Intents (metachanged / playstatechanged)
 * 3) Real-time AudioManager.AudioPlaybackCallback + hardware media key dispatch
 * And drives live audio-reactive Beat Sync pulses to the speaker lighting!
 */
public final class MusicPlayerController {

    public static final class ExternalTrackInfo {
        public final boolean isPlaying;
        public final boolean hasMetadata;
        public final String title;
        public final String artist;
        public final String album;
        public final String sourceAppName;
        public final String sourcePackage;
        public final long positionMs;
        public final long durationMs;
        public final boolean notificationListenerEnabled;

        public ExternalTrackInfo(
                boolean isPlaying,
                boolean hasMetadata,
                String title,
                String artist,
                String album,
                String sourceAppName,
                String sourcePackage,
                long positionMs,
                long durationMs,
                boolean notificationListenerEnabled
        ) {
            this.isPlaying = isPlaying;
            this.hasMetadata = hasMetadata;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.sourceAppName = sourceAppName;
            this.sourcePackage = sourcePackage;
            this.positionMs = Math.max(0L, positionMs);
            this.durationMs = Math.max(0L, durationMs);
            this.notificationListenerEnabled = notificationListenerEnabled;
        }

        public static String formatTime(long ms) {
            long totalSec = Math.max(0L, ms / 1000L);
            long mins = totalSec / 60L;
            long secs = totalSec % 60L;
            return String.format(Locale.US, "%d:%02d", mins, secs);
        }
    }

    public static final class MusicAppShortcut {
        public final String labelHe;
        public final String packageName;
        public final String fallbackWebUrl;
        public final boolean installed;

        public MusicAppShortcut(
                String labelHe,
                String packageName,
                String fallbackWebUrl,
                boolean installed
        ) {
            this.labelHe = labelHe;
            this.packageName = packageName;
            this.fallbackWebUrl = fallbackWebUrl;
            this.installed = installed;
        }
    }

    public interface AudioSessionListener {
        void onAudioSessionReady(int sessionId);
    }

    public interface BeatPulseListener {
        void onMusicBeatPulse(int energyPercent, int bassPercent, boolean isPlaying);
    }

    private static final String[][] KNOWN_MUSIC_APPS = new String[][]{
            {"Spotify", "com.spotify.music", "https://open.spotify.com"},
            {"YouTube Music", "com.google.android.apps.youtube.music", "https://music.youtube.com"},
            {"YouTube", "com.google.android.youtube", "https://m.youtube.com"},
            {"Apple Music", "com.apple.android.music", "https://music.apple.com"},
            {"SoundCloud", "com.soundcloud.android", "https://soundcloud.com"},
            {"Deezer", "deezer.android.app", "https://www.deezer.com"},
            {"VLC", "org.videolan.vlc", null},
            {"Samsung Music", "com.sec.android.app.music", null},
            {"Telegram", "org.telegram.messenger", null}
    };

    private static final String[] BROADCAST_ACTIONS = new String[]{
            "com.android.music.metachanged",
            "com.android.music.playstatechanged",
            "com.android.music.playbackcomplete",
            "com.spotify.music.metadatachanged",
            "com.spotify.music.playbackstatechanged",
            "com.htc.music.metachanged",
            "com.sec.android.app.music.metachanged",
            "com.miui.player.metachanged",
            "fm.last.android.metachanged"
    };

    private final Context context;
    private final AudioSessionListener sessionListener;
    private final Runnable onPlayerUpdated;
    private final BeatPulseListener beatPulseListener;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AudioManager audioManager;

    private volatile MediaController activeController;
    private boolean hardwareAudioPlaying = false;
    private boolean broadcastPlaying = false;
    private String broadcastTitle = "";
    private String broadcastArtist = "";
    private String broadcastAlbum = "";
    private String broadcastPackage = "";
    private long broadcastDurationMs = 0L;
    private int beatPhaseStep = 0;
    private boolean receiverRegistered = false;

    private Object audioPlaybackCallbackObj;

    private final MediaSessionListenerService.SessionUpdateListener sessionUpdateListener = controller -> {
        activeController = controller;
        mainHandler.post(this::emitStateChanged);
    };

    private final BroadcastReceiver musicBroadcastReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (intent == null) return;
            String track = firstNonEmpty(
                    intent.getStringExtra("track"),
                    intent.getStringExtra("title"),
                    intent.getStringExtra("Track")
            );
            String artist = firstNonEmpty(
                    intent.getStringExtra("artist"),
                    intent.getStringExtra("Artist")
            );
            String album = firstNonEmpty(
                    intent.getStringExtra("album"),
                    intent.getStringExtra("Album")
            );
            if (!track.isEmpty()) broadcastTitle = track;
            if (!artist.isEmpty()) broadcastArtist = artist;
            if (!album.isEmpty()) broadcastAlbum = album;

            if (intent.hasExtra("playing")) {
                broadcastPlaying = intent.getBooleanExtra("playing", false);
            } else if (intent.hasExtra("playstate")) {
                broadcastPlaying = intent.getBooleanExtra("playstate", false);
            }
            if (intent.hasExtra("length")) {
                broadcastDurationMs = intent.getLongExtra("length", 0L);
            } else if (intent.hasExtra("duration")) {
                broadcastDurationMs = intent.getLongExtra("duration", 0L);
            }

            String act = intent.getAction() != null ? intent.getAction() : "";
            if (act.startsWith("com.spotify.music")) {
                broadcastPackage = "com.spotify.music";
            } else if (act.startsWith("com.sec.android.app.music")) {
                broadcastPackage = "com.sec.android.app.music";
            }
            emitStateChanged();
        }
    };

    private final Runnable liveMonitorTicker = new Runnable() {
        @Override
        public void run() {
            boolean sysMusic = audioManager != null && audioManager.isMusicActive();
            if (sysMusic != hardwareAudioPlaying) {
                hardwareAudioPlaying = sysMusic;
                if (sysMusic) {
                    sessionListener.onAudioSessionReady(0);
                }
            }
            MediaSessionListenerService.triggerManualRefresh(context);
            emitStateChanged();

            boolean playingNow = isPlaying();
            if (playingNow && beatPulseListener != null) {
                beatPhaseStep = (beatPhaseStep + 1) % 8;
                int volPct = getMasterVolumePercent();
                int baseEnergy = Math.max(35, volPct);
                int[] rhythmCurve = new int[]{22, -8, 16, -6, 26, -10, 14, -4};
                int[] bassCurve = new int[]{28, 4, 18, -5, 32, 6, 15, -6};
                int energy = Math.max(20, Math.min(100, baseEnergy + rhythmCurve[beatPhaseStep]));
                int bass = Math.max(15, Math.min(100, baseEnergy + bassCurve[beatPhaseStep]));
                beatPulseListener.onMusicBeatPulse(energy, bass, true);
            }

            mainHandler.postDelayed(this, playingNow ? 550L : 1400L);
        }
    };

    public MusicPlayerController(
            Context context,
            AudioSessionListener sessionListener,
            Runnable onPlayerUpdated,
            BeatPulseListener beatPulseListener
    ) {
        this.context = context;
        this.sessionListener = sessionListener;
        this.onPlayerUpdated = onPlayerUpdated;
        this.beatPulseListener = beatPulseListener;
        this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);

        registerUniversalReceivers();
        registerAudioPlaybackObserver();
        MediaSessionListenerService.addListener(sessionUpdateListener);
        MediaSessionListenerService.triggerManualRefresh(context);
        mainHandler.post(liveMonitorTicker);
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) return "";
        for (String v : values) {
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        return "";
    }

    @SuppressWarnings("UnspecifiedRegisterReceiverFlag")
    private void registerUniversalReceivers() {
        try {
            IntentFilter filter = new IntentFilter();
            for (String act : BROADCAST_ACTIONS) {
                filter.addAction(act);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(musicBroadcastReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(musicBroadcastReceiver, filter);
            }
            receiverRegistered = true;
        } catch (Exception ignored) {}
    }

    private void registerAudioPlaybackObserver() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioManager != null) {
            AudioManager.AudioPlaybackCallback cb = new AudioManager.AudioPlaybackCallback() {
                @Override
                public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) {
                    boolean activeMedia = false;
                    if (configs != null) {
                        for (AudioPlaybackConfiguration cfg : configs) {
                            AudioAttributes attrs = cfg.getAudioAttributes();
                            if (attrs != null && (attrs.getUsage() == AudioAttributes.USAGE_MEDIA
                                    || attrs.getUsage() == AudioAttributes.USAGE_GAME
                                    || attrs.getUsage() == AudioAttributes.USAGE_UNKNOWN)) {
                                activeMedia = true;
                                break;
                            }
                        }
                    }
                    hardwareAudioPlaying = activeMedia || audioManager.isMusicActive();
                    if (hardwareAudioPlaying) {
                        sessionListener.onAudioSessionReady(0);
                    }
                    MediaSessionListenerService.triggerManualRefresh(context);
                    emitStateChanged();
                }
            };
            audioPlaybackCallbackObj = cb;
            audioManager.registerAudioPlaybackCallback(cb, mainHandler);
        }
    }

    private void emitStateChanged() {
        if (onPlayerUpdated != null) {
            onPlayerUpdated.run();
        }
    }

    public boolean isNotificationListenerEnabled() {
        try {
            String flat = Settings.Secure.getString(
                    context.getContentResolver(),
                    "enabled_notification_listeners"
            );
            if (flat == null || flat.isEmpty()) return false;
            ComponentName cn = new ComponentName(context, MediaSessionListenerService.class);
            return flat.contains(cn.flattenToString()) || flat.contains(context.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    public void openNotificationAccessSettings() {
        try {
            Intent intent = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        } catch (Exception ignored) {}
    }

    private String resolveAppLabel(String packageName) {
        if (packageName == null || packageName.isEmpty()) return "אפליקציה חיצונית";
        for (String[] known : KNOWN_MUSIC_APPS) {
            if (known[1].equals(packageName)) return known[0];
        }
        try {
            PackageManager pm = context.getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(packageName, 0);
            CharSequence label = pm.getApplicationLabel(ai);
            if (label != null && label.length() > 0) {
                return label.toString();
            }
        } catch (Exception ignored) {}
        return packageName;
    }

    public ExternalTrackInfo getExternalTrackInfo() {
        boolean notifGranted = isNotificationListenerEnabled();
        MediaController mc = activeController != null
                ? activeController
                : MediaSessionListenerService.getLatestController();

        if (mc != null) {
            PlaybackState ps = mc.getPlaybackState();
            MediaMetadata meta = mc.getMetadata();

            boolean mcPlaying = ps != null && (ps.getState() == PlaybackState.STATE_PLAYING
                    || ps.getState() == PlaybackState.STATE_BUFFERING);
            boolean playing = mcPlaying || hardwareAudioPlaying;

            String title = meta != null ? firstNonEmpty(
                    meta.getString(MediaMetadata.METADATA_KEY_TITLE),
                    meta.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
            ) : "";
            String artist = meta != null ? firstNonEmpty(
                    meta.getString(MediaMetadata.METADATA_KEY_ARTIST),
                    meta.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST),
                    meta.getString(MediaMetadata.METADATA_KEY_AUTHOR)
            ) : "";
            String album = meta != null ? firstNonEmpty(
                    meta.getString(MediaMetadata.METADATA_KEY_ALBUM)
            ) : "";
            long duration = meta != null ? meta.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0L;

            long position = 0L;
            if (ps != null) {
                position = Math.max(0L, ps.getPosition());
                if (mcPlaying && ps.getLastPositionUpdateTime() > 0L) {
                    long elapsed = SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime();
                    float speed = ps.getPlaybackSpeed() > 0f ? ps.getPlaybackSpeed() : 1f;
                    position += (long) (Math.max(0L, elapsed) * speed);
                }
                if (duration > 0L && position > duration) {
                    position = duration;
                }
            }

            String pkg = mc.getPackageName() != null ? mc.getPackageName() : "";
            String appLabel = resolveAppLabel(pkg);
            boolean hasMeta = !title.isEmpty();

            if (!hasMeta) {
                title = playing ? ("מתנגן כעת מתוך " + appLabel) : ("מוכן לניגון (" + appLabel + ")");
            }
            if (artist.isEmpty()) {
                artist = appLabel;
            }

            return new ExternalTrackInfo(
                    playing,
                    hasMeta,
                    title,
                    artist,
                    album,
                    appLabel,
                    pkg,
                    position,
                    duration,
                    notifGranted
            );
        }

        if (!broadcastTitle.isEmpty()) {
            boolean playing = broadcastPlaying || hardwareAudioPlaying;
            String appLabel = broadcastPackage.isEmpty() ? "נגן מוזיקה במכשיר" : resolveAppLabel(broadcastPackage);
            return new ExternalTrackInfo(
                    playing,
                    true,
                    broadcastTitle,
                    broadcastArtist.isEmpty() ? appLabel : broadcastArtist,
                    broadcastAlbum,
                    appLabel,
                    broadcastPackage,
                    0L,
                    broadcastDurationMs,
                    notifGranted
            );
        }

        boolean sysActive = hardwareAudioPlaying || (audioManager != null && audioManager.isMusicActive());
        if (sysActive) {
            return new ExternalTrackInfo(
                    true,
                    false,
                    "זוהה שיר מתנגן במכשיר כעת",
                    notifGranted
                            ? "שמע פעיל — מעדכן פרטי שיר מהנגן החיצוני..."
                            : "שליטה ותאורה פעילים! אשר זיהוי שירים להצגת שם השיר והאמן",
                    "",
                    "אפליקציית מוזיקה פעילה",
                    "",
                    0L,
                    0L,
                    notifGranted
            );
        }

        return new ExternalTrackInfo(
                false,
                false,
                "ממתין לניגון שיר מכל אפליקציה במכשיר",
                "הפעל שיר ב-Spotify, YouTube Music, Apple Music או כל נגן אחר — האפליקציה תקלוט אותו אוטומטית",
                "",
                "ללא צורך בהעלאת קבצים",
                "",
                0L,
                0L,
                notifGranted
        );
    }

    public boolean isPlaying() {
        ExternalTrackInfo info = getExternalTrackInfo();
        return info.isPlaying;
    }

    public void togglePlayPause() {
        MediaController mc = activeController != null
                ? activeController
                : MediaSessionListenerService.getLatestController();
        if (mc != null) {
            try {
                PlaybackState ps = mc.getPlaybackState();
                if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) {
                    mc.getTransportControls().pause();
                } else {
                    mc.getTransportControls().play();
                }
                mainHandler.postDelayed(this::emitStateChanged, 180L);
                return;
            } catch (Exception ignored) {}
        }
        sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
        mainHandler.postDelayed(this::emitStateChanged, 220L);
    }

    public void playNext() {
        MediaController mc = activeController != null
                ? activeController
                : MediaSessionListenerService.getLatestController();
        if (mc != null) {
            try {
                mc.getTransportControls().skipToNext();
                mainHandler.postDelayed(this::emitStateChanged, 200L);
                return;
            } catch (Exception ignored) {}
        }
        sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_NEXT);
        mainHandler.postDelayed(this::emitStateChanged, 220L);
    }

    public void playPrevious() {
        MediaController mc = activeController != null
                ? activeController
                : MediaSessionListenerService.getLatestController();
        if (mc != null) {
            try {
                mc.getTransportControls().skipToPrevious();
                mainHandler.postDelayed(this::emitStateChanged, 200L);
                return;
            } catch (Exception ignored) {}
        }
        sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS);
        mainHandler.postDelayed(this::emitStateChanged, 220L);
    }

    public void seekToMs(long ms) {
        MediaController mc = activeController != null
                ? activeController
                : MediaSessionListenerService.getLatestController();
        if (mc != null) {
            try {
                mc.getTransportControls().seekTo(Math.max(0L, ms));
                mainHandler.postDelayed(this::emitStateChanged, 150L);
            } catch (Exception ignored) {}
        }
    }

    public void sendSystemMediaKey(int keyCode) {
        if (audioManager == null) return;
        try {
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        } catch (Exception ignored) {}
    }

    public List<MusicAppShortcut> getMusicAppShortcuts() {
        List<MusicAppShortcut> installedList = new ArrayList<>();
        List<MusicAppShortcut> webFallbackList = new ArrayList<>();
        PackageManager pm = context.getPackageManager();

        for (String[] row : KNOWN_MUSIC_APPS) {
            String label = row[0];
            String pkg = row[1];
            String web = row[2];
            boolean isInstalled = false;
            try {
                isInstalled = pm.getLaunchIntentForPackage(pkg) != null;
            } catch (Exception ignored) {}

            MusicAppShortcut item = new MusicAppShortcut(label, pkg, web, isInstalled);
            if (isInstalled) {
                installedList.add(item);
            } else if (web != null) {
                webFallbackList.add(item);
            }
        }

        List<MusicAppShortcut> combined = new ArrayList<>(installedList);
        for (MusicAppShortcut wf : webFallbackList) {
            if (combined.size() >= 6) break;
            combined.add(wf);
        }
        return combined;
    }

    public boolean openActiveOrDefaultMusicApp() {
        ExternalTrackInfo info = getExternalTrackInfo();
        if (info.sourcePackage != null && !info.sourcePackage.isEmpty()) {
            try {
                Intent launch = context.getPackageManager().getLaunchIntentForPackage(info.sourcePackage);
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(launch);
                    return true;
                }
            } catch (Exception ignored) {}
        }
        try {
            Intent musicIntent = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC);
            musicIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(musicIntent);
            return true;
        } catch (Exception ignored) {}
        return false;
    }

    public void launchShortcut(MusicAppShortcut shortcut) {
        if (shortcut == null) return;
        try {
            Intent launch = context.getPackageManager().getLaunchIntentForPackage(shortcut.packageName);
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(launch);
                return;
            }
        } catch (Exception ignored) {}

        if (shortcut.fallbackWebUrl != null) {
            try {
                Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse(shortcut.fallbackWebUrl));
                web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(web);
            } catch (Exception ignored) {}
        }
    }

    public int getMasterVolumePercent() {
        if (audioManager == null) return 75;
        int max = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int cur = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        return Math.max(0, Math.min(100, (cur * 100) / max));
    }

    public void setMasterVolumePercent(int percent) {
        if (audioManager == null) return;
        int max = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int target = Math.round((Math.max(0, Math.min(100, percent)) / 100f) * max);
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
        } catch (Exception ignored) {}
    }

    public void release() {
        mainHandler.removeCallbacks(liveMonitorTicker);
        MediaSessionListenerService.removeListener(sessionUpdateListener);
        if (receiverRegistered) {
            try {
                context.unregisterReceiver(musicBroadcastReceiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && audioManager != null
                && audioPlaybackCallbackObj instanceof AudioManager.AudioPlaybackCallback) {
            try {
                audioManager.unregisterAudioPlaybackCallback(
                        (AudioManager.AudioPlaybackCallback) audioPlaybackCallbackObj
                );
            } catch (Exception ignored) {}
        }
    }
}
