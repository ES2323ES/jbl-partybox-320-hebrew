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
  Link2,
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
  PUBLIC_GITHUB_APK_URL,
  PUBLIC_GITHUB_LATEST_RELEASE_URL,
  PUBLIC_GITHUB_REPO_URL,
  PUBLIC_GITHUB_ZIP_URL,
  ZIP_DOWNLOAD_ENDPOINT,
  ZIP_FILE_NAME,
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
  versionCode: 4,
  minSdk: 24,
  targetSdk: 34,
  sizeBytes: 1787519,
  sizeFormatted: '1.70 MB',
  sha256: 'd03cb8bd6c1063520406d105fbd7536753af891d4919ae0e4e9ff3559a1e55db',
  zipSizeBytes: 1781217,
  zipSizeFormatted: '1.70 MB',
  zipSha256: 'ce376357b355082721fa94a28571b1dac59fb092decc671b245d1998dabc2edb',
  builtAt: '2026-10-29',
};

export const ApkDownloadPanel: React.FC = () => {
  const [meta, setMeta] = useState<ApkBuildMetadata>(FALLBACK_META);
  const [copiedKey, setCopiedKey] = useState<'apk' | 'zip' | 'release' | null>(
    null
  );
  const [copiedCode, setCopiedCode] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // GitHub Permanent Key & Auto-Release (v2, v3, v4...) State
  const [repoName, setRepoName] = useState('jbl-partybox-320-hebrew');
  const [isPrivateRepo, setIsPrivateRepo] = useState(false);
  const [startingFlow, setStartingFlow] = useState(false);
  const [pushingUpdate, setPushingUpdate] = useState(false);
  const [ghSession, setGhSession] = useState<DeviceFlowSession>({
    status: 'completed',
    userCode: null,
    verificationUri: 'https://github.com/login/device',
    repoName: 'jbl-partybox-320-hebrew',
    isPrivate: false,
    expiresAt: null,
    username: 'ES2323ES',
    repoUrl: PUBLIC_GITHUB_REPO_URL,
    releaseUrl: PUBLIC_GITHUB_LATEST_RELEASE_URL,
    latestReleaseTag: 'v4',
    hasPermanentKey: true,
    deployKeyInstalled: true,
    error: null,
  });

  const fetchDeviceState = useCallback(() => {
    fetch('/api/github/device/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DeviceFlowSession | null) => {
        if (data) {
          setGhSession((prev) => ({
            ...prev,
            ...data,
            repoUrl: data.repoUrl || PUBLIC_GITHUB_REPO_URL,
            releaseUrl: data.releaseUrl || PUBLIC_GITHUB_LATEST_RELEASE_URL,
          }));
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
  const apkSizeLabel = meta.sizeFormatted || '1.68 MB';
  const zipSizeLabel = meta.zipSizeFormatted || '1.67 MB';

  const activeRepoBase = ghSession.repoUrl || PUBLIC_GITHUB_REPO_URL;
  const activeTag = ghSession.latestReleaseTag;

  const publicApkUrl = activeTag
    ? `${activeRepoBase}/releases/download/${activeTag}/${APK_FILE_NAME}`
    : PUBLIC_GITHUB_APK_URL;

  const publicZipUrl = activeTag
    ? `${activeRepoBase}/releases/download/${activeTag}/${ZIP_FILE_NAME}`
    : PUBLIC_GITHUB_ZIP_URL;

  const publicReleasePageUrl =
    ghSession.releaseUrl ||
    (activeTag
      ? `${activeRepoBase}/releases/tag/${activeTag}`
      : PUBLIC_GITHUB_LATEST_RELEASE_URL);

  const handleCopyText = async (
    text: string,
    key: 'apk' | 'zip' | 'release'
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Direct Public Download Card (Works in all browsers, phones & outside iframe) */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <Smartphone className="h-5 w-5 text-[#D95B2B]" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
                הורדת האפליקציה לאנדרואיד — גרסה {meta.versionName}{' '}
                {activeTag ? `(${activeTag})` : ''}
              </h2>
            </div>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              חבילת ההתקנה הציבורית (<strong className="font-mono" dir="ltr">v{meta.versionName}</strong>) זמינה להורדה ישירה מ-GitHub ללא צורך בהתחברות — כולל <strong>בקרת תאורה חיה לרמקול הנייד (BLE GATT + SPP)</strong>, <strong>סינכרון אוטומטי מלא עם השירים בנגן שלך ללא העלאת שירים</strong>, <strong>תאורת ניאון זוהרת</strong>, <strong>מדריך למשתמש מפורט</strong> ו-<strong>יומן תקלות ואבחון</strong>.
            </p>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 tabular-nums" dir="ltr">
                {meta.fileName} ({apkSizeLabel})
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-[#D95B2B] tabular-nums" dir="ltr">
                {zipName} ({zipSizeLabel})
              </span>
              <span aria-hidden="true">·</span>
              <span>חתימת מפתח קבוע לעדכון חלק</span>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2.5 sm:items-end shrink-0">
            <a
              href={publicApkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-[#D95B2B] px-6 py-3 text-base font-bold text-white transition-colors hover:bg-[#C24E22] whitespace-nowrap"
            >
              <Smartphone className="h-5 w-5" />
              <span>הורד קובץ APK לאנדרואיד ({apkSizeLabel})</span>
              <ExternalLink className="h-4 w-4 opacity-90" />
            </a>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={publicZipUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <FolderArchive className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>הורד ארכיון ZIP ({zipSizeLabel})</span>
                <ExternalLink className="h-3 w-3 opacity-75" />
              </a>

              <a
                href={APK_DOWNLOAD_ENDPOINT}
                target="_blank"
                rel="noopener noreferrer"
                download={meta.fileName}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>הורדה מהשרת המקומי (APK)</span>
              </a>

              <a
                href={ZIP_DOWNLOAD_ENDPOINT}
                target="_blank"
                rel="noopener noreferrer"
                download={zipName}
                className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                <span>שרת מקומי (ZIP)</span>
              </a>
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

        {/* Shareable Public Links Box (Works on any phone / WhatsApp / Chrome without login) */}
        <div className="mt-6 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-[#141B27]">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
            <Link2 className="h-4 w-4 text-[#D95B2B]" />
            <span>
              קישורים ציבוריים ישירים לשליחה לטלפון או פתיחה בדפדפן חיצוני (עובדים מכל מכשיר ללא הרשאה):
            </span>
          </div>

          <div className="space-y-2">
            {/* Public APK Link Row */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700/80 dark:bg-[#1E2738]">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  קובץ התקנה ישיר לאנדרואיד (APK):
                </div>
                <a
                  href={publicApkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="block truncate font-mono text-xs text-[#D95B2B] underline hover:opacity-80"
                >
                  {publicApkUrl}
                </a>
              </div>
              <button
                type="button"
                onClick={() => handleCopyText(publicApkUrl, 'apk')}
                className="flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
              >
                {copiedKey === 'apk' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    <span>הועתק!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>העתק קישור APK</span>
                  </>
                )}
              </button>
            </div>

            {/* Public ZIP Link Row */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700/80 dark:bg-[#1E2738]">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  ארכיון ZIP להורדה למחשב או לטלפון:
                </div>
                <a
                  href={publicZipUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="block truncate font-mono text-xs text-[#D95B2B] underline hover:opacity-80"
                >
                  {publicZipUrl}
                </a>
              </div>
              <button
                type="button"
                onClick={() => handleCopyText(publicZipUrl, 'zip')}
                className="flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
              >
                {copiedKey === 'zip' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    <span>הועתק!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>העתק קישור ZIP</span>
                  </>
                )}
              </button>
            </div>

            {/* Public Release Page Row */}
            <div className="flex flex-col gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700/80 dark:bg-[#1E2738]">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  עמוד שחרור הגרסה הרשמי ב-GitHub:
                </div>
                <a
                  href={publicReleasePageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="block truncate font-mono text-xs text-[#D95B2B] underline hover:opacity-80"
                >
                  {publicReleasePageUrl}
                </a>
              </div>
              <button
                type="button"
                onClick={() => handleCopyText(publicReleasePageUrl, 'release')}
                className="flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
              >
                {copiedKey === 'release' ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                    <span>הועתק!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>העתק קישור עמוד</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {showIOSGuide && (
          <div className="mt-5 border-t border-slate-200/80 pt-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700/60 dark:text-slate-300">
            <strong className="text-slate-900 dark:text-white">התקנה במכשירי iPhone / iPad (Safari):</strong> הקש על כפתור ה<strong>שיתוף (Share)</strong> בסרגל הדפדפן ובחר באפשרות <strong>״הוסף למסך הבית״ (Add to Home Screen)</strong>.
          </div>
        )}
      </section>

      {/* Section 2: Permanent GitHub Key & Automatic Sequential Versioning (v2, v3, v4...) */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-8">
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

              <a
                href={publicReleasePageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-[#1E2738] dark:text-white"
              >
                <span>
                  עמוד שחרור הגרסה {ghSession.latestReleaseTag || ''}
                </span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>

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
                      : 'פרסם עדכון אוטומטי הבא (v4, v5...)'}
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
              רושם מפתח קבוע ב-GitHub, דוחף את גרסה {APP_VERSION} ויוצר אוטומטית את ה-Release הבא...
            </span>
          </div>
        )}

        {/* Active Device Code Waiting for User Approval */}
        {ghSession.status === 'awaiting_user' && ghSession.userCode && (
          <div className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  שלב 1 — העתק את הקוד החד-פעמי ליצירת מפתח קבוע:
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
                  <span>לאחר האישור המפתח יישמר באופן קבוע והעדכון יעלה מיד</span>
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
              <span>חבר מפתח קבוע ועדכן את המאגר ({APP_VERSION})</span>
            </button>
          </div>
        )}
      </section>

      {/* Section 3: Cryptographic & Package Details */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
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
              Bluetooth Scan & Connect · Audio · Mic · Notifications
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-slate-200/70 py-1.5 dark:border-slate-700/60">
            <span className="text-slate-500 dark:text-slate-400">אימות SHA-256 (APK)</span>
            <span
              className="max-w-[200px] truncate font-mono text-slate-800 dark:text-slate-200 tabular-nums"
              dir="ltr"
              title={meta.sha256}
            >
              {meta.sha256 || 'מחושב בעת הבנייה'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
