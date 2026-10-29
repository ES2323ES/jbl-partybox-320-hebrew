import React from 'react';
import { ArrowLeftRight, Power, RotateCcw, Sparkles, Sun, Zap } from 'lucide-react';
import {
  COLOR_SWATCH_PAIRS,
  LIGHTSHOW_PRESETS,
  LightZoneKey,
  LightshowPresetId,
  LightshowState,
} from '../types/speaker';

interface LightshowPanelProps {
  lightshow: LightshowState;
  onUpdateLightshow: (patch: Partial<LightshowState>) => void;
  onSelectPreset: (preset: LightshowPresetId, applyDefaultColors?: boolean) => void;
  onToggleZone: (zone: LightZoneKey) => void;
  onSetAllZones: (active: boolean) => void;
  onResetLightshow: () => void;
}

const ZONE_ITEMS: Array<{
  key: LightZoneKey;
  title: string;
  subtitle: string;
}> = [
  {
    key: 'rings',
    title: 'טבעות שמינייה כפולות (Figure-8)',
    subtitle: 'זוג טבעות LED היקפיות סביב הוופרים בקוטר 6.5 אינץ׳',
  },
  {
    key: 'strobeTop',
    title: 'מבזק סטרוב עליון',
    subtitle: 'פס הבזקים לבן בעוצמה גבוהה מעל מערך הטוויטרים',
  },
  {
    key: 'strobeBottom',
    title: 'מבזק סטרוב תחתון',
    subtitle: 'פס הבזקים תחתון להשלמת שטיפת אור ברחבה',
  },
  {
    key: 'starry',
    title: 'מטריצת כוכבים (Starry Night)',
    subtitle: 'נקודות אור זעירות המפוזרות מאחורי גריל הרמקול',
  },
  {
    key: 'sideRails',
    title: 'פסי תאורה צדדיים',
    subtitle: 'עמודות תאורה אנכיות לאורך דפנות התיבה',
  },
];

