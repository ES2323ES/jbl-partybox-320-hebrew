import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  Sliders,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import {
  AcousticEnvironment,
  BUILTIN_EQ_PRESETS,
  BassBoostMode,
  EQ_BANDS,
  EqPresetId,
  EqualizerState,
  SavedEqProfile,
} from '../types/speaker';
import { audioEngine } from '../services/audioEngine';
import indoorImgUrl from '../assets/images/env_indoor_lounge_1793294955058.jpg';
import outdoorImgUrl from '../assets/images/env_outdoor_rooftop_1793294954960.jpg';

interface EqualizerPanelProps {
  eq: EqualizerState;
  playtimeBoost: boolean;
  savedProfiles: SavedEqProfile[];
  onChangeBandGain: (index: number, db: number) => void;
  onApplyCalibratedGains: (gains: number[], env: AcousticEnvironment) => void;
  onSelectPreset: (preset: Exclude<EqPresetId, EqPresetId.Custom>) => void;
  onResetFlat: () => void;
  onChangeBassBoost: (mode: BassBoostMode) => void;
  onToggleAiSoundBoost: () => void;
  onChangeEnvironment: (env: AcousticEnvironment) => void;
  onSaveProfile: (name: string) => void;
  onApplySavedProfile: (profile: SavedEqProfile) => void;
  onDeleteSavedProfile: (id: string) => void;
  onExportFullBackup: () => void;
  onImportFullBackupFile: (file: File) => Promise<string>;
}

const INDOOR_IMAGE_SRC = indoorImgUrl;
const OUTDOOR_IMAGE_SRC = outdoorImgUrl;

const W = 720;
const H = 220;
const PAD_X = 42;
const PAD_Y = 24;
const INNER_W = W - PAD_X * 2;
const INNER_H = H - PAD_Y * 2;

/**
 * Isolated <canvas> 28-bar FFT analyzer — updates smoothly via rAF without re-rendering EqualizerPanel!
 */
