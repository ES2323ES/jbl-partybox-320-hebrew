import React from 'react';
import { BatteryCharging, ChevronLeft, Disc3, Sliders, Sparkles, Zap } from 'lucide-react';
import {
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
} from '../types/speaker';

interface OverviewPanelProps {
  lightshow: LightshowState;
  eq: EqualizerState;
  batteryPercent: number;
  playtimeBoost: boolean;
  volume: number;
  onNavigate: (tab: NavTab) => void;
  onSelectLightPreset: (preset: LightshowPresetId) => void;
  onUpdateLightColors: (primary: string, secondary: string) => void;
  onSelectEqPreset: (preset: Exclude<EqPresetId, EqPresetId.Custom>) => void;
  onChangeBassBoost: (mode: BassBoostMode) => void;
  onTogglePlaytimeBoost: () => void;
  onTriggerDjEffect: (effect: DjPadEffectId) => void;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  lightshow,
  eq,
  batteryPercent,
  playtimeBoost,
  volume,
  onNavigate,
  onSelectLightPreset,
  onUpdateLightColors,
  onSelectEqPreset,
  onChangeBassBoost,
  onTogglePlaytimeBoost,
  onTriggerDjEffect,
}) => {
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
    LightshowPresetId.Rock,
    LightshowPresetId.Flow,
    LightshowPresetId.Cross,
    LightshowPresetId.Ripple,
  ];

  const quickEqPresets: Array<Exclude<EqPresetId, EqPresetId.Custom>> = [
    EqPresetId.JblSignature,
    EqPresetId.Party,
    EqPresetId.DeepBass,
    EqPresetId.Vocal,
  ];

  return (
    <div className="space-y-6">
      {/* Quick Lightshow Studio Summary */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
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
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectLightPreset(id)}
                className={`flex min-h-[46px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-[#D95B2B] bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span className="truncate">{LIGHTSHOW_PRESETS[id].title}</span>
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#D95B2B]" />
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

      {/* Quick Equalizer & BassBoost Summary */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
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
            <span>פתיחת איקוולייזר מלא</span>
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Preset Buttons */}
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

        {/* Mini 7-Band Bar Readout */}
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

        {/* BassBoost Segmented Bar */}
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

      {/* Battery 400 & Instant PartyPad Strip */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Battery 400 Management */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
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
              <span className="font-mono text-3xl font-semibold text-slate-900 dark:text-white tabular-nums" dir="ltr">
                {batteryPercent}%
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                כ-<strong className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">{estimatedHours.toFixed(1)}</strong> שעות ניגון נותרו
              </span>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-slate-700/60">
            <div>
              <div className="text-xs font-medium text-slate-900 dark:text-white">Playtime Boost</div>
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

        {/* Quick DJ Sound Pads */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                משטח אפקטי PartyPad™
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                הפעלת צלילי DJ חיים המשתלבים בשמע ומקפיצים את תאורת הבמה
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(NavTab.PartyFx)}
              className="flex min-h-[36px] items-center gap-1 text-xs font-semibold text-[#D95B2B] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>מיקסר ומיקרופון</span>
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
