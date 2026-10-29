import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Bluetooth,
  CheckCircle2,
  ClipboardList,
  Power,
  Radio,
  RotateCcw,
  Send,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react';
import {
  COLOR_SWATCH_PAIRS,
  LIGHTSHOW_PRESETS,
  LightZoneKey,
  LightingProtocolMode,
  LightshowPresetId,
  LightshowState,
} from '../types/speaker';
import {
  LightingChannelDiagnostics,
  bluetoothBridge,
} from '../services/bluetoothBridge';

interface LightshowPanelProps {
  lightshow: LightshowState;
  onUpdateLightshow: (patch: Partial<LightshowState>) => void;
  onSelectPreset: (preset: LightshowPresetId, applyDefaultColors?: boolean) => void;
  onToggleZone: (zone: LightZoneKey) => void;
  onSetAllZones: (active: boolean) => void;
  onResetLightshow: () => void;
  onOpenBluetoothModal: () => void;
  onOpenFaultLog: () => void;
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
    subtitle: 'פס הבזקים בעוצמה גבוהה מעל מערך הטוויטרים',
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

const PROTOCOL_MODES: Array<{ id: LightingProtocolMode; label: string }> = [
  { id: 'auto_dual', label: 'אוטומטי כפול (מומלץ)' },
  { id: 'harman_aa', label: 'Harman SmartAudio' },
  { id: 'gatt_raw', label: 'GATT ישיר' },
];

export const LightshowPanel: React.FC<LightshowPanelProps> = ({
  lightshow,
  onUpdateLightshow,
  onSelectPreset,
  onToggleZone,
  onSetAllZones,
  onResetLightshow,
  onOpenBluetoothModal,
  onOpenFaultLog,
}) => {
  const [diag, setDiag] = useState<LightingChannelDiagnostics>(() =>
    bluetoothBridge.getLightingDiagnostics()
  );
  const [protocolMode, setProtocolMode] = useState<LightingProtocolMode>(() =>
    bluetoothBridge.getLightingProtocolMode()
  );
  const [testFeedback, setTestFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    setDiag(bluetoothBridge.getLightingDiagnostics());
    return bluetoothBridge.onDiagnosticsChanged(() => {
      setDiag(bluetoothBridge.getLightingDiagnostics());
      setProtocolMode(bluetoothBridge.getLightingProtocolMode());
    });
  }, []);

  const presetEntries = Object.entries(LIGHTSHOW_PRESETS) as Array<
    [LightshowPresetId, (typeof LIGHTSHOW_PRESETS)[LightshowPresetId]]
  >;

  const swapColors = () => {
    onUpdateLightshow({
      primaryColor: lightshow.secondaryColor,
      secondaryColor: lightshow.primaryColor,
    });
  };

  const handleProtocolChange = (mode: LightingProtocolMode) => {
    bluetoothBridge.setLightingProtocolMode(mode);
    setProtocolMode(mode);
    bluetoothBridge.syncHardwareLightshow(lightshow, true);
  };

  const handleSendHardwareTest = async () => {
    setSendingTest(true);
    setTestFeedback(null);
    const res = await bluetoothBridge.sendTestLightingFlash(lightshow);
    setTestFeedback({ ok: res.ok, text: res.message });
    setSendingTest(false);
  };

  const isNeonActive =
    lightshow.enabled && lightshow.preset === LightshowPresetId.Neon;

  const transportLabel =
    diag.transport === 'android_dual'
      ? 'אנדרואיד כפול (BLE GATT + SPP)'
      : diag.transport === 'android_ble_gatt'
        ? 'אנדרואיד BLE GATT'
        : diag.transport === 'android_spp'
          ? 'אנדרואיד RFCOMM SPP'
          : diag.transport === 'web_ble_gatt'
            ? 'דפדפן Web Bluetooth GATT'
            : 'ממתין לחיבור ערוץ תאורה ברמקול';

