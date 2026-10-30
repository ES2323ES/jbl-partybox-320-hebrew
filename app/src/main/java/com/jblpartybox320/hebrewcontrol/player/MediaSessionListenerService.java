package com.jblpartybox320.hebrewcontrol.player;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Native NotificationListenerService that observes active MediaSessions across ALL installed apps
 * (Spotify, YouTube Music, YouTube, Apple Music, VLC, Telegram, browsers, etc.) without any file uploads.
 */
public final class MediaSessionListenerService extends NotificationListenerService {

    public interface SessionUpdateListener {
        void onActiveControllerChanged(MediaController controller);
    }

    private static volatile MediaSessionListenerService activeInstance;
    private static volatile MediaController latestController;
    private static final CopyOnWriteArrayList<SessionUpdateListener> LISTENERS = new CopyOnWriteArrayList<>();

    private MediaSessionManager sessionManager;
    private final List<MediaController> trackedControllers = new ArrayList<>();

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsChangedListener =
            controllers -> evaluateControllers(controllers);

    private final MediaController.Callback controllerCallback = new MediaController.Callback() {
        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            refreshFromSystemSessions();
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            notifyListeners(latestController);
        }
    };

    public static void addListener(SessionUpdateListener listener) {
        if (listener == null) return;
        LISTENERS.addIfAbsent(listener);
        MediaSessionListenerService svc = activeInstance;
        if (svc != null) {
            svc.refreshFromSystemSessions();
        } else if (latestController != null) {
            listener.onActiveControllerChanged(latestController);
        }
    }

    public static void removeListener(SessionUpdateListener listener) {
        if (listener != null) {
            LISTENERS.remove(listener);
        }
    }

    public static MediaController getLatestController() {
        return latestController;
    }

    public static void triggerManualRefresh(Context context) {
        MediaSessionListenerService svc = activeInstance;
        if (svc != null) {
            svc.refreshFromSystemSessions();
            return;
        }
        try {
            MediaSessionManager msm = (MediaSessionManager) context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (msm != null) {
                ComponentName cn = new ComponentName(context, MediaSessionListenerService.class);
                List<MediaController> list = msm.getActiveSessions(cn);
                MediaController picked = pickBestController(context.getPackageName(), list);
                latestController = picked;
                notifyListeners(picked);
            }
        } catch (SecurityException ignored) {
            // Notification listener access not enabled yet
        } catch (Exception ignored) {}
    }

    private static void notifyListeners(MediaController controller) {
        for (SessionUpdateListener l : LISTENERS) {
            try {
                l.onActiveControllerChanged(controller);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        activeInstance = this;
        try {
            sessionManager = (MediaSessionManager) getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (sessionManager != null) {
                ComponentName cn = new ComponentName(this, MediaSessionListenerService.class);
                sessionManager.addOnActiveSessionsChangedListener(sessionsChangedListener, cn);
                refreshFromSystemSessions();
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onListenerDisconnected() {
        unregisterTrackedCallbacks();
        try {
            if (sessionManager != null) {
                sessionManager.removeOnActiveSessionsChangedListener(sessionsChangedListener);
            }
        } catch (Exception ignored) {}
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        if (getPackageName().equals(sbn.getPackageName())) return;
        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;

        MediaSession.Token token = extractMediaToken(extras);
        if (token != null) {
            try {
                MediaController mc = new MediaController(this, token);
                mc.registerCallback(controllerCallback);
                trackedControllers.add(mc);
                latestController = mc;
                notifyListeners(mc);
                return;
            } catch (Exception ignored) {}
        }
        refreshFromSystemSessions();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        refreshFromSystemSessions();
    }

    @SuppressWarnings("deprecation")
    private static MediaSession.Token extractMediaToken(Bundle extras) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return extras.getParcelable(Notification.EXTRA_MEDIA_SESSION, MediaSession.Token.class);
            }
            Object raw = extras.getParcelable(Notification.EXTRA_MEDIA_SESSION);
            if (raw instanceof MediaSession.Token) {
                return (MediaSession.Token) raw;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private void refreshFromSystemSessions() {
        try {
            if (sessionManager != null) {
                ComponentName cn = new ComponentName(this, MediaSessionListenerService.class);
                evaluateControllers(sessionManager.getActiveSessions(cn));
            }
        } catch (Exception ignored) {}
    }

    private void evaluateControllers(List<MediaController> controllers) {
        unregisterTrackedCallbacks();
        if (controllers != null) {
            for (MediaController mc : controllers) {
                if (!getPackageName().equals(mc.getPackageName())) {
                    try {
                        mc.registerCallback(controllerCallback);
                        trackedControllers.add(mc);
                    } catch (Exception ignored) {}
                }
            }
        }
        MediaController best = pickBestController(getPackageName(), controllers);
        latestController = best;
        notifyListeners(best);
    }

    private void unregisterTrackedCallbacks() {
        for (MediaController mc : trackedControllers) {
            try {
                mc.unregisterCallback(controllerCallback);
            } catch (Exception ignored) {}
        }
        trackedControllers.clear();
    }

    private static MediaController pickBestController(String selfPkg, List<MediaController> list) {
        if (list == null || list.isEmpty()) return null;
        MediaController firstExternal = null;
        for (MediaController mc : list) {
            if (selfPkg != null && selfPkg.equals(mc.getPackageName())) continue;
            if (firstExternal == null) firstExternal = mc;
            PlaybackState ps = mc.getPlaybackState();
            if (ps != null && (ps.getState() == PlaybackState.STATE_PLAYING
                    || ps.getState() == PlaybackState.STATE_BUFFERING)) {
                return mc;
            }
        }
        return firstExternal;
    }
}
