import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, RotateCcw, Sliders, Trash2, Zap } from 'lucide-react';
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
  onSelectPreset: (preset: Exclude<EqPresetId, EqPresetId.Custom>) => void;
  onResetFlat: () => void;
  onChangeBassBoost: (mode: BassBoostMode) => void;
  onToggleAiSoundBoost: () => void;
  onChangeEnvironment: (env: AcousticEnvironment) => void;
  onSaveProfile: (name: string) => void;
  onApplySavedProfile: (profile: SavedEqProfile) => void;
  onDeleteSavedProfile: (id: string) => void;
}

const INDOOR_IMAGE_SRC = indoorImgUrl;
const OUTDOOR_IMAGE_SRC = outdoorImgUrl;

export const EqualizerPanel: React.FC<EqualizerPanelProps> = ({
  eq,
  playtimeBoost,
  savedProfiles,
  onChangeBandGain,
  onSelectPreset,
  onResetFlat,
  onChangeBassBoost,
  onToggleAiSoundBoost,
  onChangeEnvironment,
  onSaveProfile,
  onApplySavedProfile,
  onDeleteSavedProfile,
}) => {
  const [spectrum, setSpectrum] = useState<number[]>(() => new Array(28).fill(0.05));
  const [newProfileName, setNewProfileName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [indoorImgFailed, setIndoorImgFailed] = useState(false);
  const [outdoorImgFailed, setOutdoorImgFailed] = useState(false);
  const [draggingBand, setDraggingBand] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let raf: number | null = null;
    const loop = () => {
      const frame = audioEngine.getAnalysisFrame();
      setSpectrum(frame.spectrum);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const curvePoints = useMemo(() => {
    return audioEngine.computeCompositeCurve(
      eq.gains,
      eq.bassBoost,
      eq.environment,
      playtimeBoost
    );
  }, [eq.gains, eq.bassBoost, eq.environment, playtimeBoost]);

  // SVG Coordinate Math (LTR frequency axis: 25Hz on left -> 18kHz on right, standard acoustic standard)
  const W = 720;
  const H = 220;
  const PAD_X = 42;
  const PAD_Y = 24;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;
  const minLog = Math.log10(25);
  const maxLog = Math.log10(18000);

  const freqToX = (freq: number) => {
    const t = (Math.log10(freq) - minLog) / (maxLog - minLog);
    return PAD_X + Math.max(0, Math.min(1, t)) * innerW;
  };

  const dbToY = (db: number) => {
    const clamped = Math.max(-15, Math.min(15, db));
    const t = (15 - clamped) / 30;
    return PAD_Y + t * innerH;
  };

  const yToDb = (clientY: number): number => {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleY = H / rect.height;
    const svgY = (clientY - rect.top) * scaleY;
    const norm = (svgY - PAD_Y) / innerH;
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
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${freqToX(pt.freq).toFixed(1)} ${dbToY(pt.db).toFixed(1)}`)
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

  const builtinKeys = Object.keys(BUILTIN_EQ_PRESETS) as Array<
    Exclude<EqPresetId, EqPresetId.Custom>
  >;

  return (
    <div className="space-y-8">
      {/* Section 1: 7-Band Parametric/Graphic Equalizer & Real-time Spectrum */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">
              איקוולייזר 7 ערוצים ומנתח תדרים חי
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              כוונן כל תדר בטווח <span dir="ltr" className="font-mono tabular-nums">-12dB</span> עד{' '}
              <span dir="ltr" className="font-mono tabular-nums">+12dB</span> ישירות על הגרף או באמצעות הזחלנים.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResetFlat}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>איפוס ל-0dB</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSaveInput((prev) => !prev)}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#FF5500] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#E64D00] whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>שמור פרופיל אישי</span>
            </button>
          </div>
        </div>

        {/* Inline Save Custom Preset Drawer */}
        {showSaveInput && (
          <form
            onSubmit={handleSaveSubmit}
            className="mt-4 flex flex-col gap-2.5 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center"
          >
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              placeholder="שם הפרופיל (למשל: מסיבת גג קיץ, הופעה אקוסטית)..."
              maxLength={32}
              className="min-h-[42px] flex-1 rounded-xl border border-white/[0.14] bg-[#0B0D11] px-3.5 text-sm text-white placeholder:text-slate-500 focus:border-[#FF5500] focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#FF5500] px-4 py-2 text-xs font-semibold text-white hover:bg-[#E64D00] whitespace-nowrap shrink-0"
              >
                <Check className="h-4 w-4" />
                <span>שמירה</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSaveInput(false)}
                className="min-h-[42px] rounded-xl border border-white/[0.1] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.05] whitespace-nowrap shrink-0"
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
                className={`min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-[#FF5500] bg-[#FF5500] text-white'
                    : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
                }`}
              >
                {info.title}
              </button>
            );
          })}
        </div>

        {/* Live Composite Frequency Response SVG + FFT Spectrum */}
        <div
          className="mt-5 overflow-hidden rounded-xl border border-white/[0.07] bg-[#0B0D11] p-3"
          dir="ltr"
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-48 w-full touch-none select-none sm:h-56"
            role="img"
            aria-label="גרף הענות תדרים משולב וספקטרום שמע חי"
          >
            <defs>
              <linearGradient id="eqAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF5500" stopOpacity="0.34" />
                <stop offset="55%" stopColor="#FF5500" stopOpacity="0.06" />
                <stop offset="100%" stopColor="#FF5500" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal dB Grid Lines */}
            {[-12, -6, 0, 6, 12].map((dbVal) => {
              const y = dbToY(dbVal);
              return (
                <g key={dbVal}>
                  <line
                    x1={PAD_X}
                    y1={y}
                    x2={W - PAD_X}
                    y2={y}
                    stroke={dbVal === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)'}
                    strokeDasharray={dbVal === 0 ? undefined : '4 4'}
                    strokeWidth="1"
                  />
                  <text
                    x={PAD_X - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="rgba(148,163,184,0.8)"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {dbVal > 0 ? `+${dbVal}` : dbVal}
                  </text>
                </g>
              );
            })}

            {/* Live 28-Bar FFT Spectrum Analyzer Behind Curve */}
            {spectrum.map((val, i) => {
              const barW = innerW / spectrum.length - 3;
              const x = PAD_X + i * (innerW / spectrum.length) + 1.5;
              const barH = Math.max(3, val * (innerH * 0.88));
              const y = PAD_Y + innerH - barH;
              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx="2"
                  fill="#FF5500"
                  opacity={0.14 + val * 0.22}
                />
              );
            })}

            {/* Vertical EQ Band Guidelines */}
            {EQ_BANDS.map((band) => {
              const x = freqToX(band.freq);
              return (
                <g key={band.freq}>
                  <line
                    x1={x}
                    y1={PAD_Y}
                    x2={x}
                    y2={H - PAD_Y}
                    stroke="rgba(255,255,255,0.05)"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={H - 6}
                    textAnchor="middle"
                    fill="rgba(148,163,184,0.85)"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {band.labelHz}
                  </text>
                </g>
              );
            })}

            {/* Composite Response Curve Area & Stroke */}
            <path d={areaPath} fill="url(#eqAreaFill)" />
            <path
              d={linePath}
              fill="none"
              stroke="#FF5500"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Draggable 7-Band Handle Nodes */}
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
                    fill="#FF5500"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* 7 Hardware Channel Faders */}
        <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-7" dir="ltr">
          {EQ_BANDS.map((band, idx) => {
            const gain = eq.gains[idx] ?? 0;
            const formatted = `${gain > 0 ? '+' : ''}${gain.toFixed(1)} dB`;
            return (
              <div
                key={band.freq}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#0B0D11] p-3 sm:flex-col sm:py-4"
              >
                <div className="flex flex-col items-start sm:items-center">
                  <span className="font-mono text-xs font-semibold text-white tabular-nums">
                    {band.labelHz}
                  </span>
                  <span className="text-[11px] text-slate-400" dir="rtl">
                    {band.hebrewRole}
                  </span>
                </div>

                {/* Vertical slider on desktop, horizontal on narrow mobile */}
                <div className="flex flex-1 items-center justify-center sm:my-3 sm:h-36 sm:flex-none">
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={(e) => onChangeBandGain(idx, Number(e.target.value))}
                    aria-label={`ערוץ תדר ${band.labelHz}`}
                    className="jbl-slider w-full sm:w-32 sm:-rotate-90"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => onChangeBandGain(idx, 0)}
                  title="לחיצה לאיפוס ערוץ ל-0.0 dB"
                  className={`min-h-[32px] rounded-lg px-2 py-1 font-mono text-xs font-medium tabular-nums transition-colors ${
                    Math.abs(gain) > 0.05
                      ? 'text-[#FF5500] hover:bg-white/[0.06]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {formatted}
                </button>
              </div>
            );
          })}
        </div>

        {/* User Saved Custom EQ Profiles (Complete Populated & Empty State Handling) */}
        <div className="mt-6 border-t border-white/[0.08] pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">פרופילי איקוולייזר שמורים במכשיר</h3>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {savedProfiles.length} פרופילים
            </span>
          </div>

          {savedProfiles.length === 0 ? (
            <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-white/[0.1] bg-[#0B0D11]/60 p-4 sm:flex-row sm:items-center">
              <p className="text-xs text-slate-400">
                עדיין לא נשמרו פרופילי סאונד אישיים. כוונן את תדרי ה-EQ ולחץ על ״שמור פרופיל אישי״ כדי לעבור ביניהם בלחיצה.
              </p>
              <button
                type="button"
                onClick={() => setShowSaveInput(true)}
                className="min-h-[38px] rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08] whitespace-nowrap shrink-0"
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
                        ? 'border-[#FF5500] bg-[#FF5500]/15 text-white'
                        : 'border-white/[0.08] bg-[#0B0D11] text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onApplySavedProfile(prof)}
                      className="min-h-[34px] text-xs font-medium hover:text-white whitespace-nowrap"
                    >
                      {prof.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteSavedProfile(prof.id)}
                      aria-label={`מחיקת פרופיל ${prof.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/15 hover:text-rose-400"
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

      {/* Section 2: JBL BassBoost (2-Level Hardware Circuit) & AI Sound Boost */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              הדגשת בס חכמה (BassBoost & AI Sound Boost)
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              שני מצבי תהודה ייעודיים לזוג הוופרים של ה-Stage 320 + אלגוריתם מניעת עיוותים בעוצמה גבוהה
            </p>
          </div>
          {playtimeBoost && (
            <span className="text-xs text-amber-400">
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
                className={`flex flex-col justify-between rounded-xl border p-4 text-right transition-colors ${
                  selected
                    ? 'border-[#FF5500] bg-[#FF5500]/[0.1]'
                    : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-white">
                    {item.title}
                  </span>
                  <Zap
                    className={`h-4 w-4 ${selected ? 'text-[#FF5500]' : 'text-slate-600'}`}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-400">{item.desc}</p>
              </button>
            );
          })}
        </div>

        {/* AI Sound Boost DSP Compressor Toggle */}
        <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Sliders className="h-4 w-4 text-[#FF5500]" />
              <span>מעבד דינמי AI Sound Boost</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              מנתח את אות השמע בזמן אמת למקסום הטווח הדינמי והפחתת עיוותי דרייבר בעוצמות גבוהות
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={eq.aiSoundBoost}
            onClick={onToggleAiSoundBoost}
            className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              eq.aiSoundBoost
                ? 'bg-[#FF5500] text-white'
                : 'border border-white/[0.1] bg-white/[0.03] text-slate-400 hover:text-white'
            }`}
          >
            {eq.aiSoundBoost ? 'AI Sound Boost פעיל' : 'כבוי'}
          </button>
        </div>
      </section>

      {/* Section 3: Acoustic Placement Environment Calibration */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <h3 className="font-display text-base font-semibold text-white">
          כיול אקוסטי לפי סביבת הצבה
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          התאמת עקומת פיזור הסאונד להחזרי קירות בחלל סגור לעומת התפשטות חופשית בחוץ
        </p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Indoor Card */}
          <button
            type="button"
            onClick={() => onChangeEnvironment(AcousticEnvironment.Indoor)}
            className={`group relative h-48 overflow-hidden rounded-2xl border text-right transition-colors ${
              eq.environment === AcousticEnvironment.Indoor
                ? 'border-[#FF5500]'
                : 'border-white/[0.08] hover:border-white/[0.2]'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
            {!indoorImgFailed && (
              <img
                src={INDOOR_IMAGE_SRC}
                alt="סביבת האזנה ביתית בסלון אקוסטי"
                referrerPolicy="no-referrer"
                onError={() => setIndoorImgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/15" />

            <div className="relative z-10 flex h-full flex-col justify-end p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-semibold text-white">
                  חלל פנים / סלון ואולפן
                </span>
                <span className="text-xs font-medium text-slate-200">
                  {eq.environment === AcousticEnvironment.Indoor ? 'נבחר כעת' : 'בחר'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                ריסון הדהודי פינות בתדרי 95Hz לקבלת בס מדויק ונקי בחדרים סגורים
              </p>
            </div>
          </button>

          {/* Outdoor Card */}
          <button
            type="button"
            onClick={() => onChangeEnvironment(AcousticEnvironment.Outdoor)}
            className={`group relative h-48 overflow-hidden rounded-2xl border text-right transition-colors ${
              eq.environment === AcousticEnvironment.Outdoor
                ? 'border-[#FF5500]'
                : 'border-white/[0.08] hover:border-white/[0.2]'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-black" />
            {!outdoorImgFailed && (
              <img
                src={OUTDOOR_IMAGE_SRC}
                alt="סביבת מסיבת חוץ ומרפסת גג פתוחה"
                referrerPolicy="no-referrer"
                onError={() => setOutdoorImgFailed(true)}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/15" />

            <div className="relative z-10 flex h-full flex-col justify-end p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-base font-semibold text-white">
                  שטח פתוח / מרפסת וחצר
                </span>
                <span className="text-xs font-medium text-slate-200">
                  {eq.environment === AcousticEnvironment.Outdoor ? 'נבחר כעת' : 'בחר'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-300">
                תוספת הקרנה של +2.5dB בנמוכים ו-+2.0dB בגבוהים לפיצוי על אובדן אקוסטי באוויר הפתוח
              </p>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
};
