package com.jblpartybox320.hebrewcontrol.update;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * Zero-dependency ContentProvider serving downloaded GitHub Release APK updates
 * securely to the Android Package Installer on Android 7.0+ (API 24+).
 */
public class ApkUpdateFileProvider extends ContentProvider {

    public static Uri buildUriForFile(String packageName, File file) {
        return new Uri.Builder()
                .scheme("content")
                .authority(packageName + ".apkprovider")
                .appendPath("updates")
                .appendPath(file.getName())
                .build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolveUpdateFile(Uri uri) throws FileNotFoundException {
        Context ctx = getContext();
        if (ctx == null) throw new FileNotFoundException("Context unavailable");
        List<String> segments = uri.getPathSegments();
        if (segments == null || segments.size() < 2 || !"updates".equals(segments.get(0))) {
            throw new FileNotFoundException("Invalid URI: " + uri);
        }
        String safeName = new File(segments.get(segments.size() - 1)).getName();
        File target = new File(new File(ctx.getCacheDir(), "updates"), safeName);
        if (!target.exists()) {
            throw new FileNotFoundException("File not found: " + target.getAbsolutePath());
        }
        return target;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolveUpdateFile(uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(
            Uri uri,
            String[] projection,
            String selection,
            String[] selectionArgs,
            String sortOrder
    ) {
        try {
            File file = resolveUpdateFile(uri);
            String[] cols = projection != null
                    ? projection
                    : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
            Object[] row = new Object[cols.length];
            for (int i = 0; i < cols.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) {
                    row[i] = file.getName();
                } else if (OpenableColumns.SIZE.equals(cols[i])) {
                    row[i] = file.length();
                }
            }
            MatrixCursor cursor = new MatrixCursor(cols, 1);
            cursor.addRow(row);
            return cursor;
        } catch (Exception e) {
            return new MatrixCursor(new String[0], 0);
        }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