const SpectrumUnderlayCanvas: React.FC = React.memo(() => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf: number | null = null;
    const render = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, W, H);
          const frame = audioEngine.getAnalysisFrame();
          const bars = frame.spectrum;
          const stepW = INNER_W / bars.length;
          const barW = Math.max(4, stepW - 3.5);

          for (let i = 0; i < bars.length; i++) {
            const val = bars[i];
            const barH = Math.max(3, val * (INNER_H * 0.88));
            const x = PAD_X + i * stepW + 1.5;
            const y = PAD_Y + INNER_H - barH;
            ctx.fillStyle = `rgba(217, 91, 43, ${(0.14 + val * 0.28).toFixed(3)})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, 2);
            ctx.fill();
          }
        }
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
});

export const EqualizerPanel: React.FC<EqualizerPanelProps> = ({
  eq,
  playtimeBoost,
  savedProfiles,
  onChangeBandGain,
  onApplyCalibratedGains,
  onSelectPreset,
  onResetFlat,
  onChangeBassBoost,
  onToggleAiSoundBoost,
  onChangeEnvironment,
  onSaveProfile,
  onApplySavedProfile,
  onDeleteSavedProfile,
  onExportFullBackup,
  onImportFullBackupFile,
}) => {
  const [newProfileName, setNewProfileName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [indoorImgFailed, setIndoorImgFailed] = useState(false);
  const [outdoorImgFailed, setOutdoorImgFailed] = useState(false);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  // Smart 5-Second Room Calibration State
  const [calibrating, setCalibrating] = useState(false);
  const [calibPct, setCalibPct] = useState(0);
  const [calibStage, setCalibStage] = useState('');
  const [calibSummary, setCalibSummary] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);

  const curvePoints = useMemo(() => {
    return audioEngine.computeCompositeCurve(
      eq.gains,
      eq.bassBoost,
      eq.environment,
      playtimeBoost
    );
  }, [eq.gains, eq.bassBoost, eq.environment, playtimeBoost]);

  const minLog = Math.log10(25);
  const maxLog = Math.log10(18000);

  const freqToX = (freq: number) => {
    const t = (Math.log10(freq) - minLog) / (maxLog - minLog);
    return PAD_X + Math.max(0, Math.min(1, t)) * INNER_W;
  };

  const dbToY = (db: number) => {
    const clamped = Math.max(-15, Math.min(15, db));
    const t = (15 - clamped) / 30;
    return PAD_Y + t * INNER_H;
  };

  const yToDb = (clientY: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleY = H / rect.height;
    const svgY = (clientY - rect.top) * scaleY;
    const norm = (svgY - PAD_Y) / INNER_H;
    const rawDb = 15 - norm * 30;
    const clamped = Math.max(-12, Math.min(12, rawDb));
    return Math.round(clamped * 2) / 2;
  };

  useEffect(() => {
    if (draggingBand === null) return;
    const onMove = (e: PointerEvent) => {
      onChangeBandGain(draggingBand, yToDb(e.clientY));
    };
    const onUp = () => setDraggingBand(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingBand, onChangeBandGain]);

  const linePath = useMemo(() => {
    if (curvePoints.length === 0) return '';
    return curvePoints
      .map(
        (pt, i) =>
          `${i === 0 ? 'M' : 'L'} ${freqToX(pt.freq).toFixed(1)} ${dbToY(pt.db).toFixed(1)}`
      )
      .join(' ');
  }, [curvePoints]);

  const areaPath = useMemo(() => {
    if (!linePath) return '';
    const zeroY = dbToY(0).toFixed(1);
    const firstX = freqToX(curvePoints[0].freq).toFixed(1);
    const lastX = freqToX(curvePoints[curvePoints.length - 1].freq).toFixed(1);
    return `${linePath} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`;
  }, [linePath, curvePoints]);

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProfileName.trim();
    if (!trimmed) return;
    onSaveProfile(trimmed);
    setNewProfileName('');
    setShowSaveInput(false);
  };

  const handleRunSmartCalibration = async () => {
    if (calibrating) return;
    setCalibrating(true);
    setCalibSummary(null);
    try {
      const res = await audioEngine.runAcousticRoomCalibration((pct, label) => {
        setCalibPct(pct);
        setCalibStage(label);
      });
      onApplyCalibratedGains(res.calibratedGains, res.detectedEnvironment);
      setCalibSummary(res.summaryHe);
    } catch {
      setCalibSummary('לא ניתן היה להשלים את הכיול האקוסטי כעת.');
    } finally {
      setCalibrating(false);
    }
  };

  const handleBackupFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const msg = await onImportFullBackupFile(file);
      setBackupNotice(msg);
      window.setTimeout(() => setBackupNotice(null), 5000);
    } catch (err) {
      setBackupNotice(
        err instanceof Error ? err.message : 'קובץ הגיבוי אינו תקין'
      );
    }
  };

  const builtinKeys = Object.keys(BUILTIN_EQ_PRESETS) as Array<
    Exclude<EqPresetId, EqPresetId.Custom>
  >;

  return (
    <div className="space-y-6">
      {/* Section 1: 7-Band Parametric/Graphic Equalizer & Real-time Spectrum */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              איקוולייזר 7 ערוצים ומנתח תדרים חי
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              כוונן כל תדר בטווח{' '}
              <span dir="ltr" className="font-mono tabular-nums">
                -12dB
              </span>{' '}
              עד{' '}
              <span dir="ltr" className="font-mono tabular-nums">
                +12dB
              </span>{' '}
              מול השירים המתנגנים בנגן שלך בזמן אמת.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={calibrating}
              onClick={handleRunSmartCalibration}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#D95B2B]/50 bg-[#D95B2B]/10 px-3.5 py-2 text-xs font-semibold text-[#B84318] transition-colors hover:bg-[#D95B2B]/15 dark:text-amber-200 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {calibrating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#D95B2B]" />
              ) : (
                <Mic className="h-3.5 w-3.5 text-[#D95B2B]" />
              )}
              <span>
                {calibrating ? `מכייל חלל... ${calibPct}%` : 'כיול אקוסטי חכם (5 ש׳)'}
              </span>
            </button>

            <button
              type="button"
              onClick={onResetFlat}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>איפוס ל-0dB</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSaveInput((prev) => !prev)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#D95B2B] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C24E22] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>שמור פרופיל</span>
            </button>
          </div>
        </div>

        {/* Smart Acoustic Calibration Progress / Result Banner */}
        {(calibrating || calibSummary) && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-700 dark:bg-[#141B27]">
            {calibrating ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between font-medium text-slate-800 dark:text-slate-200">
                  <span>{calibStage}</span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {calibPct}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-[#D95B2B] transition-[width] duration-150"
                    style={{ width: `${calibPct}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 text-teal-700 dark:text-teal-300">
                <span>{calibSummary}</span>
                <button
                  type="button"
                  onClick={() => setCalibSummary(null)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  סגור
                </button>
              </div>
            )}
          </div>
        )}

        {/* Inline Save Custom Preset Drawer */}
        {showSaveInput && (
          <form
            onSubmit={handleSaveSubmit}
            className="mt-4 flex flex-col gap-2.5 border-t border-slate-200/80 pt-4 dark:border-slate-700/60 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="שם הפרופיל (למשל: מסיבת גג קיץ, הופעה אקוסטית)..."
              maxLength={32}
              className="min-h-[42px] flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#D95B2B] focus:outline-none dark:border-slate-700 dark:bg-[#141B27] dark:text-white"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#D95B2B] px-4 py-2 text-xs font-semibold text-white hover:bg-[#C24E22] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Check className="h-4 w-4" />
                <span>שמירה</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSaveInput(false)}
                className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                ביטול
              </button>
            </div>
          </form>
        )}

        {/* Built-in Presets Segmented Selector */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {builtinKeys.map((key) => {
            const info = BUILTIN_EQ_PRESETS[key];
            const active = eq.preset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectPreset(key)}
                className={`min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-[#D95B2B] bg-[#D95B2B] text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {info.title}
              </button>
            );
          })}
        </div>

        {/* Live Composite Frequency Response SVG + Isolated Canvas FFT Spectrum */}
        <div
          className="mt-5 overflow-hidden rounded-xl border border-slate-200/90 bg-slate-50 p-3 dark:border-slate-700/70 dark:bg-[#141B27]"
          dir="ltr"
        >
          <div className="relative h-48 w-full sm:h-56">
            <SpectrumUnderlayCanvas />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="relative z-10 h-full w-full touch-none select-none"
              role="img"
              aria-label="גרף הענות תדרים משולב וספקטרום שמע חי"
            >
              <defs>
                <linearGradient id="eqAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D95B2B" stopOpacity="0.28" />
                  <stop offset="55%" stopColor="#D95B2B" stopOpacity="0.06" />
                  <stop offset="100%" stopColor="#D95B2B" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {[-12, -6, 0, 6, 12].map((dbVal) => {
                const y = dbToY(dbVal);
                return (
                  <g key={dbVal}>
                    <line
                      x1={PAD_X}
                      y1={y}
                      x2={W - PAD_X}
                      y2={y}
                      stroke={
                        dbVal === 0
                          ? 'rgba(100,116,139,0.4)'
                          : 'rgba(100,116,139,0.16)'
                      }
                      strokeDasharray={dbVal === 0 ? undefined : '4 4'}
                      strokeWidth="1"
                    />
                    <text
                      x={PAD_X - 8}
                      y={y + 4}
                      textAnchor="end"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {dbVal > 0 ? `+${dbVal}` : dbVal}
                    </text>
                  </g>
                );
              })}

              {EQ_BANDS.map((band) => {
                const x = freqToX(band.freq);
                return (
                  <g key={band.freq}>
                    <line
                      x1={x}
                      y1={PAD_Y}
                      x2={x}
                      y2={H - PAD_Y}
                      stroke="rgba(100,116,139,0.14)"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={H - 6}
                      textAnchor="middle"
                      fill="#64748B"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {band.labelHz}
                    </text>
                  </g>
                );
              })}

              <path d={areaPath} fill="url(#eqAreaFill)" />
              <path
                d={linePath}
                fill="none"
                stroke="#D95B2B"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {EQ_BANDS.map((band, idx) => {
                const x = freqToX(band.freq);
                const gain = eq.gains[idx] ?? 0;
                const y = dbToY(gain);
                const isDragging = draggingBand === idx;
                return (
                  <g
                    key={band.freq}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDraggingBand(idx);
                    }}
                    onDoubleClick={() => onChangeBandGain(idx, 0)}
                    className="cursor-ns-resize"
                  >
                    <circle cx={x} cy={y} r="15" fill="transparent" />
                    <circle
                      cx={x}
                      cy={y}
                      r={isDragging ? 7.5 : 6}
                      fill="#D95B2B"
                      stroke="#FFFFFF"
                      strokeWidth="2.5"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* 7 Hardware Channel Faders */}
        <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-7" dir="ltr">
          {EQ_BANDS.map((band, idx) => {
            const gain = eq.gains[idx] ?? 0;
            const formatted = `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
            return (
              <div
                key={band.freq}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50 p-3 dark:border-slate-700/70 dark:bg-[#141B27] sm:flex-col sm:py-4"
              >
                <div className="flex flex-col items-start sm:items-center">
                  <span className="font-mono text-xs font-semibold text-slate-900 dark:text-white tabular-nums">
                    {band.labelHz}
                  </span>
                  <span
                    className="text-[11px] text-slate-500 dark:text-slate-400"
                    dir="rtl"
                  >
                    {band.hebrewRole}
                  </span>
                </div>

                <div className="flex flex-1 items-center justify-center sm:my-3 sm:h-36 sm:flex-none">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(e) =>
                      onChangeBandGain(idx, Number(e.target.value))
                    }
                    aria-label={`ערוץ תדר ${band.labelHz}`}
                    className="jbl-slider w-full sm:w-32 sm:-rotate-90"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onChangeBandGain(idx, 0)}
                  title="לחיצה לאיפוס ערוץ ל-0.0 dB"
                  className={`min-h-[32px] rounded-lg px-2 py-1 font-mono text-xs font-medium tabular-nums transition-colors cursor-pointer ${
                    Math.abs(gain) > 0.05
                      ? 'text-[#D95B2B] hover:bg-slate-200/60 dark:hover:bg-slate-800'
                      : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {formatted}
                </button>
              </div>
            );
          })}
        </div>

        {/* User Saved Custom EQ Profiles + Full Backup Export / Import */}
        <div className="mt-6 border-t border-slate-200/80 pt-5 dark:border-slate-700/60">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                פרופילים אישיים וגיבוי הגדרות מלא (JSON)
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {savedProfiles.length} פרופילים שמורים במכשיר
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleBackupFileSelected}
                className="hidden"
              />
              <button
                type="button"
                onClick={onExportFullBackup}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>ייצוא גיבוי הגדרות</span>
              </button>
              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>שחזור גיבוי הגדרות</span>
              </button>
            </div>
          </div>

          {backupNotice && (
            <div className="mb-3 rounded-xl border border-teal-500/35 bg-teal-50/70 px-3.5 py-2 text-xs text-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
              {backupNotice}
            </div>
          )}

          {savedProfiles.length === 0 ? (
            <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27] sm:flex-row sm:items-center">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                עדיין לא נשמרו פרופילי סאונד אישיים. כוונן את תדרי ה-EQ ולחץ על ״שמור פרופיל״ כדי לעבור ביניהם בלחיצה.
              </p>
              <button
                type="button"
                onClick={() => setShowSaveInput(true)}
                className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#1E2738] dark:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                צור פרופיל ראשון
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {savedProfiles.map((prof) => {
                const isActive =
                  eq.preset === EqPresetId.Custom && eq.activeCustomId === prof.id;
                return (
                  <div
                    key={prof.id}
                    className={`flex items-center gap-1 rounded-xl border pl-1.5 pr-3 py-1 transition-colors ${
                      isActive
                        ? 'border-[#D95B2B] bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onApplySavedProfile(prof)}
                      className="min-h-[34px] text-xs font-medium hover:text-slate-950 dark:hover:text-white whitespace-nowrap cursor-pointer"
                    >
                      {prof.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedProfile(prof.id)}
                      aria-label={`מחיקת פרופיל ${prof.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-500/15 hover:text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Section 2: JBL BassBoost & AI Sound Boost */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              הדגשת בס חכמה (BassBoost & AI Sound Boost)
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              שני מצבי תהודה ייעודיים לזוג הוופרים של ה-Stage 320 + אלגוריתם מניעת עיוותים בעוצמה גבוהה
            </p>
          </div>
          {playtimeBoost && (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              מצב חיסכון סוללה פעיל — הדגשת הבס מרוסנת להארכת זמן הנגינה
            </span>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              mode: BassBoostMode.Off,
              title: 'כבוי (Off)',
              desc: 'תגובת בס טבעית בהתאם לעקומת האיקוולייזר בלבד',
            },
            {
              mode: BassBoostMode.Deep,
              title: 'עמוק (Deep · 48Hz)',
              desc: 'הרחבת סאב-בס עמוקה ועוטפת לחללים סגורים והיפ-הופ',
            },
            {
              mode: BassBoostMode.Punchy,
              title: 'הדוק (Punchy · 84Hz)',
              desc: 'מכת תוף רגל חדה ומהירה המורגשת בחזה גם בשטח פתוח',
            },
          ].map((item) => {
            const selected = eq.bassBoost === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => onChangeBassBoost(item.mode)}
                className={`flex flex-col justify-between rounded-xl border p-4 text-right transition-colors cursor-pointer ${
                  selected
                    ? 'border-[#D95B2B] bg-[#D95B2B]/[0.08] dark:bg-[#D95B2B]/[0.12]'
                    : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {item.title}
                  </span>
                  <Zap
                    className={`h-4 w-4 ${
                      selected ? 'text-[#D95B2B]' : 'text-slate-400'
                    }`}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {item.desc}
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-col gap-4 border-t border-slate-200/80 pt-5 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
              <Sliders className="h-4 w-4 text-[#D95B2B]" />
              <span>מעבד דינמי AI Sound Boost</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              מנתח את אות השמע בזמן אמת למקסום הטווח הדינמי והפחתת עיוותי דרייבר בעוצמות גבוהות
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={eq.aiSoundBoost}
            onClick={onToggleAiSoundBoost}
            className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              eq.aiSoundBoost
                ? 'bg-[#D95B2B] text-white'
                : 'border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-400'
            }`}
          >
            {eq.aiSoundBoost ? 'AI Sound Boost פעיל' : 'כבוי'}
          </button>
        </div>
      </section>

      {/* Section 3: Acoustic Placement Environment Calibration */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 dark:border-slate-700/70 dark:bg-[#1E2738]">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          כיול אקוסטי לפי סביבת הצבה
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          התאמת עקומת פיזור הסאונד להחזרי קירות בחלל סגור לעומת התפשטות חופשית בחוץ
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChangeEnvironment(AcousticEnvironment.Indoor)}
            className={`group relative h-48 overflow-hidden rounded-2xl border-2 text-right transition-colors cursor-pointer ${
              eq.environment === AcousticEnvironment.Indoor
                ? 'border-[#D95B2B]'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
            {!indoorImgFailed && (
              <img
                src={INDOOR_IMAGE_SRC}
                alt="סביבת האזנה ביתית בסלון אקוסטי"
                referrerPolicy="no-referrer"
                onError={() => setIndoorImgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />

            <div className="relative z-10 flex h-full flex-col justify-end p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-semibold text-white">
                  חלל פנים / סלון ואולפן
                </span>
                <span className="text-xs font-medium text-amber-200">
                  {eq.environment === AcousticEnvironment.Indoor
                    ? 'נבחר כעת'
                    : 'בחר'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-200">
                ריסון הדהודי פינות בתדרי 95Hz לקבלת בס מדויק ונקי בחדרים סגורים
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onChangeEnvironment(AcousticEnvironment.Outdoor)}
            className={`group relative h-48 overflow-hidden rounded-2xl border-2 text-right transition-colors cursor-pointer ${
              eq.environment === AcousticEnvironment.Outdoor
                ? 'border-[#D95B2B]'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
            {!outdoorImgFailed && (
              <img
                src={OUTDOOR_IMAGE_SRC}
                alt="סביבת מסיבת חוץ ומרפסת גג פתוחה"
                referrerPolicy="no-referrer"
                onError={() => setOutdoorImgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />

            <div className="relative z-10 flex h-full flex-col justify-end p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-semibold text-white">
                  שטח פתוח / מרפסת וחצר
                </span>
                <span className="text-xs font-medium text-amber-200">
                  {eq.environment === AcousticEnvironment.Outdoor
                    ? 'נבחר כעת'
                    : 'בחר'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-200">
                תוספת הקרנה של +2.5dB בנמוכים ו-+2.0dB בגבוהים לפיצוי על אובדן אקוסטי באוויר הפתוח
              </p>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
};
