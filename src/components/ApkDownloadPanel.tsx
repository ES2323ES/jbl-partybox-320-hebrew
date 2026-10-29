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

interface GithubStatus {
  connected: boolean;
  source: 'oauth' | 'env' | null;
  username: string | null;
  profileUrl?: string;
  oauthConfigured: boolean;
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
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // GitHub Publisher States
  const [ghStatus, setGhStatus] = useState<GithubStatus>({
    connected: false,
    source: null,
    username: null,
    oauthConfigured: false,
  });
  const [repoName, setRepoName] = useState('jbl-partybox-320-hebrew');
  const [isPrivateRepo, setIsPrivateRepo] = useState(false);
  const [publishingGh, setPublishingGh] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [publishedRepo, setPublishedRepo] = useState<{
    repoUrl: string;
    releaseUrl: string | null;
    filesCount: number;
  } | null>(null);

  const refreshGithubStatus = useCallback(() => {
    fetch('/api/github/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GithubStatus | null) => {
        if (data) setGhStatus(data);
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

    refreshGithubStatus();
  }, [refreshGithubStatus]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        refreshGithubStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshGithubStatus]);

  const handleConnectGithubOAuth = async () => {
    setGhError(null);
    try {
      const origin = encodeURIComponent(window.location.origin);
      const res = await fetch(`/api/github/auth-url?origin=${origin}`);
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setGhError(
          data.error ||
            'להתחברות ב-OAuth יש להגדיר GITHUB_CLIENT_ID ו-GITHUB_CLIENT_SECRET בחלונית Secrets, או להגדיר GITHUB_TOKEN.'
        );
        return;
      }
      const popup = window.open(data.url, 'github_oauth_popup', 'width=600,height=720');
      if (!popup) {
        setGhError('הדפדפן חסם את החלון הקופץ — אשר חלונות קופצים עבור אתר זה ונסה שוב.');
      }
    } catch {
      setGhError('שגיאה בפתיחת תהליך ההתחברות ל-GitHub.');
    }
  };

  const handlePublishToGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (publishingGh) return;
    setPublishingGh(true);
    setGhError(null);
    setPublishedRepo(null);

    try {
      const res = await fetch('/api/github/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoName: repoName.trim() || 'jbl-partybox-320-hebrew',
          isPrivate: isPrivateRepo,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        repoUrl?: string;
        releaseUrl?: string | null;
        filesCount?: number;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.repoUrl) {
        setGhError(data.error || 'העלאת הפרויקט ל-GitHub נכשלה.');
      } else {
        setPublishedRepo({
          repoUrl: data.repoUrl,
          releaseUrl: data.releaseUrl || null,
          filesCount: data.filesCount || 0,
        });
      }
    } catch {
      setGhError('שגיאת תקשורת מול השרת בעת יצירת המאגר.');
    } finally {
      setPublishingGh(false);
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
      {/* Section 1: Publish Project to a Brand-New GitHub Repository */}
      <section className="rounded-2xl border border-white/[0.1] bg-[#12161E] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-5 w-5 text-[#FF5500]" />
              <h2 className="font-display text-xl font-bold text-white">
                פתיחת פרויקט חדש והעלאה ל-GitHub
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-300">
              יוצר מאגר (Repository) חדש בחשבון ה-GitHub שלך, דוחף את כל קוד המקור והתיעוד, ומצרף אוטומטית את קובצי ה-APK וה-ZIP כ-Release רשמי (`v1.0.0`).
            </p>
          </div>

          <div className="shrink-0">
            {ghStatus.connected ? (
              <span className="text-xs font-medium text-emerald-400">
                מחובר ל-GitHub: <strong dir="ltr">@{ghStatus.username}</strong>
              </span>
            ) : (
              <button
                type="button"
                onClick={refreshGithubStatus}
                className="min-h-[38px] rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.09] whitespace-nowrap cursor-pointer"
              >
                בדוק חיבור GitHub
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handlePublishToGithub} className="mt-5 space-y-4 border-t border-white/[0.08] pt-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="gh-repo-name" className="mb-1.5 block text-xs font-medium text-slate-300">
                שם המאגר החדש ב-GitHub
              </label>
              <input
                id="gh-repo-name"
                type="text"
                dir="ltr"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="jbl-partybox-320-hebrew"
                className="min-h-[44px] w-full rounded-xl border border-white/[0.12] bg-[#0B0D11] px-3.5 font-mono text-sm text-white focus:border-[#FF5500] focus:outline-none"
              />
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium text-slate-300">
                נראות המאגר
              </span>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/[0.08] bg-[#0B0D11] p-1 min-h-[44px]">
                <button
                  type="button"
                  onClick={() => setIsPrivateRepo(false)}
                  className={`rounded-lg text-xs font-semibold transition-colors ${
                    !isPrivateRepo ? 'bg-[#FF5500] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ציבורי (Public)
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivateRepo(true)}
                  className={`rounded-lg text-xs font-semibold transition-colors ${
                    isPrivateRepo ? 'bg-[#FF5500] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  פרטי (Private)
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {ghStatus.connected ? (
              <button
                type="submit"
                disabled={publishingGh}
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#FF5500] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#E64D00] disabled:opacity-70 whitespace-nowrap cursor-pointer"
              >
                {publishingGh ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>יוצר מאגר ומעלה קבצים + Release...</span>
                  </>
                ) : (
                  <>
                    <GitBranch className="h-4 w-4" />
                    <span>צור מאגר חדש והעלה ל-GitHub עכשיו</span>
                  </>
                )}
              </button>
            ) : (
              <>
                {ghStatus.oauthConfigured && (
                  <button
                    type="button"
                    onClick={handleConnectGithubOAuth}
                    className="flex min-h-[46px] items-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#E64D00] whitespace-nowrap cursor-pointer"
                  >
                    <GitBranch className="h-4 w-4" />
                    <span>התחבר לחשבון GitHub (OAuth)</span>
                  </button>
                )}

                <button
                  type="submit"
                  disabled={publishingGh}
                  className="flex min-h-[46px] items-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#E64D00] disabled:opacity-70 whitespace-nowrap cursor-pointer"
                >
                  <GitBranch className="h-4 w-4" />
                  <span>צור מאגר והעלה ל-GitHub</span>
                </button>
              </>
            )}
          </div>

          {!ghStatus.connected && (
            <p className="text-xs leading-relaxed text-slate-400">
              טיפ מהיר: ניתן ללחוץ על <strong>סמל ה-GitHub בסרגל העליון של AI Studio</strong> לייצוא ישיר לחשבונך, או להוסיף משתנה <code className="font-mono text-slate-200">GITHUB_TOKEN</code> בחלונית ה-<strong>Secrets</strong> וללחוץ על הכפתור למעלה ליצירה אוטומטית כולל Release APK.
            </p>
          )}

          {ghError && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-300">
              {ghError}
            </div>
          )}

          {publishedRepo && (
            <div className="space-y-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-xs text-emerald-300">
              <div className="flex items-center gap-2 font-semibold text-white">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>המאגר נוצר והועלה בהצלחה ({publishedRepo.filesCount} קבצים + Release v1.0.0)!</span>
              </div>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <a
                  href={publishedRepo.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-[#FF5500] underline"
                >
                  <span>פתיחת המאגר ב-GitHub</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {publishedRepo.releaseUrl && (
                  <a
                    href={publishedRepo.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-white underline"
                  >
                    <span>פתיחת עמוד ה-Release (הורדת APK)</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </form>
      </section>

      {/* Section 2: Primary ZIP + APK Download Card */}
      <section className="rounded-2xl border border-[#FF5500]/45 bg-[#12161E] p-6 sm:p-8">
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
