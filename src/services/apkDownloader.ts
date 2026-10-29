export const APK_DOWNLOAD_ENDPOINT = '/api/download-apk';
export const ZIP_DOWNLOAD_ENDPOINT = '/api/download-zip';

export const APK_FILE_NAME = 'JBL-PartyBox-320-HE.apk';
export const ZIP_FILE_NAME = 'JBL-PartyBox-320-HE-APK.zip';

async function downloadVerifiedArchive(
  endpoint: string,
  fileName: string,
  mimeType: string,
  expectedFallbackSize: number,
  onProgress?: (percent: number) => void
): Promise<{ ok: boolean; error?: string }> {
  try {
    onProgress?.(5);
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const total = Number(
      response.headers.get('content-length') || expectedFallbackSize
    );
    const reader = response.body?.getReader();

    let bytes: Uint8Array;
    if (reader) {
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (total > 0) {
            onProgress?.(Math.min(99, Math.round((received / total) * 100)));
          }
        }
      }
      bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      const buf = await response.arrayBuffer();
      bytes = new Uint8Array(buf);
    }

    // Both ZIP and APK archives start with PK\x03\x04 magic signature
    if (bytes.byteLength < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error('הקובץ שהתקבל אינו ארכיון תקין');
    }

    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    onProgress?.(100);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'שגיאה בהורדת הקובץ',
    };
  }
}

export function triggerVerifiedZipDownload(
  onProgress?: (percent: number) => void
): Promise<{ ok: boolean; error?: string }> {
  return downloadVerifiedArchive(
    ZIP_DOWNLOAD_ENDPOINT,
    ZIP_FILE_NAME,
    'application/zip',
    1725992,
    onProgress
  );
}

export function triggerVerifiedApkDownload(
  onProgress?: (percent: number) => void
): Promise<{ ok: boolean; error?: string }> {
  return downloadVerifiedArchive(
    APK_DOWNLOAD_ENDPOINT,
    APK_FILE_NAME,
    'application/vnd.android.package-archive',
    1746544,
    onProgress
  );
}
