import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderArchive,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  APK_DOWNLOAD_ENDPOINT,
  APK_FILE_NAME,
  ZIP_DOWNLOAD_ENDPOINT,
  ZIP_FILE_NAME,
  triggerVerifiedApkDownload,
  triggerVerifiedZipDownload,
} from '../services/apkDownloader';

export interface ApkBuildMetadata {
  fileName: string;
  zipFileName?: string;
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  targetSdk: number;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  zipSizeBytes?: number;
  zipSizeFormatted?: string;
  zipSha256?: string;
  builtAt: string;
}

interface DeviceFlowSession {
  status:
    | 'idle'
    | 'awaiting_user'
    | 'publishing'
    | 'completed'
    | 'expired'
    | 'error';
  userCode: string | null;
  verificationUri: string;
  repoName: string;
  isPrivate: boolean;
  expiresAt: number | null;
  username: string | null;
  repoUrl: string | null;
  releaseUrl: string | null;
  error: string | null;
}

const FALLBACK_META: ApkBuildMetadata = {
  fileName: APK_FILE_NAME,
  zipFileName: ZIP_FILE_NAME,
  packageName: 'com.jblpartybox320.hebrewcontrol',
  versionName: '1.0.0',
  versionCode: 1,
  minSdk: 24,
  targetSdk: 34,
  sizeBytes: 1746544,
  sizeFormatted: '1.67 MB',
  sha256: '8d7b3df67aaa6dca5c2e14eabe124a2508412453659669547597a416f018b2a2',
  zipSizeBytes: 1725992,
  zipSizeFormatted: '1.65 MB',
  zipSha256: '6b7586b1ac542afda2f5d19a934efa5d6a5d60a3dc8d6e8bf0e705f331d5f03b',
  builtAt: '2026-10-29',
};

