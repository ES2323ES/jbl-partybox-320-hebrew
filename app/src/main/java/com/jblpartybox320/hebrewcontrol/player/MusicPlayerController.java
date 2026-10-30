package com.jblpartybox320.hebrewcontrol.player;

import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.KeyEvent;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MusicPlayerController {

    public static final class SongItem {
        public final String id;
        public final String title;
        public final String artist;
        public final long durationMs;
        public final Uri uri;

        public SongItem(String id, String title, String artist, long durationMs, Uri uri) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.durationMs = durationMs;
            this.uri = uri;
        }

        public String formattedDuration() {
            long totalSec = Math.max(0L, durationMs / 1000L);
            long mins = totalSec / 60L;
            long secs = totalSec % 60L;
            return String.format(Locale.US, "%d:%02d", mins, secs);
        }
    }

    public interface AudioSessionListener {
        void onAudioSessionReady(int sessionId);
    }

    public interface LibraryLoadCallback {
        void onLoaded(int count);
    }

    private final Context context;
    private final AudioSessionListener sessionListener;
    private final Runnable onPlayerUpdated;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AudioManager audioManager;

    private MediaPlayer mediaPlayer;
    private final List<SongItem> allSongs = new ArrayList<>();
    private List<SongItem> filteredSongs = Collections.emptyList();
    private int currentIndex = -1;
    private boolean isPlaying = false;
    private String searchQuery = "";

    public MusicPlayerController(
            Context context,
            AudioSessionListener sessionListener,
            Runnable onPlayerUpdated
    ) {
        this.context = context;
        this.sessionListener = sessionListener;
        this.onPlayerUpdated = onPlayerUpdated;
        this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    public List<SongItem> getFilteredSongs() {
        return filteredSongs;
    }

    public int getCurrentIndex() {
        return currentIndex;
    }

    public boolean isPlaying() {
        return isPlaying;
    }

    public String getSearchQuery() {
        return searchQuery;
    }

    public SongItem getCurrentSong() {
        return (currentIndex >= 0 && currentIndex < filteredSongs.size())
                ? filteredSongs.get(currentIndex)
                : null;
    }

    public int getCurrentPositionMs() {
        try {
            return mediaPlayer != null ? mediaPlayer.getCurrentPosition() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public int getDurationMs() {
        try {
            return mediaPlayer != null ? Math.max(0, mediaPlayer.getDuration()) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    public void loadDeviceMusicLibrary(final LibraryLoadCallback callback) {
        executor.execute(() -> {
            final List<SongItem> loaded = new ArrayList<>();
            try {
                String[] projection = new String[]{
                        MediaStore.Audio.Media._ID,
                        MediaStore.Audio.Media.TITLE,
                        MediaStore.Audio.Media.ARTIST,
                        MediaStore.Audio.Media.DURATION
                };
                String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
                String sortOrder = MediaStore.Audio.Media.TITLE + " COLLATE LOCALIZED ASC";

                try (Cursor cursor = context.getContentResolver().query(
                        MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        projection,
                        selection,
                        null,
                        sortOrder
                )) {
                    if (cursor != null) {
                        int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                        int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                        int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                        int durCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);

                        while (cursor.moveToNext() && loaded.size() < 500) {
                            long id = cursor.getLong(idCol);
                            String title = cursor.getString(titleCol);
                            String rawArtist = cursor.getString(artistCol);
                            long dur = cursor.getLong(durCol);
                            if (title != null && !title.trim().isEmpty() && dur >= 1500L) {
                                String artist = (rawArtist == null || rawArtist.trim().isEmpty() || "<unknown>".equals(rawArtist))
                                        ? "אמן לא ידוע"
                                        : rawArtist.trim();
                                Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                                loaded.add(new SongItem("ms_" + id, title.trim(), artist, dur, uri));
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}

            mainHandler.post(() -> {
                List<SongItem> safPicked = new ArrayList<>();
                for (SongItem s : allSongs) {
                    if (s.id.startsWith("saf_")) safPicked.add(s);
                }
                allSongs.clear();
                allSongs.addAll(safPicked);
                allSongs.addAll(loaded);
                applyFilterInternal();
                if (callback != null) callback.onLoaded(allSongs.size());
                onPlayerUpdated.run();
            });
        });
    }

    public void addPickedUris(List<Uri> uris) {
        if (uris == null || uris.isEmpty()) return;
        for (Uri uri : uris) {
            String displayName = uri.getLastPathSegment() != null ? uri.getLastPathSegment() : "קובץ שמע";
            try (Cursor c = context.getContentResolver().query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0 && c.getString(idx) != null) {
                        displayName = c.getString(idx);
                    }
                }
            } catch (Exception ignored) {}

            int dot = displayName.lastIndexOf('.');
            String cleanTitle = dot > 0 ? displayName.substring(0, dot) : displayName;
            boolean exists = false;
            for (SongItem item : allSongs) {
                if (item.uri.equals(uri)) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                allSongs.add(0, new SongItem("saf_" + System.nanoTime(), cleanTitle, "נבחר מהמכשיר", 0L, uri));
            }
        }
        applyFilterInternal();
        if (currentIndex == -1 && !filteredSongs.isEmpty()) {
            playAtIndex(0);
        } else {
            onPlayerUpdated.run();
        }
    }

    public void setFilter(String query) {
        SongItem cur = getCurrentSong();
        String curId = cur != null ? cur.id : null;
        this.searchQuery = query != null ? query : "";
        applyFilterInternal();
        currentIndex = -1;
        if (curId != null) {
            for (int i = 0; i < filteredSongs.size(); i++) {
                if (curId.equals(filteredSongs.get(i).id)) {
                    currentIndex = i;
                    break;
                }
            }
        }
        onPlayerUpdated.run();
    }

    private void applyFilterInternal() {
        String q = searchQuery.trim().toLowerCase();
        if (q.isEmpty()) {
            filteredSongs = new ArrayList<>(allSongs);
            return;
        }
        List<SongItem> out = new ArrayList<>();
        for (SongItem s : allSongs) {
            if (s.title.toLowerCase().contains(q) || s.artist.toLowerCase().contains(q)) {
                out.add(s);
            }
        }
        filteredSongs = out;
    }

    public void playAtIndex(int index) {
        if (index < 0 || index >= filteredSongs.size()) return;
        SongItem song = filteredSongs.get(index);
        currentIndex = index;
        try {
            if (mediaPlayer != null) mediaPlayer.release();
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
            mp.setDataSource(context, song.uri);
            mp.setOnPreparedListener(player -> {
                sessionListener.onAudioSessionReady(player.getAudioSessionId());
                player.start();
                isPlaying = true;
                onPlayerUpdated.run();
            });
            mp.setOnCompletionListener(player -> playNext());
            mp.prepareAsync();
            mediaPlayer = mp;
        } catch (Exception e) {
            isPlaying = false;
            onPlayerUpdated.run();
        }
    }

    public void togglePlayPause() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.pause();
                    isPlaying = false;
                } else {
                    mediaPlayer.start();
                    isPlaying = true;
                }
                onPlayerUpdated.run();
                return;
            } catch (Exception ignored) {}
        }
        if (!filteredSongs.isEmpty()) {
            playAtIndex(0);
        } else {
            sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
        }
    }

    public void playNext() {
        if (filteredSongs.isEmpty()) {
            sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_NEXT);
            return;
        }
        int next = (currentIndex + 1) % filteredSongs.size();
        playAtIndex(next);
    }

    public void playPrevious() {
        if (filteredSongs.isEmpty()) {
            sendSystemMediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS);
            return;
        }
        int prev = currentIndex <= 0 ? filteredSongs.size() - 1 : currentIndex - 1;
        playAtIndex(prev);
    }

    public void seekToMs(int ms) {
        try {
            if (mediaPlayer != null) {
                mediaPlayer.seekTo(Math.max(0, ms));
                onPlayerUpdated.run();
            }
        } catch (Exception ignored) {}
    }

    public void sendSystemMediaKey(int keyCode) {
        try {
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
            audioManager.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        } catch (Exception ignored) {}
    }

    public int getMasterVolumePercent() {
        int max = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int cur = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC);
        return Math.max(0, Math.min(100, (cur * 100) / max));
    }

    public void setMasterVolumePercent(int percent) {
        int max = Math.max(1, audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        int target = Math.round((Math.max(0, Math.min(100, percent)) / 100f) * max);
        try {
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
        } catch (Exception ignored) {}
    }

    public void release() {
        try { if (mediaPlayer != null) mediaPlayer.release(); } catch (Exception ignored) {}
        mediaPlayer = null;
        executor.shutdownNow();
    }
}