export const LightshowPanel: React.FC<LightshowPanelProps> = ({
  lightshow,
  onUpdateLightshow,
  onSelectPreset,
  onToggleZone,
  onSetAllZones,
  onResetLightshow,
}) => {
  const presetEntries = Object.entries(LIGHTSHOW_PRESETS) as Array<
    [LightshowPresetId, (typeof LIGHTSHOW_PRESETS)[LightshowPresetId]]
  >;

  const swapColors = () => {
    onUpdateLightshow({
      primaryColor: lightshow.secondaryColor,
      secondaryColor: lightshow.primaryColor,
    });
  };

  return (
    <div className="space-y-8">
      {/* Section 1: Master Lightshow Header & Power */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-white">
              סטודיו תאורת מופע (Lightshow)
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              שליטה מלאה על דפוסי תנועה, אזורי הארה פיזיים, צבעוניות דו-גוונית וסנכרון לקצב הבס.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onResetLightshow}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>איפוס ברירת מחדל</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateLightshow({ enabled: !lightshow.enabled })}
              className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                lightshow.enabled
                  ? 'bg-[#FF5500] text-white'
                  : 'border border-white/[0.12] bg-white/[0.05] text-slate-300 hover:bg-white/[0.1]'
              }`}
            >
              <Power className="h-4 w-4" />
              <span>{lightshow.enabled ? 'תאורה דולקת' : 'הדלק תאורה'}</span>
            </button>
          </div>
        </div>

        {/* Beat Sync Toggle Row */}
        <div className="mt-6 flex flex-col gap-4 border-t border-white/[0.08] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-white">
              סנכרון דינמי לקצב המוזיקה (Beat-Sync)
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              מתאים אוטומטית את מהירות הטבעות והבזקי הסטרוב להתקפי תדר הסאב-בס בזמן אמת
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={lightshow.beatSync}
            onClick={() => onUpdateLightshow({ beatSync: !lightshow.beatSync })}
            className={`flex min-h-[40px] items-center gap-2.5 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              lightshow.beatSync
                ? 'border-[#FF5500]/60 bg-[#FF5500]/15 text-white'
                : 'border-white/[0.1] bg-white/[0.03] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-[#FF5500]" />
            <span>{lightshow.beatSync ? 'מסונכרן לקצב: פעיל' : 'מסונכרן לקצב: כבוי'}</span>
          </button>
        </div>
      </section>

      {/* Section 2: 6 Authentic JBL Lightshow Modes */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              01. מצבי אפקט ותנועה
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              בחר את אופי הזרימה על פני שמיניית התאורה של ה-PartyBox 320
            </p>
          </div>
          <span className="text-xs text-slate-400">
            פעיל כעת: <strong className="text-white">{LIGHTSHOW_PRESETS[lightshow.preset].title}</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presetEntries.map(([id, info]) => {
            const isSelected = lightshow.preset === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectPreset(id, false)}
                className={`group flex flex-col justify-between rounded-xl border p-4 text-right transition-colors ${
                  isSelected
                    ? 'border-[#FF5500] bg-[#FF5500]/[0.09]'
                    : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-white">
                    {info.title}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-3 w-8 rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${info.defaultPrimary}, ${info.defaultSecondary})`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {info.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 3: Color Palette & Dual Gradient Customizer */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-white">
              02. פלטת צבעים ומיזוג גוונים
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              שילוב דו-צבעי לטבעת העליונה והתחתונה או בחירה חופשית מתוך בורר הצבעים
            </p>
          </div>

          <button
            type="button"
            onClick={swapColors}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[#FF5500]" />
            <span>החלף צבע ראשי ומשני</span>
          </button>
        </div>

        {/* Curated Swatches */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {COLOR_SWATCH_PAIRS.map((pair) => {
            const active =
              lightshow.primaryColor.toLowerCase() === pair.primary.toLowerCase() &&
              lightshow.secondaryColor.toLowerCase() === pair.secondary.toLowerCase();
            return (
              <button
                key={pair.id}
                type="button"
                onClick={() =>
                  onUpdateLightshow({
                    primaryColor: pair.primary,
                    secondaryColor: pair.secondary,
                  })
                }
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-right transition-colors ${
                  active
                    ? 'border-[#FF5500] bg-white/[0.08] text-white'
                    : 'border-white/[0.07] bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 rounded-full border border-white/20"
                  style={{
                    background: `linear-gradient(135deg, ${pair.primary}, ${pair.secondary})`,
                  }}
                />
                <span className="truncate text-xs font-medium">{pair.name}</span>
              </button>
            );
          })}
        </div>

        {/* Custom Color Pickers */}
        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-5 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#0B0D11] px-4 py-3 cursor-pointer">
            <div>
              <div className="text-xs font-medium text-white">גוון טבעת ראשי</div>
              <div className="mt-0.5 font-mono text-xs text-slate-400 tabular-nums" dir="ltr">
                {lightshow.primaryColor.toUpperCase()}
              </div>
            </div>
            <input
              type="color"
              value={lightshow.primaryColor}
              onChange={(e) => onUpdateLightshow({ primaryColor: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent"
              aria-label="בחירת צבע ראשי לתאורה"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-[#0B0D11] px-4 py-3 cursor-pointer">
            <div>
              <div className="text-xs font-medium text-white">גוון משני ומעברים</div>
              <div className="mt-0.5 font-mono text-xs text-slate-400 tabular-nums" dir="ltr">
                {lightshow.secondaryColor.toUpperCase()}
              </div>
            </div>
            <input
              type="color"
              value={lightshow.secondaryColor}
              onChange={(e) => onUpdateLightshow({ secondaryColor: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent"
              aria-label="בחירת צבע משני לתאורה"
            />
          </label>
        </div>
      </section>

      {/* Section 4: Intensity, Speed, Strobe & 5 Hardware Zones */}
      <section className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-6">
        <h3 className="font-display text-base font-semibold text-white">
          03. עוצמה, מהירות ואזורי תאורה פיזיים
        </h3>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Brightness */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-200">
                <Sun className="h-3.5 w-3.5 text-[#FF5500]" />
                <span>בהירות כללית</span>
              </span>
              <span className="font-mono text-slate-300 tabular-nums" dir="ltr">
                {lightshow.brightness}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={lightshow.brightness}
              onChange={(e) => onUpdateLightshow({ brightness: Number(e.target.value) })}
              className="jbl-slider w-full"
            />
          </div>

          {/* Animation Speed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-[#FF5500]" />
                <span>מהירות תנועה</span>
              </span>
              <span className="font-mono text-slate-300 tabular-nums" dir="ltr">
                {lightshow.speed.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={2.5}
              step={0.1}
              value={lightshow.speed}
              onChange={(e) => onUpdateLightshow({ speed: Number(e.target.value) })}
              className="jbl-slider w-full"
            />
          </div>

          {/* Strobe Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-200">
                <Zap className="h-3.5 w-3.5 text-[#FF5500]" />
                <span>תדירות מבזק סטרוב</span>
              </span>
              <span className="font-mono text-slate-300 tabular-nums" dir="ltr">
                {lightshow.strobeIntensity}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={lightshow.strobeIntensity}
              onChange={(e) => onUpdateLightshow({ strobeIntensity: Number(e.target.value) })}
              className="jbl-slider w-full"
            />
          </div>
        </div>

        {/* 5 Individual Hardware Zones */}
        <div className="mt-7 border-t border-white/[0.08] pt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-white">
              מיתוג אזורי תאורה בתיבת הרמקול
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSetAllZones(true)}
                className="min-h-[36px] rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs font-medium text-slate-300 hover:bg-white/[0.08] whitespace-nowrap shrink-0"
              >
                הדלק את כל האזורים
              </button>
              <button
                type="button"
                onClick={() => {
                  if (lightshow.zones.strobeTop) onToggleZone('strobeTop');
                  if (lightshow.zones.strobeBottom) onToggleZone('strobeBottom');
                }}
                className="min-h-[36px] rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs font-medium text-slate-300 hover:bg-white/[0.08] whitespace-nowrap shrink-0"
              >
                ללא סטרובים
              </button>
            </div>
          </div>

          <div className="divide-y divide-white/[0.06]">
            {ZONE_ITEMS.map((z) => {
              const active = lightshow.zones[z.key];
              return (
                <div
                  key={z.key}
                  className="flex items-center justify-between gap-4 py-3.5 first:pt-1 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-100">{z.title}</div>
                    <div className="text-xs text-slate-400">{z.subtitle}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => onToggleZone(z.key)}
                    className={`min-h-[40px] min-w-[84px] rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#FF5500] text-white'
                        : 'border border-white/[0.1] bg-white/[0.03] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {active ? 'פעיל' : 'כבוי'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