export const ApkDownloadPanel: React.FC = () => {
  const [meta, setMeta] = useState<ApkBuildMetadata>(FALLBACK_META);
  const [downloadingKind, setDownloadingKind] = useState<'zip' | 'apk' | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [lastDownloadedFile, setLastDownloadedFile] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // GitHub Device Flow State
  const [repoName, setRepoName] = useState('jbl-partybox-320-hebrew');
  const [isPrivateRepo, setIsPrivateRepo] = useState(false);
  const [startingFlow, setStartingFlow] = useState(false);
  const [ghSession, setGhSession] = useState<DeviceFlowSession>({
    status: 'idle',
    userCode: null,
    verificationUri: 'https://github.com/login/device',
    repoName: 'jbl-partybox-320-hebrew',
    isPrivate: false,
    expiresAt: null,
    username: null,
    repoUrl: null,
    releaseUrl: null,
    error: null,
  });

  const fetchDeviceState = useCallback(() => {
    fetch('/api/github/device/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DeviceFlowSession | null) => {
        if (data) {
          setGhSession(data);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/apk-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ApkBuildMetadata | null) => {
        if (data && data.fileName) {
          setMeta({ ...FALLBACK_META, ...data });
        }
      })
      .catch(() => {});

    fetchDeviceState();
  }, [fetchDeviceState]);

  // Poll live status while awaiting user approval on GitHub or while publishing
  useEffect(() => {
    if (
      ghSession.status !== 'awaiting_user' &&
      ghSession.status !== 'publishing'
    ) {
      return;
    }
    const timer = window.setInterval(fetchDeviceState, 2500);
    return () => window.clearInterval(timer);
  }, [ghSession.status, fetchDeviceState]);

  const startGithubDeviceFlow = async (forceNewAuth = false) => {
    setStartingFlow(true);
    try {
      const res = await fetch('/api/github/device/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoName: repoName.trim() || 'jbl-partybox-320-hebrew',
          isPrivate: isPrivateRepo,
          forceNewAuth,
        }),
      });
      const data = (await res.json()) as DeviceFlowSession;
      if (res.ok && data) {
        setGhSession(data);
      }
    } catch {
      // ignore
    } finally {
      setStartingFlow(false);
    }
  };

  const handleCopyDeviceCode = async () => {
    if (!ghSession.userCode) return;
    try {
      await navigator.clipboard.writeText(ghSession.userCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      // ignore
    }
  };

  const zipName = meta.zipFileName || ZIP_FILE_NAME;
  const zipSizeLabel = meta.zipSizeFormatted || '1.65 MB';

  const handleZipDownload = async () => {
    if (downloadingKind) return;
    setDownloadingKind('zip');
    setErrorMsg(null);
    setLastDownloadedFile(null);
    const res = await triggerVerifiedZipDownload((pct) => setProgress(pct));
    setDownloadingKind(null);
    if (res.ok) {
      setLastDownloadedFile(zipName);
    } else {
      setErrorMsg(res.error || 'שגיאה בהורדת קובץ ה-ZIP');
    }
  };

  const handleApkDownload = async () => {
    if (downloadingKind) return;
    setDownloadingKind('apk');
    setErrorMsg(null);
    setLastDownloadedFile(null);
    const res = await triggerVerifiedApkDownload((pct) => setProgress(pct));
    setDownloadingKind(null);
    if (res.ok) {
      setLastDownloadedFile(meta.fileName);
    } else {
      setErrorMsg(res.error || 'שגיאה בהורדת קובץ ה-APK');
    }
  };

  const directZipFullUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${ZIP_DOWNLOAD_ENDPOINT}`
      : ZIP_DOWNLOAD_ENDPOINT;

  const handleCopyZipLink = async () => {
    try {
      await navigator.clipboard.writeText(directZipFullUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Live GitHub Device Authorization & Automatic Repo Publisher */}
      <section className="rounded-2xl border border-[#FF5500]/50 bg-[#12161E] p-6 sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-5 w-5 text-[#FF5500]" />
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                חיבור אוטומטי ל-GitHub ויצירת מאגר חדש
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-300">
              ברגע שתאשר את הקוד בקישור של GitHub, השרת ייצור עבורך אוטומטית את המאגר החדש ויעלה את כל הקוד + Release `v1.0.0` עם ה-APK וה-ZIP.
            </p>
          </div>
        </div>

        {/* Completed State */}
        {ghSession.status === 'completed' && ghSession.repoUrl && (
          <div className="mt-6 space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
            <div className="flex items-center gap-2.5 text-base font-bold text-white">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              <span>
                המאגר החדש נוצר והועלה בהצלחה לחשבון @{ghSession.username}!
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={ghSession.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#E64D00]"
              >
                <span>פתח את המאגר החדש ב-GitHub</span>
                <ExternalLink className="h-4 w-4" />
              </a>

              {ghSession.releaseUrl && (
                <a
                  href={ghSession.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/[0.15] bg-white/[0.06] px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/[0.12]"
                >
                  <span>עמוד ה-Release (הורדת APK ו-ZIP)</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Publishing in Progress State */}
        {ghSession.status === 'publishing' && (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-[#FF5500]/40 bg-[#FF5500]/10 p-5 text-sm font-semibold text-white">
            <Loader2 className="h-5 w-5 animate-spin text-[#FF5500] shrink-0" />
            <span>
              האישור התקבל! יוצר כעת את המאגר <strong className="font-mono" dir="ltr">{ghSession.repoName}</strong> ומעלה את כל הקבצים וה-APK...
            </span>
          </div>
        )}

        {/* Active Device Code Waiting for User Approval */}
        {ghSession.status === 'awaiting_user' && ghSession.userCode && (
          <div className="mt-6 space-y-4 rounded-xl border border-white/[0.1] bg-[#0B0D11] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-medium text-slate-400">
                  שלב 1 — העתק את קוד האישור החד-פעמי:
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span
                    className="font-mono text-2xl font-bold tracking-widest text-[#FF5500] sm:text-3xl"
                    dir="ltr"
                  >
                    {ghSession.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDeviceCode}
                    className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.12] cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>הועתק</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>העתק קוד</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-stretch sm:items-end gap-2">
                <a
                  href={ghSession.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#FF5500]/20 hover:bg-[#E64D00] whitespace-nowrap"
                >
                  <span>שלב 2 — פתח את GitHub לאישור החשבון</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin text-[#FF5500]" />
                  <span>ממתין לאישור שלך ב-GitHub... ההעלאה תתחיל אוטומטית מיד לאחר האישור</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Idle / Expired / Error / Custom Repo Config */}
        {(ghSession.status === 'idle' ||
          ghSession.status === 'expired' ||
          ghSession.status === 'error') && (
          <div className="mt-5 space-y-4 border-t border-white/[0.08] pt-5">
            {ghSession.error && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs text-amber-300">
                {ghSession.error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="gh-repo-name"
                  className="mb-1.5 block text-xs font-medium text-slate-300"
                >
                  שם המאגר החדש שייווצר ב-GitHub
                </label>
                <input
                  id="gh-repo-name"
                  type="text"
                  dir="ltr"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-white/[0.12] bg-[#0B0D11] px-3.5 font-mono text-sm text-white focus:border-[#FF5500] focus:outline-none"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">
                  סוג מאגר
                </span>
                <div className="grid min-h-[44px] grid-cols-2 gap-1.5 rounded-xl border border-white/[0.08] bg-[#0B0D11] p-1">
                  <button
                    type="button"
                    onClick={() => setIsPrivateRepo(false)}
                    className={`rounded-lg text-xs font-semibold transition-colors ${
                      !isPrivateRepo
                        ? 'bg-[#FF5500] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ציבורי
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrivateRepo(true)}
                    className={`rounded-lg text-xs font-semibold transition-colors ${
                      isPrivateRepo
                        ? 'bg-[#FF5500] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    פרטי
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={startingFlow}
              onClick={() => startGithubDeviceFlow(false)}
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-[#FF5500] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#E64D00] disabled:opacity-70 cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${startingFlow ? 'animate-spin' : ''}`} />
              <span>הפק קוד אישור חדש ל-GitHub והעלה אוטומטית</span>
            </button>
          </div>
        )}
      </section>

      {/* Section 2: Primary ZIP + APK Download Card */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <FolderArchive className="h-5 w-5 text-[#FF5500]" />
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                הורדת ארכיון ZIP (כולל ה-APK והוראות התקנה)
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-slate-300">
              קובץ ה-APK החתום ארוז בתוך ארכיון <strong className="font-mono text-white" dir="ltr">{zipName}</strong> להורדה חלקה וללא חסימות דפדפן, יחד עם מדריך התקנה בעברית.
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
              <span className="font-mono text-white tabular-nums" dir="ltr">
                {zipName}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#FF5500] font-semibold tabular-nums" dir="ltr">
                {zipSizeLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span>מכיל: {meta.fileName}</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2.5 sm:items-end shrink-0">
            <button
              type="button"
              disabled={downloadingKind !== null}
              onClick={handleZipDownload}
              className="flex min-h-[54px] items-center justify-center gap-2.5 rounded-xl bg-[#FF5500] px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-[#FF5500]/25 transition-colors hover:bg-[#E64D00] disabled:opacity-75 whitespace-nowrap cursor-pointer"
            >
              {downloadingKind === 'zip' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>מוריד ארכיון ZIP... {progress}%</span>
                </>
              ) : (
                <>
                  <FolderArchive className="h-5 w-5" />
                  <span>הורד קובץ ZIP ({zipSizeLabel})</span>
                </>
              )}
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={ZIP_DOWNLOAD_ENDPOINT}
                download={zipName}
                className="min-h-[38px] flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.1] whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-[#FF5500]" />
                <span>קישור ישיר ל-ZIP</span>
              </a>

              <button
                type="button"
                disabled={downloadingKind !== null}
                onClick={handleApkDownload}
                className="min-h-[38px] flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.1] whitespace-nowrap cursor-pointer"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>
                  {downloadingKind === 'apk'
                    ? `מוריד APK... ${progress}%`
                    : 'הורדת APK ללא כיווץ'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyZipLink}
                className="min-h-[38px] flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/[0.1] whitespace-nowrap cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>הקישור הועתק</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>העתק קישור ZIP</span>
                  </>
                )}
              </button>
            </div>

            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={install}
                className="min-h-[38px] rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap"
              >
                התקנה מהירה למסך הבית (PWA)
              </button>
            )}

            {!isInstalled && !isInstallable && isIOS && (
              <button
                type="button"
                onClick={() => setShowIOSGuide((v) => !v)}
                className="min-h-[38px] rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap"
              >
                הוראות התקנה ל-iPhone / iPad
              </button>
            )}
          </div>
        </div>

        {lastDownloadedFile && (
          <div className="mt-5 flex items-center gap-2.5 border-t border-white/[0.08] pt-4 text-xs text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              הקובץ <strong className="font-mono" dir="ltr">{lastDownloadedFile}</strong> נשמר בתיקיית ההורדות (Downloads). חלץ את קובץ ה-ZIP והפעל את ה-APK להתקנה.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-5 border-t border-white/[0.08] pt-4 text-xs text-amber-400">
            <span>
              אם הדפדפן חוסם הורדה אוטומטית בחלון המקדים, לחץ על{' '}
              <a href={ZIP_DOWNLOAD_ENDPOINT} download={zipName} className="underline font-semibold">
                קישור ישיר ל-ZIP
              </a>{' '}
              או על{' '}
              <a href={APK_DOWNLOAD_ENDPOINT} download={meta.fileName} className="underline font-semibold">
                קישור ישיר ל-APK
              </a>.
            </span>
          </div>
        )}

        {showIOSGuide && (
          <div className="mt-5 border-t border-white/[0.08] pt-4 text-xs leading-relaxed text-slate-300">
            <strong className="text-white">התקנה במכשירי iPhone / iPad (Safari):</strong> הקש על כפתור ה<strong>שיתוף (Share)</strong> בסרגל הדפדפן ובחר באפשרות <strong>״הוסף למסך הבית״ (Add to Home Screen)</strong> להפעלה במסך מלא.
          </div>
        )}
      </section>

      {/* Section 3: Cryptographic Verification */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-200">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          <span>פרטי ארכיון ה-ZIP וחתימה דיגיטלית</span>
        </div>

        <div className="grid grid-cols-1 gap-y-2 gap-x-8 text-xs sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-white/[0.05] py-1.5">
            <span className="text-slate-400">שם קובץ ה-ZIP</span>
            <span className="font-mono text-slate-200 tabular-nums" dir="ltr">
              {zipName}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-white/[0.05] py-1.5">
            <span className="text-slate-400">נפח ארכיון ה-ZIP</span>
            <span className="font-mono text-slate-200 tabular-nums" dir="ltr">
              {zipSizeLabel} ({(meta.zipSizeBytes || 1725992).toLocaleString()} bytes)
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-white/[0.05] py-1.5">
            <span className="text-slate-400">מזהה חבילת ה-APK בפנים</span>
            <span className="font-mono text-slate-200 tabular-nums" dir="ltr">
              {meta.packageName}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-white/[0.05] py-1.5">
            <span className="text-slate-400">אימות SHA-256 (ZIP)</span>
            <span
              className="max-w-[200px] truncate font-mono text-slate-200 tabular-nums"
              dir="ltr"
              title={meta.zipSha256}
            >
              {meta.zipSha256}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
