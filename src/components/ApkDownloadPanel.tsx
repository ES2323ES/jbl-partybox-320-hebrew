import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FolderArchive,
  GitBranch,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { APP_VERSION } from '../types/speaker';
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
  latestReleaseTag: string | null;
  hasPermanentKey: boolean;
  deployKeyInstalled: boolean;
  error: string | null;
}

const FALLBACK_META: ApkBuildMetadata = {
  fileName: APK_FILE_NAME,
  zipFileName: ZIP_FILE_NAME,
  packageName: 'com.jblpartybox320.hebrewcontrol',
  versionName: APP_VERSION,
  versionCode: 2,
  minSdk: 24,
  targetSdk: 34,
  sizeBytes: 5252881,
  sizeFormatted: '5.01 MB',
  sha256: 'dfdcdabbeb56cba4ea9c97646d18fb54b1bc2842c5dc469be3e6cecbd417c6d4',
  zipSizeBytes: 5206030,
  zipSizeFormatted: '4.96 MB',
  zipSha256: 'aef23d84526c300f2b1fb2f6c8ba8893c3a89ba22a6d4762b20ac36593f0a5e7',
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

  // GitHub Permanent Key & Auto-Release (v2, v3, v4...) State
  const [repoName, setRepoName] = useState('jbl-partybox-320-hebrew');
  const [isPrivateRepo, setIsPrivateRepo] = useState(false);
  const [startingFlow, setStartingFlow] = useState(false);
  const [pushingUpdate, setPushingUpdate] = useState(false);
  const [ghSession, setGhSession] = useState<DeviceFlowSession>({
    status: 'idle',
    userCode: null,
    verificationUri: 'https://github.com/login/device',
    repoName: 'jbl-partybox-320-hebrew',
    isPrivate: false,
    expiresAt: null,
    username: 'ES2323ES',
    repoUrl: 'https://github.com/ES2323ES/jbl-partybox-320-hebrew',
    releaseUrl: null,
    latestReleaseTag: null,
    hasPermanentKey: false,
    deployKeyInstalled: false,
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

  const handlePushNextRelease = async () => {
    setPushingUpdate(true);
    try {
      const res = await fetch('/api/github/push-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await res.json()) as DeviceFlowSession;
      if (data) {
        setGhSession(data);
      }
    } catch {
      // ignore
    } finally {
      setPushingUpdate(false);
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
    <div className="space-y-6">
      {/* Section 1: Primary ZIP + APK Download Card (v0.2.2) */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <FolderArchive className="h-5 w-5 text-[#D95B2B]" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                הורדת האפליקציה לאנדרואיד — גרסה {meta.versionName}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              חבילת ההתקנה המעודכנת (<strong className="font-mono" dir="ltr">v{meta.versionName}</strong>) כוללת עיצוב נעים לעין, הרשאות Bluetooth מלאות לסריקה וזיווג מול ה-JBL PartyBox 320, וסנכרון עוצמת שמע ואיקוולייזר.
            </p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums" dir="ltr">
                {zipName}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-[#D95B2B] tabular-nums" dir="ltr">
                {zipSizeLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span>כולל הרשאות Bluetooth + שמע</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2.5 sm:items-end shrink-0">
            <button
              type="button"
              disabled={downloadingKind !== null}
              onClick={handleZipDownload}
              className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-[#D95B2B] px-6 py-3 text-base font-bold text-white transition-colors hover:bg-[#C24E22] disabled:opacity-75 whitespace-nowrap cursor-pointer"
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
                className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>קישור ישיר ל-ZIP</span>
              </a>

              <button
                type="button"
                disabled={downloadingKind !== null}
                onClick={handleApkDownload}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>
                  {downloadingKind === 'apk'
                    ? `מוריד APK... ${progress}%`
                    : 'הורדת APK ישיר'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleCopyZipLink}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    <span>הקישור הועתק</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>העתק קישור</span>
                  </>
                )}
              </button>
            </div>

            {!isInstalled && isInstallable && (
              <button
                type="button"
                onClick={install}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 whitespace-nowrap cursor-pointer"
              >
                התקנה מהירה למסך הבית (PWA)
              </button>
            )}

            {!isInstalled && !isInstallable && isIOS && (
              <button
                type="button"
                onClick={() => setShowIOSGuide((v) => !v)}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 whitespace-nowrap cursor-pointer"
              >
                הוראות התקנה ל-iPhone / iPad
              </button>
            )}
          </div>
        </div>

        {lastDownloadedFile && (
          <div className="mt-5 flex items-center gap-2.5 border-t border-slate-200/80 pt-4 text-xs text-teal-700 dark:border-slate-700/60 dark:text-teal-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              הקובץ <strong className="font-mono" dir="ltr">{lastDownloadedFile}</strong> נשמר בתיקיית ההורדות.
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="mt-5 border-t border-slate-200/80 pt-4 text-xs text-amber-700 dark:border-slate-700/60 dark:text-amber-300">
            <span>
              להורדה ישירה לחץ על{' '}
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
          <div className="mt-5 border-t border-slate-200/80 pt-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700/60 dark:text-slate-300">
            <strong className="text-slate-900 dark:text-white">התקנה במכשירי iPhone / iPad (Safari):</strong> הקש על כפתור ה<strong>שיתוף (Share)</strong> בסרגל הדפדפן ובחר באפשרות <strong>״הוסף למסך הבית״ (Add to Home Screen)</strong>.
          </div>
        )}
      </section>

      {/* Section 2: Permanent GitHub Key & Automatic Sequential Versioning (v2, v3, v4...) */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-5 w-5 text-[#D95B2B]" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                מפתח GitHub קבוע וניהול גרסאות אוטומטי (v2, v3, v4...)
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              האפליקציה שומרת מפתח חיבור קבוע (Deploy Key + אסימון קבוע) למאגר שלך ב-GitHub, ויוצרת אוטומטית בכל עדכון Release ממוספר חדש (<strong className="font-mono" dir="ltr">v2</strong>, <strong className="font-mono" dir="ltr">v3</strong>, <strong className="font-mono" dir="ltr">v4</strong> וכן הלאה).
            </p>
          </div>
        </div>

        {/* Permanent Key Status Strip */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-700 dark:bg-[#141B27]">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
            <KeyRound className="h-4 w-4 text-[#D95B2B]" />
            <span>
              סטטוס מפתח GitHub קבוע:{' '}
              <strong>
                {ghSession.hasPermanentKey
                  ? ghSession.deployKeyInstalled
                    ? 'פעיל ומחובר קבוע (SSH Deploy Key + API)'
                    : 'פעיל ומחובר קבוע'
                  : 'ממתין לאישור חד-פעמי לשמירת מפתח קבוע'}
              </strong>
            </span>
          </div>
          {ghSession.latestReleaseTag && (
            <span className="font-mono font-semibold text-teal-700 dark:text-teal-400" dir="ltr">
              Latest Release: {ghSession.latestReleaseTag}
            </span>
          )}
        </div>

        {/* Completed / Connected State */}
        {ghSession.status === 'completed' && ghSession.repoUrl && (
          <div className="mt-5 space-y-4 rounded-xl border border-teal-500/35 bg-teal-50/70 p-5 dark:bg-teal-950/25">
            <div className="flex items-center gap-2.5 text-base font-bold text-slate-900 dark:text-white">
              <CheckCircle2 className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0" />
              <span>
                המאגר מעודכן בגרסה {APP_VERSION}{' '}
                {ghSession.latestReleaseTag ? `(${ghSession.latestReleaseTag})` : ''} עם מפתח קבוע!
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={ghSession.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D95B2B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#C24E22]"
              >
                <span>פתח את המאגר ב-GitHub</span>
                <ExternalLink className="h-4 w-4" />
              </a>

              {ghSession.releaseUrl && (
                <a
                  href={ghSession.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#1E2738] dark:text-white"
                >
                  <span>
                    עמוד שחרור הגרסה {ghSession.latestReleaseTag || ''}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}

              {ghSession.hasPermanentKey && (
                <button
                  type="button"
                  disabled={pushingUpdate}
                  onClick={handlePushNextRelease}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#1E2738] dark:text-white cursor-pointer"
                >
                  <UploadCloud className={`h-4 w-4 text-[#D95B2B] ${pushingUpdate ? 'animate-bounce' : ''}`} />
                  <span>
                    {pushingUpdate
                      ? 'מפרסם גרסה חדשה ל-GitHub...'
                      : 'פרסם עדכון אוטומטי הבא (v3, v4...)'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Publishing in Progress State */}
        {ghSession.status === 'publishing' && (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#D95B2B]/40 bg-[#D95B2B]/10 p-5 text-sm font-semibold text-slate-900 dark:text-white">
            <Loader2 className="h-5 w-5 animate-spin text-[#D95B2B] shrink-0" />
            <span>
              רושם מפתח קבוע ב-GitHub, דוחף את גרסה {APP_VERSION} ויוצר אוטומטית את ה-Release הבא (v2 / v3)...
            </span>
          </div>
        )}

        {/* Active Device Code Waiting for User Approval */}
        {ghSession.status === 'awaiting_user' && ghSession.userCode && (
          <div className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  שלב 1 — העתק את הקוד החד-פעמי ליצירת מפתח קבוע ועדכון ל-v2:
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span
                    className="font-mono text-2xl font-bold tracking-widest text-[#D95B2B] sm:text-3xl"
                    dir="ltr"
                  >
                    {ghSession.userCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDeviceCode}
                    className="flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#1E2738] dark:text-white cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
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

              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <a
                  href={ghSession.verificationUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#D95B2B] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#C24E22] whitespace-nowrap"
                >
                  <span>שלב 2 — פתח את GitHub לאישור המפתח הקבוע</span>
                  <ExternalLink className="h-4 w-4" />
                </a>
                <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin text-[#D95B2B]" />
                  <span>לאחר האישור המפתח יישמר באופן קבוע והעדכון ל-v2 יעלה מיד</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Idle / Expired / Error */}
        {(ghSession.status === 'idle' ||
          ghSession.status === 'expired' ||
          ghSession.status === 'error') && (
          <div className="mt-5 space-y-4 border-t border-slate-200/80 pt-5 dark:border-slate-700/60">
            {ghSession.error && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-300">
                {ghSession.error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label
                  htmlFor="gh-repo-name"
                  className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  שם המאגר ב-GitHub
                </label>
                <input
                  id="gh-repo-name"
                  type="text"
                  dir="ltr"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-sm text-slate-900 focus:border-[#D95B2B] focus:outline-none dark:border-slate-700 dark:bg-[#141B27] dark:text-white"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  נראות מאגר
                </span>
                <div className="grid min-h-[44px] grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-[#141B27]">
                  <button
                    type="button"
                    onClick={() => setIsPrivateRepo(false)}
                    className={`rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      !isPrivateRepo
                        ? 'bg-[#D95B2B] text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    ציבורי
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrivateRepo(true)}
                    className={`rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      isPrivateRepo
                        ? 'bg-[#D95B2B] text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
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
              className="flex min-h-[48px] items-center gap-2 rounded-xl bg-[#D95B2B] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#C24E22] disabled:opacity-70 cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${startingFlow ? 'animate-spin' : ''}`} />
              <span>חבר מפתח קבוע ועדכן את המאגר (v2 · 0.2.2)</span>
            </button>
          </div>
        )}
      </section>

      {/* Section 3: Cryptographic & Package Details */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
          <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          <span>מפרט טכני של חבילת האנדרואיד (APK v{meta.versionName})</span>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-slate-200/70 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-500 dark:text-slate-400">גרסת אפליקציה</span>
            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums" dir="ltr">
              {meta.versionName} (Code {meta.versionCode})
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-200/70 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-500 dark:text-slate-400">מזהה חבילה (Package)</span>
            <span className="font-mono text-slate-800 dark:text-slate-200 tabular-nums" dir="ltr">
              {meta.packageName}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-200/70 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-500 dark:text-slate-400">הרשאות כלולות</span>
            <span className="text-slate-800 dark:text-slate-200">
              Bluetooth Scan & Connect · Audio · Mic
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-200/70 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-500 dark:text-slate-400">אימות SHA-256 (ZIP)</span>
            <span
              className="max-w-[200px] truncate font-mono text-slate-800 dark:text-slate-200 tabular-nums"
              dir="ltr"
              title={meta.zipSha256}
            >
              {meta.zipSha256 || 'מחושב בעת הבנייה'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
