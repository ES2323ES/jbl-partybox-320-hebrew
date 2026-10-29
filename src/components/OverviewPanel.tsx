import React, { useState } from 'react';
import {
  BatteryCharging,
  BellRing,
  ChevronLeft,
  Clock,
  Disc3,
  Download,
  RefreshCw,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  APP_VERSION,
  BUILTIN_EQ_PRESETS,
  BassBoostMode,
  COLOR_SWATCH_PAIRS,
  DjPadEffectId,
  EQ_BANDS,
  EqPresetId,
  EqualizerState,
  LIGHTSHOW_PRESETS,
  LightshowPresetId,
  LightshowState,
  NavTab,
  PARTY_SCENES,
  PartySceneDefinition,
  PartySceneId,
} from '../types/speaker';
import {
  GithubUpdateCheckResult,
  bluetoothBridge,
} from '../services/bluetoothBridge';

interface OverviewPanelProps {
  lightshow: LightshowState;
  eq: EqualizerState;
  batteryPercent: number;
  playtimeBoost: boolean;
  volume: number;
  activeSceneId: PartySceneId | null;
  sleepRemainingSec: number | null;
  notificationControlsEnabled: boolean;
  autoReconnect: boolean;
  onNavigate: (tab: NavTab) => void;
  onApplyPartyScene: (scene: PartySceneDefinition) => void;
  onSelectLightPreset: (preset: LightshowPresetId, applyDefaultColors?: boolean) => void;
  onUpdateLightColors: (primary: string, secondary: string) => void;
  onSelectEqPreset: (preset: Exclude<EqPresetId, EqPresetId.Custom>) => void;
  onChangeBassBoost: (mode: BassBoostMode) => void;
  onTogglePlaytimeBoost: () => void;
  onTriggerDjEffect: (effect: DjPadEffectId) => void;
  onStartSleepTimer: (minutes: number | null) => void;
  onToggleNotificationControls: () => void;
  onToggleAutoReconnect: () => void;
}

function formatTimerClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  lightshow,
  eq,
  batteryPercent,
  playtimeBoost,
  volume,
  activeSceneId,
  sleepRemainingSec,
  notificationControlsEnabled,
  autoReconnect,
  onNavigate,
  onApplyPartyScene,
  onSelectLightPreset,
  onUpdateLightColors,
  onSelectEqPreset,
  onChangeBassBoost,
  onTogglePlaytimeBoost,
  onTriggerDjEffect,
  onStartSleepTimer,
  onToggleNotificationControls,
  onToggleAutoReconnect,
}) => {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<GithubUpdateCheckResult | null>(null);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  const baseMaxHours = playtimeBoost ? 18.0 : 15.0;
  const lightLoadPenalty = lightshow.enabled ? (lightshow.brightness / 100) * 1.8 : 0;
  const bassLoadPenalty =
    !playtimeBoost && eq.bassBoost !== BassBoostMode.Off ? 1.2 : 0;
  const volumeLoadPenalty = Math.max(0, (volume - 55) / 45) * 2.1;
  const estimatedHours = Math.max(
    1.5,
    ((baseMaxHours - lightLoadPenalty - bassLoadPenalty - volumeLoadPenalty) *
      batteryPercent) /
      100
  );

  const quickLightPresets: LightshowPresetId[] = [
    LightshowPresetId.Neon,
    LightshowPresetId.Rock,
    LightshowPresetId.Flow,
    LightshowPresetId.Ripple,
  ];

  const quickEqPresets: Array<Exclude<EqPresetId, EqPresetId.Custom>> = [
    EqPresetId.JblSignature,
    EqPresetId.Party,
    EqPresetId.DeepBass,
    EqPresetId.Vocal,
  ];

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    setUpdateErr(null);
    try {
      const res = await bluetoothBridge.checkGithubLatestRelease();
      setUpdateInfo(res);
    } catch (e) {
      setUpdateErr(e instanceof Error ? e.message : 'שגיאה בבדיקת עדכונים');
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 0: One-Click Smart Party Scenes */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              סצנות מסיבה חכמות בלחיצה אחת
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              מתאימות יחד תאורה, עקומת איקוולייזר, עוצמת בס וווליום לכל שלב באירוע
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {PARTY_SCENES.map((scene) => {
            const isSelected = activeSceneId === scene.id;
            const isNeonScene = scene.id === 'neon_club';
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => onApplyPartyScene(scene)}
                className={`flex min-h-[78px] flex-col justify-between rounded-xl border p-3.5 text-right transition-all cursor-pointer ${
                  isSelected
                    ? isNeonScene
                      ? 'border-cyan-400 bg-gradient-to-l from-cyan-500/15 to-fuchsia-500/15 shadow-[0_0_16px_rgba(0,240,255,0.2)]'
                      : 'border-[#D95B2B] bg-[#D95B2B]/10'
                    : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {scene.title}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-3 w-7 shrink-0 rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${scene.primaryColor}, ${scene.secondaryColor})`,
                    }}
                  />
                </div>
                <p className="mt-1.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                  {scene.subtitle}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 1: Quick Lightshow Studio Summary (with Neon Glow!) */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              תאורת מופע מהירה
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              מצב פעיל:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {LIGHTSHOW_PRESETS[lightshow.preset].title}
              </strong>{' '}
              · בהירות{' '}
              <span className="font-mono tabular-nums" dir="ltr">
                {lightshow.enabled ? `${lightshow.brightness}%` : 'כבוי'}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(NavTab.Lightshow)}
            className="flex min-h-[40px] items-center gap-1 text-xs font-semibold text-[#D95B2B] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>שליטה מלאה בתאורה</span>
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {quickLightPresets.map((id) => {
            const active = lightshow.preset === id && lightshow.enabled;
            const isNeonCard = id === LightshowPresetId.Neon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectLightPreset(id, isNeonCard)}
                className={`flex min-h-[46px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? isNeonCard
                      ? 'border-cyan-400 bg-gradient-to-l from-cyan-500/20 to-fuchsia-500/20 text-cyan-900 dark:text-cyan-200'
                      : 'border-[#D95B2B] bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span className="truncate">{LIGHTSHOW_PRESETS[id].title}</span>
                <Sparkles
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isNeonCard ? 'text-cyan-500 dark:text-cyan-400' : 'text-[#D95B2B]'
                  }`}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-700/60">
          <span className="text-xs text-slate-500 dark:text-slate-400">החלפת צבע מהירה:</span>
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_SWATCH_PAIRS.map((pair) => {
              const selected =
                lightshow.primaryColor.toLowerCase() === pair.primary.toLowerCase();
              return (
                <button
                  key={pair.id}
                  type="button"
                  onClick={() => onUpdateLightColors(pair.primary, pair.secondary)}
                  title={pair.name}
                  aria-label={`צבע תאורה ${pair.name}`}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform cursor-pointer ${
                    selected
                      ? 'scale-110 border-slate-900 dark:border-white'
                      : 'border-slate-300 hover:scale-105 dark:border-slate-600'
                  }`}
                >
                  <span
                    className="h-6 w-6 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${pair.primary}, ${pair.secondary})`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 2: Quick Equalizer & BassBoost Summary */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              חתימת סאונד ואיקוולייזר
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              7 ערוצי תדר פעילים · הדגשת בס:{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {eq.bassBoost === BassBoostMode.Deep
                  ? 'עמוק (48Hz)'
                  : eq.bassBoost === BassBoostMode.Punchy
                    ? 'הדוק (84Hz)'
                    : 'כבוי'}
              </strong>
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate(NavTab.Equalizer)}
            className="flex min-h-[40px] items-center gap-1 text-xs font-semibold text-[#D95B2B] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>כיול חדר ואיקוולייזר מלא</span>
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {quickEqPresets.map((id) => {
            const active = eq.preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectEqPreset(id)}
                className={`flex min-h-[46px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-[#D95B2B] bg-[#D95B2B] text-white'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span className="truncate">{BUILTIN_EQ_PRESETS[id].title}</span>
                <Sliders className="h-3.5 w-3.5 shrink-0 opacity-80" />
              </button>
            );
          })}
        </div>

        <div
          className="mt-4 grid grid-cols-7 gap-2 rounded-xl border border-slate-200/80 bg-slate-50 p-3.5 dark:border-slate-700/70 dark:bg-[#141B27]"
          dir="ltr"
        >
          {EQ_BANDS.map((band, idx) => {
            const val = eq.gains[idx] ?? 0;
            const normPercent = ((val + 12) / 24) * 100;
            return (
              <div key={band.freq} className="flex flex-col items-center gap-1.5">
                <div className="relative h-16 w-2 rounded-full bg-slate-200 dark:bg-slate-700/80">
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-full bg-[#D95B2B]"
                    style={{ height: `${Math.max(8, normPercent)}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {band.labelHz}
                </span>
                <span className="font-mono text-[10px] font-medium text-slate-800 dark:text-slate-200 tabular-nums">
                  {val > 0 ? `+${val}` : val}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
            <Zap className="h-3.5 w-3.5 text-[#D95B2B]" />
            <span>דרגת JBL BassBoost:</span>
          </span>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-700/70 dark:bg-[#141B27]">
            {[
              { id: BassBoostMode.Off, label: 'כבוי' },
              { id: BassBoostMode.Deep, label: 'עמוק (Deep)' },
              { id: BassBoostMode.Punchy, label: 'הדוק (Punchy)' },
            ].map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onChangeBassBoost(b.id)}
                className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  eq.bassBoost === b.id
                    ? 'bg-[#D95B2B] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: Sleep Fade-Out Timer + Smart Android Notification Controls & Auto-Update */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Gradual Sleep & Fade-Out Timer */}
        <section className="neon-surface flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#D95B2B]" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  טיימר כיבוי והנמכה הדרגתית
                </h3>
              </div>
              {sleepRemainingSec !== null && (
                <span
                  className="font-mono text-sm font-bold text-[#D95B2B] tabular-nums"
                  dir="ltr"
                >
                  {formatTimerClock(sleepRemainingSec)}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              מנמיך בהדרגה את עוצמת המוזיקה בדקה האחרונה ומכבה אוטומטית את השמע ואת תאורת המופע
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { mins: null, label: 'כבוי' },
                { mins: 1, label: '1 דק׳ (בדיקה)' },
                { mins: 15, label: '15 דקות' },
                { mins: 30, label: '30 דקות' },
                { mins: 45, label: '45 דקות' },
                { mins: 60, label: '60 דקות' },
              ].map((opt) => {
                const isOffActive = opt.mins === null && sleepRemainingSec === null;
                const isMinActive =
                  opt.mins !== null &&
                  sleepRemainingSec !== null &&
                  Math.abs(sleepRemainingSec - opt.mins * 60) < 35;
                const active = isOffActive || isMinActive;
                return (
                  <button
                    key={String(opt.mins)}
                    type="button"
                    onClick={() => onStartSleepTimer(opt.mins)}
                    className={`min-h-[40px] rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? 'border-[#D95B2B] bg-[#D95B2B] text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 border-t border-slate-200/80 pt-4 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
            {sleepRemainingSec !== null
              ? `הנמכה אוטומטית פעילה — הרמקול יעבור להשתקה וכיבוי תאורה בעוד ${formatTimerClock(sleepRemainingSec)}.`
              : 'בחר פרק זמן כדי להגדיר סיום אוטומטי שקט למסיבה או להאזנת לילה.'}
          </div>
        </section>

        {/* Android Notification Shade Controls, Auto-Connect & GitHub Update Checker */}
        <section className="neon-surface flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BellRing className="h-4 w-4 text-[#D95B2B]" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  שליטה חכמה מווילון ההתראות ועדכונים
                </h3>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-3 dark:border-slate-700/60">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  שליטה מווילון ההתראות וממסך הנעילה
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  כפתורי ניגון, תאורת ניאון והדגשת בס ישירות מההתראות באנדרואיד
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notificationControlsEnabled}
                onClick={onToggleNotificationControls}
                className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  notificationControlsEnabled
                    ? 'bg-teal-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
                }`}
              >
                {notificationControlsEnabled ? 'פעיל' : 'הפעל'}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 pb-3 dark:border-slate-700/60">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">
                  חיבור אוטומטי וטעינת פרופיל בהפעלה
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  מזהה אוטומטית רמקול מותאם ומשחזר את הגדרות הסאונד והתאורה
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoReconnect}
                onClick={onToggleAutoReconnect}
                className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  autoReconnect
                    ? 'bg-teal-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
                }`}
              >
                {autoReconnect ? 'פעיל' : 'כבוי'}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                גרסה מותקנת כעת: <strong className="font-mono" dir="ltr">{APP_VERSION}</strong>
              </span>
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={handleCheckUpdates}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-[#D95B2B] ${checkingUpdate ? 'animate-spin' : ''}`} />
                <span>{checkingUpdate ? 'בודק במאגר...' : 'בדוק עדכון בגיטהאב'}</span>
              </button>
            </div>

            {updateInfo && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-[#141B27]">
                <span className="text-slate-700 dark:text-slate-200">
                  {updateInfo.hasNewerVersion
                    ? `זמינה גרסה חדשה במאגר (${updateInfo.tagName} · ${updateInfo.remoteVersion})!`
                    : `האפליקציה מעודכנת לגרסה האחרונה במאגר (${updateInfo.tagName}).`}
                </span>
                {updateInfo.apkDownloadUrl && (
                  <a
                    href={updateInfo.apkDownloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#D95B2B] hover:underline whitespace-nowrap"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>הורד APK</span>
                  </a>
                )}
              </div>
            )}

            {updateErr && (
              <p className="text-xs text-amber-700 dark:text-amber-300">{updateErr}</p>
            )}
          </div>
        </section>
      </div>

      {/* Section 4: Battery 400 & Instant PartyPad Strip */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="neon-surface flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                סוללה נשלפת JBL Battery 400
              </h3>
              <BatteryCharging className="h-5 w-5 text-[#D95B2B]" />
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              חישוב זמן ניגון משוער בהתאם לעוצמת השמע, בהירות התאורה והדגשת הבס הנוכחיים
            </p>

            <div className="mt-5 flex items-baseline gap-4">
              <span
                className="font-mono text-3xl font-semibold text-slate-900 dark:text-white tabular-nums"
                dir="ltr"
              >
                {batteryPercent}%
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                כ-
                <strong className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                  {estimatedHours.toFixed(1)}
                </strong>{' '}
                שעות ניגון נותרו
              </span>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-700/60">
            <div>
              <div className="text-xs font-medium text-slate-900 dark:text-white">
                Playtime Boost
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                מוסיף עד 3 שעות סוללה על ידי אופטימיזציית הספק
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={playtimeBoost}
              onClick={onTogglePlaytimeBoost}
              className={`min-h-[38px] rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                playtimeBoost
                  ? 'bg-teal-600 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {playtimeBoost ? 'חיסכון פעיל' : 'הפעל חיסכון'}
            </button>
          </div>
        </section>

        <section className="neon-surface flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                משטח אפקטי PartyPad™ וסמפלר אישי
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                הפעלת צלילי DJ חיים או מעבר להקלטת קריאות קהל אישיות וקריוקי חי
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(NavTab.PartyFx)}
              className="flex min-h-[36px] items-center gap-1 text-xs font-semibold text-[#D95B2B] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>קריוקי וסמפלר</span>
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {[
              { id: 'airhorn' as DjPadEffectId, label: 'צופר אוויר' },
              { id: 'bassdrop' as DjPadEffectId, label: 'דרופ בס' },
              { id: 'laser' as DjPadEffectId, label: 'לייזר' },
            ].map((pad) => (
              <button
                key={pad.id}
                type="button"
                onClick={() => onTriggerDjEffect(pad.id)}
                className="flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800 transition-transform active:scale-95 hover:border-[#D95B2B]/60 hover:bg-[#D95B2B]/10 dark:border-slate-700 dark:bg-[#141B27] dark:text-white cursor-pointer"
              >
                <Disc3 className="h-4 w-4 text-[#D95B2B]" />
                <span className="whitespace-nowrap">{pad.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