  return (
    <div className="space-y-6">
      {/* Section 0: Hardware Speaker Lighting Channel Status & Live Test */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-5 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Radio
                className={`h-4 w-4 ${
                  diag.connected ? 'text-teal-500' : 'text-[#D95B2B]'
                }`}
              />
              <span>שידור תאורה חי לרמקול הנייד:</span>
              <span
                className={
                  diag.connected
                    ? 'font-bold text-teal-600 dark:text-teal-400'
                    : 'font-bold text-amber-600 dark:text-amber-400'
                }
              >
                {transportLabel}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {diag.connected ? (
                <>
                  ערוץ בקרה פעיל · נשלחו{' '}
                  <strong className="font-mono text-slate-800 dark:text-slate-200 tabular-nums">
                    {diag.packetsSent}
                  </strong>{' '}
                  פקודות תאורה לרמקול
                  {diag.activeCharacteristicUuid
                    ? ` (${diag.activeCharacteristicUuid.slice(0, 8)})`
                    : ''}
                  . כל שינוי צבע, ניאון, אזור וקצב משודר מיידית.
                </>
              ) : (
                <>
                  כדי שהתאורה ברמקול הנייד תגיב בפועל לכל לחיצה, חבר את{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    JBL PartyBox Stage 320
                  </strong>{' '}
                  בחלון ה-Bluetooth. באפליקציית ה-APK נפתחים אוטומטית גם ערוץ{' '}
                  <strong>BLE GATT</strong> וגם ערוץ <strong>SPP</strong>.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {!diag.connected && (
              <button
                type="button"
                onClick={onOpenBluetoothModal}
                className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#D95B2B] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#C24E22] whitespace-nowrap cursor-pointer"
              >
                <Bluetooth className="h-3.5 w-3.5" />
                <span>חבר ערוץ תאורה ברמקול</span>
              </button>
            )}

            <button
              type="button"
              disabled={sendingTest}
              onClick={handleSendHardwareTest}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-100 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <Send className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>
                {sendingTest ? 'משדר לרמקול...' : 'שלח בדיקת תאורה לרמקול'}
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenFaultLog}
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap cursor-pointer"
            >
              <ClipboardList className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>יומן תקלות</span>
            </button>
          </div>
        </div>

        {/* Protocol Mode Selector */}
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-200/80 pt-3.5 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
            <Activity className="h-3.5 w-3.5 text-[#D95B2B]" />
            <span>פרוטוקול תקשורת תאורה מול הרמקול:</span>
          </span>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-700/70 dark:bg-[#141B27]">
            {PROTOCOL_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleProtocolChange(m.id)}
                className={`min-h-[32px] rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  protocolMode === m.id
                    ? 'bg-[#D95B2B] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {testFeedback && (
          <div
            className={`mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
              testFeedback.ok
                ? 'border-teal-500/40 bg-teal-50/70 text-teal-900 dark:bg-teal-950/30 dark:text-teal-200'
                : 'border-amber-400/50 bg-amber-50/80 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
            }`}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{testFeedback.text}</span>
          </div>
        )}
      </section>

      {/* Section 1: Master Lightshow Header, Neon Quick Trigger & Power */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              סטודיו תאורת מופע וניאון (Lightshow)
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              שליטה מלאה על תאורת ניאון זוהרת, דפוסי תנועה, אזורי הארה פיזיים וסינכרון חי לשירים המתנגנים בנגן שלך.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onSelectPreset(LightshowPresetId.Neon, true)}
              className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                isNeonActive
                  ? 'border-cyan-400 bg-gradient-to-l from-cyan-500/20 to-fuchsia-500/20 text-cyan-900 shadow-[0_0_18px_rgba(0,240,255,0.28)] dark:text-cyan-200'
                  : 'border-cyan-400/50 bg-cyan-50/50 text-cyan-800 hover:bg-cyan-100/60 dark:border-cyan-400/40 dark:bg-[#141B27] dark:text-cyan-300'
              }`}
            >
              <Sparkles className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />
              <span>תאורת ניאון יפה</span>
            </button>

            <button
              type="button"
              onClick={onResetLightshow}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>איפוס</span>
            </button>

            <button
              type="button"
              onClick={() => onUpdateLightshow({ enabled: !lightshow.enabled })}
              className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                lightshow.enabled
                  ? 'bg-[#D95B2B] text-white hover:bg-[#C24E22]'
                  : 'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
              }`}
            >
              <Power className="h-4 w-4" />
              <span>{lightshow.enabled ? 'תאורה דולקת' : 'הדלק תאורה'}</span>
            </button>
          </div>
        </div>

        {/* Beat Sync Toggle Row */}
        <div className="mt-6 flex flex-col gap-4 border-t border-slate-200/80 pt-5 dark:border-slate-700/60 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">
              סינכרון דינמי לשירים המתנגנים בנגן שלך (Beat-Sync)
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              מתאים אוטומטית את קצב הטבעות ומבזקי הניאון ברמקול לכל מכת בס ב-Spotify, YouTube Music או כל נגן פעיל — ללא העלאת שירים
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={lightshow.beatSync}
            onClick={() => onUpdateLightshow({ beatSync: !lightshow.beatSync })}
            className={`flex min-h-[40px] items-center gap-2.5 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lightshow.beatSync
                ? 'border-[#D95B2B]/60 bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                : 'border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-400'
            }`}
          >
            <Zap className="h-3.5 w-3.5 text-[#D95B2B]" />
            <span>{lightshow.beatSync ? 'מסונכרן לקצב: פעיל' : 'מסונכרן לקצב: כבוי'}</span>
          </button>
        </div>
      </section>

      {/* Section 2: 7 Lightshow Modes (Including Neon Glow!) */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              01. מצבי אפקט ותאורת ניאון
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              בחר את אופי הזרימה על פני שמיניית התאורה של ה-PartyBox 320
            </p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            פעיל כעת:{' '}
            <strong className="text-slate-900 dark:text-white">
              {LIGHTSHOW_PRESETS[lightshow.preset].title}
            </strong>
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presetEntries.map(([id, info]) => {
            const isSelected = lightshow.preset === id;
            const isNeonItem = id === LightshowPresetId.Neon;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectPreset(id, isNeonItem)}
                className={`group flex flex-col justify-between rounded-xl border p-4 text-right transition-all cursor-pointer ${
                  isSelected
                    ? isNeonItem
                      ? 'border-cyan-400 bg-gradient-to-l from-cyan-500/15 to-fuchsia-500/15 shadow-[0_0_16px_rgba(0,240,255,0.2)]'
                      : 'border-[#D95B2B] bg-[#D95B2B]/[0.07] dark:bg-[#D95B2B]/[0.12]'
                    : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/80 dark:border-slate-700 dark:bg-[#141B27] dark:hover:border-slate-600'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
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
                <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {info.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 3: Color Palette & Dual Gradient Customizer */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              02. פלטת צבעים ומיזוג גווני ניאון
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              שילוב דו-צבעי לטבעת העליונה והתחתונה או בחירה חופשית מתוך בורר הצבעים
            </p>
          </div>

          <button
            type="button"
            onClick={swapColors}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[#D95B2B]" />
            <span>החלף צבע ראשי ומשני</span>
          </button>
        </div>

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
                    enabled: true,
                    primaryColor: pair.primary,
                    secondaryColor: pair.secondary,
                  })
                }
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-right transition-colors cursor-pointer ${
                  active
                    ? 'border-[#D95B2B] bg-[#D95B2B]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0 rounded-full border border-slate-300 dark:border-white/20"
                  style={{
                    background: `linear-gradient(135deg, ${pair.primary}, ${pair.secondary})`,
                  }}
                />
                <span className="truncate text-xs font-medium">{pair.name}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 border-t border-slate-200/80 pt-5 dark:border-slate-700/60 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer dark:border-slate-700 dark:bg-[#141B27]">
            <div>
              <div className="text-xs font-medium text-slate-900 dark:text-white">
                גוון טבעת ראשי
              </div>
              <div
                className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums"
                dir="ltr"
              >
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

          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer dark:border-slate-700 dark:bg-[#141B27]">
            <div>
              <div className="text-xs font-medium text-slate-900 dark:text-white">
                גוון משני ומעברים
              </div>
              <div
                className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums"
                dir="ltr"
              >
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
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          03. עוצמה, מהירות ואזורי תאורה פיזיים
        </h3>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                <Sun className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>בהירות כללית</span>
              </span>
              <span
                className="font-mono text-slate-600 dark:text-slate-300 tabular-nums"
                dir="ltr"
              >
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

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                <Sparkles className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>מהירות תנועה</span>
              </span>
              <span
                className="font-mono text-slate-600 dark:text-slate-300 tabular-nums"
                dir="ltr"
              >
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

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                <Zap className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>תדירות מבזק סטרוב</span>
              </span>
              <span
                className="font-mono text-slate-600 dark:text-slate-300 tabular-nums"
                dir="ltr"
              >
                {lightshow.strobeIntensity}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={lightshow.strobeIntensity}
              onChange={(e) =>
                onUpdateLightshow({ strobeIntensity: Number(e.target.value) })
              }
              className="jbl-slider w-full"
            />
          </div>
        </div>

        <div className="mt-7 border-t border-slate-200/80 pt-6 dark:border-slate-700/60">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-900 dark:text-white">
              מיתוג אזורי תאורה בתיבת הרמקול
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSetAllZones(true)}
                className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                הדלק את כל האזורים
              </button>
              <button
                type="button"
                onClick={() => {
                  if (lightshow.zones.strobeTop) onToggleZone('strobeTop');
                  if (lightshow.zones.strobeBottom) onToggleZone('strobeBottom');
                }}
                className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                ללא סטרובים
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200/80 dark:divide-slate-700/60">
            {ZONE_ITEMS.map((z) => {
              const active = lightshow.zones[z.key];
              return (
                <div
                  key={z.key}
                  className="flex items-center justify-between gap-4 py-3.5 first:pt-1 last:pb-0"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {z.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {z.subtitle}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    onClick={() => onToggleZone(z.key)}
                    className={`min-h-[40px] min-w-[84px] rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#D95B2B] text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-400'
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
