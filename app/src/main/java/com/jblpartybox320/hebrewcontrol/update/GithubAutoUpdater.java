package com.jblpartybox320.hebrewcontrol.update;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import com.jblpartybox320.hebrewcontrol.AppMetadata;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class GithubAutoUpdater {

    public static final class ReleaseInfo {
        public final String tagName;
        public final String title;
        public final String notes;
        public final String htmlUrl;
        public final String apkDownloadUrl;
        public final long apkSizeBytes;
        public final boolean isNewer;

        public ReleaseInfo(
                String tagName,
                String title,
                String notes,
                String htmlUrl,
                String apkDownloadUrl,
                long apkSizeBytes,
                boolean isNewer
        ) {
            this.tagName = tagName;
            this.title = title;
            this.notes = notes;
            this.htmlUrl = htmlUrl;
            this.apkDownloadUrl = apkDownloadUrl;
            this.apkSizeBytes = apkSizeBytes;
            this.isNewer = isNewer;
        }
    }

    public interface ReleaseCheckCallback {
        void onSuccess(ReleaseInfo info);
        void onError(String message);
    }

    public interface DownloadCallback {
        void onProgress(int percent);
        void onComplete(File downloadedApk);
        void onError(String message);
    }

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Pattern SEQ_TAG_PATTERN = Pattern.compile("^[vV](\\d+)$");

    private static void postToMain(Runnable action) {
        new Handler(Looper.getMainLooper()).post(action);
    }

    private GithubAutoUpdater() {}

    public static boolean isRemoteReleaseNewer(
            String remoteTag,
            int localTagNumber,
            String localVersionName
    ) {
        if (remoteTag == null) return false;
        String trimmed = remoteTag.trim();
        if (trimmed.isEmpty()) return false;

        Matcher seqMatcher = SEQ_TAG_PATTERN.matcher(trimmed);
        if (seqMatcher.matches()) {
            try {
                int remoteNum = Integer.parseInt(seqMatcher.group(1));
                return remoteNum > localTagNumber;
            } catch (NumberFormatException e) {
                return false;
            }
        }

        String cleanRemote = trimmed.replaceFirst("^[vV]", "");
        String cleanLocal = (localVersionName == null ? "" : localVersionName.trim()).replaceFirst("^[vV]", "");
        if (cleanRemote.equals(cleanLocal)) return false;

        String[] rParts = cleanRemote.split("[.-]");
        String[] lParts = cleanLocal.split("[.-]");
        int maxLen = Math.max(rParts.length, lParts.length);
        for (int i = 0; i < maxLen; i++) {
            int rv = parsePartSafe(i < rParts.length ? rParts[i] : "0");
            int lv = parsePartSafe(i < lParts.length ? lParts[i] : "0");
            if (rv != lv) return rv > lv;
        }
        return false;
    }

    private static int parsePartSafe(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    public static void checkLatestRelease(final ReleaseCheckCallback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection conn = null;
            try {
                String apiUrl = "https://api.github.com/repos/" + AppMetadata.GITHUB_REPO + "/releases/latest";
                conn = (HttpURLConnection) new URL(apiUrl).openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setRequestProperty("User-Agent", "JBLPartyBox320-Hebrew-Native/" + AppMetadata.VERSION_NAME);

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("GitHub API החזיר קוד " + code);
                }

                StringBuilder sb = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line).append('\n');
                    }
                }

                JSONObject json = new JSONObject(sb.toString());
                String tagName = json.optString("tag_name", "");
                String title = json.optString("name", tagName);
                String notes = json.optString("body", "");
                String htmlUrl = json.optString(
                        "html_url",
                        "https://github.com/" + AppMetadata.GITHUB_REPO + "/releases/latest"
                );

                String apkUrl = null;
                long apkSize = 0L;
                JSONArray assets = json.optJSONArray("assets");
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        String name = asset.optString("name", "");
                        if (name.toLowerCase().endsWith(".apk")) {
                            apkUrl = asset.optString("browser_download_url", null);
                            apkSize = asset.optLong("size", 0L);
                            break;
                        }
                    }
                }

                boolean newer = isRemoteReleaseNewer(
                        tagName,
                        AppMetadata.RELEASE_TAG_NUMBER,
                        AppMetadata.VERSION_NAME
                );

                final ReleaseInfo info = new ReleaseInfo(
                        tagName, title, notes, htmlUrl, apkUrl, apkSize, newer
                );
                postToMain(() -> callback.onSuccess(info));
            } catch (Exception e) {
                final String msg = e.getMessage() != null ? e.getMessage() : "שגיאת רשת מול GitHub";
                postToMain(() -> callback.onError(msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    public static void downloadAndInstall(
            final Activity activity,
            final String apkUrl,
            final String tagName,
            final DownloadCallback callback
    ) {
        EXECUTOR.execute(() -> {
            HttpURLConnection conn = null;
            try {
                File updatesDir = new File(activity.getCacheDir(), "updates");
                if (!updatesDir.exists()) updatesDir.mkdirs();
                String safeTag = tagName.replaceAll("[^a-zA-Z0-9._-]", "_");
                final File outFile = new File(updatesDir, "JBL-PartyBox-320-HE-" + safeTag + ".apk");

                conn = (HttpURLConnection) new URL(apkUrl).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(30_000);
                conn.setRequestProperty("User-Agent", "JBLPartyBox320-Hebrew-Native/" + AppMetadata.VERSION_NAME);

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    throw new IllegalStateException("שגיאה בהורדת הקובץ (HTTP " + code + ")");
                }

                long total = conn.getContentLengthLong();
                try (BufferedInputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(outFile)) {
                    byte[] buf = new byte[16 * 1024];
                    long downloaded = 0L;
                    int lastPct = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        downloaded += n;
                        if (total > 0) {
                            final int pct = (int) Math.min(100L, (downloaded * 100L) / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                postToMain(() -> callback.onProgress(pct));
                            }
                        }
                    }
                }

                postToMain(() -> {
                    callback.onComplete(outFile);
                    launchApkInstaller(activity, outFile);
                });
            } catch (Exception e) {
                final String msg = e.getMessage() != null ? e.getMessage() : "הורדת העדכון נכשלה";
                postToMain(() -> callback.onError(msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    public static void launchApkInstaller(Activity activity, File apkFile) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())
                );
                activity.startActivity(permIntent);
                return;
            }
        }
        Uri contentUri = ApkUpdateFileProvider.buildUriForFile(activity.getPackageName(), apkFile);
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(installIntent);
    }
}
