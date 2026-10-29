import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bluetooth,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Info,
  Music2,
  Radio,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  APP_VERSION,
  FaultLogEntry,
  FaultSeverity,
  LightshowState,
  SpeakerSystemState,
} from '../types/speaker';
import { faultLogger } from '../services/faultLogger';
import {
  LightingChannelDiagnostics,
  SpeakerPermissionState,
  bluetoothBridge,
} from '../services/bluetoothBridge';
import { audioEngine } from '../services/audioEngine';

interface FaultLogPanelProps {
  system: SpeakerSystemState;
  lightshow: LightshowState;
  onOpenBluetoothModal: () => void;
}

type LogFilter = 'all' | 'issues' | 'lighting_bt' | 'audio_sync';

export const FaultLogPanel: React.FC<FaultLogPanelProps> = ({
  system,
  lightshow,
  onOpenBluetoothModal,
}) => {
  const [entries, setEntries] = useState<FaultLogEntry[]>(() =>
    faultLogger.getEntries()
  );
  const [filter, setFilter] = useState<LogFilter>('all');
  const [copiedReport, setCopiedReport] = useState(false);
  const [runningSelfCheck, setRunningSelfCheck] = useState(false);
  const [diag, setDiag] = useState<LightingChannelDiagnostics>(() =>
    bluetoothBridge.getLightingDiagnostics()
  );
  const [perms, setPerms] = useState<SpeakerPermissionState>(() =>
    bluetoothBridge.getPermissionState()
  );

  useEffect(() => {
    faultLogger.markAllRead();
    setEntries(faultLogger.getEntries());

    const unsubFaults = faultLogger.subscribe(() => {
      setEntries([...faultLogger.getEntries()]);
      faultLogger.markAllRead();
    });
    const unsubDiag = bluetoothBridge.onDiagnosticsChanged(() => {
      setDiag(bluetoothBridge.getLightingDiagnostics());
      setPerms(bluetoothBridge.getPermissionState());
    });
    const unsubPerms = bluetoothBridge.onPermissionsChanged((st) => {
      setPerms(st);
    });

    return () => {
      unsubFaults();
      unsubDiag();
      unsubPerms();
    };
  }, []);

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      if (filter === 'issues') {
        return e.severity === 'error' || e.severity === 'warning';
      }
      if (filter === 'lighting_bt') {
        return e.category === 'lighting' || e.category === 'bluetooth';
      }
      if (filter === 'audio_sync') {
        return e.category === 'audio_sync' || e.category === 'permissions';
      }
      return true;
    });
  }, [entries, filter]);

  const handleRunDiagnostics = async () => {
    setRunningSelfCheck(true);

    const currentPerms = bluetoothBridge.getPermissionState();
    const currentDiag = bluetoothBridge.getLightingDiagnostics();
    const audioSt = audioEngine.getSourceState();
    const analysis = audioEngine.getAnalysisFrame();

    setPerms(currentPerms);
    setDiag(currentDiag);

    // 1. Check Environment & Permissions
    faultLogger.record({
      severity:
        currentPerms.bluetoothConnect && currentPerms.microphone
          ? 'success'
          : 'warning',
      category: 'permissions',
      title: 'בדיקה עצמית (1/3) — סביבת ריצה והרשאות מערכת',
      details: `סביבה: ${currentPerms.isAndroidApk ? 'אפליקציית Android APK' : 'דפדפן Web'} · Bluetooth: ${currentPerms.bluetoothConnect ? 'תקין' : 'ממתין'} · שמע/סינכרון: ${currentPerms.microphone ? 'תקין' : 'ממתין'}`,
      suggestionHe:
        currentPerms.bluetoothConnect && currentPerms.microphone
          ? undefined
          : 'לחץ על ״חיבור בלוטוס לרמקול״ ואשר את כל ההרשאות.',
    });

    // 2. Check External Player Sync
    faultLogger.record({
      severity: audioSt.isPlaying || analysis.externalMusicActive ? 'success' : 'info',
      category: 'audio_sync',
      title: 'בדיקה עצמית (2/3) — סינכרון עם נגן המוזיקה',
      details: `מצב מקור: ${
        audioSt.sourceMode === 'player_sync'
          ? 'סינכרון אוטומטי עם נגן המכשיר'
          : audioSt.sourceMode === 'system_audio'
            ? 'לכידת שמע מערכת'
            : 'מקצב בדיקה פנימי'
      } · פעיל כעת: ${audioSt.isPlaying ? 'כן' : 'ממתין ללחיצת הפעלה'} · BPM מזוהה: ${analysis.detectedBpm || 'ממתין לשיר'}`,
      suggestionHe: audioSt.isPlaying
        ? undefined
        : 'לחץ על ״סנכרן אוטומטית עם הנגן שלך״ בסרגל העליון והפעל שיר בנגן שלך.',
    });

    // 3. Test Live Hardware Lighting Packet TX
    await bluetoothBridge.sendTestLightingFlash(lightshow);
    setDiag(bluetoothBridge.getLightingDiagnostics());
    setRunningSelfCheck(false);
  };

  const handleCopyReport = async () => {
    try {
      const text = faultLogger.formatPlainTextReport();
      await navigator.clipboard.writeText(text);
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadReport = () => {
    const text = faultLogger.formatPlainTextReport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JBL-PartyBox-320-Diagnostics-${APP_VERSION}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderSeverityIcon = (sev: FaultSeverity) => {
    switch (sev) {
      case 'error':
        return <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-500" />;
      default:
        return <Info className="h-4 w-4 shrink-0 text-sky-500" />;
    }
  };

  const categoryLabel = (cat: FaultLogEntry['category']) => {
    switch (cat) {
      case 'bluetooth':
        return 'בלוטוס';
      case 'lighting':
        return 'תאורת רמקול';
      case 'audio_sync':
        return 'סינכרון נגן';
      case 'permissions':
        return 'הרשאות';
      default:
        return 'מערכת';
    }
  };

  const audioState = audioEngine.getSourceState();
  const isSpeakerConnected =
    system.connectionType === 'ble' || system.connectionType === 'android_bt';

  return (
    <div className="space-y-6">
      {/* Header & Self-Diagnostic Action Bar */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <ClipboardList className="h-6 w-6 text-[#D95B2B]" />
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                יומן תקלות ואבחון מערכת בזמן אמת (גרסה {APP_VERSION})
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              מעקב שקוף ומפורט אחר חיבורי ה-Bluetooth, שידור פקודות התאורה לרמקול הנייד, הרשאות אנדרואיד וסינכרון השירים מהנגן.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={runningSelfCheck}
              onClick={handleRunDiagnostics}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#C24E22] disabled:opacity-60 whitespace-nowrap cursor-pointer"
            >
              <Wrench className={`h-4 w-4 ${runningSelfCheck ? 'animate-spin' : ''}`} />
              <span>
                {runningSelfCheck
                  ? 'מבצע בדיקת רמקול ותאורה...'
                  : 'הפעל בדיקת מערכת ותאורה עצמית'}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenBluetoothModal}
              className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Bluetooth className="h-4 w-4 text-[#D95B2B]" />
              <span>הגדרות חיבור</span>
            </button>
          </div>
        </div>

        {/* 4 Live Hardware Telemetry Cards */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Bluetooth className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>סטטוס רמקול</span>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
              {isSpeakerConnected
                ? system.bleDeviceTitle || system.deviceName
                : 'מצב אולפן (טרם חובר)'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Radio className="h-3.5 w-3.5 text-cyan-500" />
              <span>ערוץ תאורה וחבילות TX</span>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
              {diag.connected ? (
                <span className="text-teal-600 dark:text-teal-400">
                  מחובר ({diag.packetsSent} נשלחו)
                </span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">
                  לא מחובר ({diag.packetsSent} נשלחו)
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <Music2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>סינכרון עם נגן המוזיקה</span>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
              {audioState.isPlaying
                ? audioState.sourceMode === 'player_sync'
                  ? 'מסונכרן חי עם הנגן'
                  : audioState.sourceMode === 'system_audio'
                    ? 'שמע מערכת ישיר'
                    : 'מקצב בדיקה פנימי'
                : 'בהמתנה להפעלה'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-teal-500" />
              <span>הרשאות וסביבה</span>
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">
              {perms.isAndroidApk
                ? perms.bluetoothConnect
                  ? 'Android APK (מאושר)'
                  : 'Android APK (חסרה הרשאה)'
                : 'דפדפן Web'}
            </div>
          </div>
        </div>

        {diag.lastTxHex && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>פקודת תאורה אחרונה שהורכבה:</span>
            </span>
            <code className="font-mono text-slate-800 dark:text-cyan-300" dir="ltr">
              {diag.lastTxHex}
            </code>
          </div>
        )}
      </section>

      {/* Log Entries List, Filters & Export Controls */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          {/* Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all' as LogFilter, label: `הכל (${entries.length})` },
              { id: 'issues' as LogFilter, label: 'תקלות ואזהרות' },
              { id: 'lighting_bt' as LogFilter, label: 'תאורה ובלוטוס' },
              { id: 'audio_sync' as LogFilter, label: 'סינכרון נגן והרשאות' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  filter === tab.id
                    ? 'bg-[#D95B2B] text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Export / Copy / Clear */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyReport}
              className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
            >
              {copiedReport ? (
                <>
                  <Check className="h-3.5 w-3.5 text-teal-500" />
                  <span>הועתק!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>העתק יומן</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadReport}
              className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>ייצוא דוח (.txt)</span>
            </button>

            <button
              type="button"
              onClick={() => faultLogger.clearAll()}
              className="flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-400 dark:hover:text-rose-400 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>נקה</span>
            </button>
          </div>
        </div>

        {/* Entries List */}
        {filteredEntries.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            לא נמצאו רשומות תואמות לסינון שנבחר — המערכת פועלת באופן תקין!
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {filteredEntries.map((item) => (
              <div
                key={item.id}
                className={`rounded-xl border p-4 transition-colors ${
                  item.severity === 'error'
                    ? 'border-rose-400/50 bg-rose-50/50 dark:border-rose-500/35 dark:bg-rose-950/20'
                    : item.severity === 'warning'
                      ? 'border-amber-400/50 bg-amber-50/50 dark:border-amber-500/35 dark:bg-amber-950/20'
                      : item.severity === 'success'
                        ? 'border-teal-400/40 bg-teal-50/40 dark:border-teal-500/30 dark:bg-teal-950/15'
                        : 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-[#141B27]'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderSeverityIcon(item.severity)}
                    <span className="text-sm font-bold text-slate-900 dark:text-white">
                      {item.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {categoryLabel(item.category)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums" dir="ltr">
                      {item.timeFormatted}
                    </span>
                  </div>
                </div>

                <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {item.details}
                </p>

                {item.technicalCode && (
                  <div
                    className="mt-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400"
                    dir="ltr"
                  >
                    {item.technicalCode}
                  </div>
                )}

                {item.suggestionHe && (
                  <p className="mt-2 border-t border-slate-200/70 pt-2 text-xs font-medium text-[#B84318] dark:border-slate-700/60 dark:text-amber-300">
                    <strong>פתרון מומלץ:</strong> {item.suggestionHe}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
