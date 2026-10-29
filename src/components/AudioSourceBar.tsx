import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  MonitorSpeaker,
  Music2,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AudioSyncSourceMode, DemoGrooveId } from '../types/speaker';
import { audioEngine } from '../services/audioEngine';
import { bluetoothBridge } from '../services/bluetoothBridge';

interface AudioSourceBarProps {
  isPlaying: boolean;
  sourceMode: AudioSyncSourceMode;
  currentGroove: DemoGrooveId;
  volume: number;
  muted: boolean;
  syncNotice: string | null;
  onTogglePlay: () => void;
  onStartLivePlayerSync: () => void;
  onStartSystemAudioSync: () => void;
  onSelectGroove: (groove: DemoGrooveId) => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

const GROOVE_OPTIONS: Array<{ id: DemoGrooveId; label: string }> = [
  { id: 'house_124', label: 'האוס 124' },
  { id: 'mediterranean_112', label: 'ים-תיכוני 112' },
  { id: 'sub_tech_128', label: 'טכנו 128' },
  { id: 'bass_sweep', label: 'בדיקת סאב' },
];

export const AudioSourceBar: React.FC<AudioSourceBarProps> = ({
  isPlaying,
  sourceMode,
  currentGroove,
  volume,
  muted,
  syncNotice,
  onTogglePlay,
  onStartLivePlayerSync,
  onStartSystemAudioSync,
  onSelectGroove,
  onChangeVolume,
  onToggleMute,
}) => {
  const [showTestGrooves, setShowTestGrooves] = useState(sourceMode === 'groove');
  const [liveBpm, setLiveBpm] = useState<number>(0);
  const meterBarRef = useRef<HTMLDivElement | null>(null);
  const isAndroidApk = bluetoothBridge.isAndroidNativeBridgeAvailable();
  const canShareSystemAudio =
    !isAndroidApk &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getDisplayMedia);

  useEffect(() => {
    if (sourceMode === 'groove') {
      setShowTestGrooves(true);
    }
  }, [sourceMode]);

  // Smooth DOM-ref level meter + low-frequency BPM readout (zero layout shift, zero full-tree re-renders)
  useEffect(() => {
    let raf: number | null = null;
    let lastBpmUpdateMs = 0;

    const tick = (now: number) => {
      const frame = audioEngine.getAnalysisFrame();
      if (meterBarRef.current) {
        const energyPct = Math.min(
          100,
          Math.round((frame.subBassEnergy * 0.65 + frame.midEnergy * 0.45) * 115)
        );
        meterBarRef.current.style.transform = `scaleX(${Math.max(0.04, energyPct / 100)})`;
      }
      if (now - lastBpmUpdateMs > 750) {
        lastBpmUpdateMs = now;
        setLiveBpm((prev) =>
          prev === frame.detectedBpm ? prev : frame.detectedBpm
        );
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  const isPlayerSynced =
    (sourceMode === 'player_sync' || sourceMode === 'system_audio') && isPlaying;

  return (
    <section
      aria-label="סינכרון חי עם נגן המוזיקה ובקרת עוצמה ראשית"
      className="neon-surface gpu-stable rounded-2xl border border-slate-200/90 bg-white p-4 dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-5"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {/* Right Side: Zero-Upload Live Music Player Sync Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Primary Live External Player Sync Button */}
          <button
            type="button"
            onClick={onStartLivePlayerSync}
            className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sourceMode === 'player_sync' && isPlaying
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-[#D95B2B] text-white hover:bg-[#C24E22]'
            }`}
          >
            <Radio className="h-4 w-4 shrink-0" />
            <span>
              {sourceMode === 'player_sync' && isPlaying
                ? 'מסונכרן חי עם השירים בנגן'
                : 'סנכרן אוטומטית עם הנגן שלך'}
            </span>
          </button>

          {/* Direct System/Tab Audio Sync on Web Desktop (Spotify Web / YouTube without mic) */}
          {canShareSystemAudio && (
            <button
              type="button"
              onClick={onStartSystemAudioSync}
              className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceMode === 'system_audio' && isPlaying
                  ? 'border-sky-500 bg-sky-500/15 text-sky-900 dark:text-sky-200'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
              title="לכידה דיגיטלית ישירה של שירים המתנגנים ב-YouTube או ב-Spotify במחשב ללא מיקרופון וללא העלאת שירים"
            >
              <MonitorSpeaker className="h-4 w-4 text-sky-500 shrink-0" />
              <span>
                {sourceMode === 'system_audio' && isPlaying
                  ? 'שמע מערכת/נגן פעיל'
                  : 'סינכרון שמע מערכת / YouTube'}
              </span>
            </button>
          )}

          {/* External Player Media Transport (Controls Spotify / YouTube Music / System Player on Android!) */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200/90 bg-slate-50 p-1 dark:border-slate-700 dark:bg-[#141B27]">
            {isAndroidApk && (
              <button
                type="button"
                onClick={() => audioEngine.prevTrack()}
                aria-label="שיר קודם בנגן החיצוני"
                title="שיר קודם בנגן המוזיקה"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onTogglePlay}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-100 dark:bg-[#1E2738] dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap cursor-pointer"
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5 text-[#D95B2B]" />
              ) : (
                <Play className="h-3.5 w-3.5 text-[#D95B2B]" />
              )}
              <span>
                {isAndroidApk && sourceMode === 'player_sync'
                  ? 'נגן / השהה בנגן'
                  : isPlaying
                    ? 'עצור סינכרון'
                    : 'הפעל'}
              </span>
            </button>

            {isAndroidApk && (
              <button
                type="button"
                onClick={() => audioEngine.nextTrack()}
                aria-label="שיר הבא בנגן החיצוני"
                title="שיר הבא בנגן המוזיקה"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                <SkipBack className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Optional Built-in Bass Test Toggle (no file upload!) */}
          <button
            type="button"
            onClick={() => {
              const next = !showTestGrooves;
              setShowTestGrooves(next);
              if (next && sourceMode !== 'groove') {
                onSelectGroove(currentGroove);
              }
            }}
            className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              sourceMode === 'groove' && isPlaying
                ? 'border-[#D95B2B] bg-[#D95B2B]/10 text-[#B84318] dark:text-amber-200'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300'
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-[#D95B2B]" />
            <span>בדיקת סאב מובנית</span>
          </button>
        </div>

        {/* Left Side: Live Signal / BPM Meter + Master Volume Fader */}
        <div className="flex flex-wrap items-center justify-between gap-4 sm:justify-end">
          {/* Live Sync Level Bar + BPM Readout */}
          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2 dark:border-slate-700/70 dark:bg-[#141B27]">
            <Music2
              className={`h-3.5 w-3.5 shrink-0 ${
                isPlayerSynced
                  ? 'text-emerald-500'
                  : isPlaying
                    ? 'text-[#D95B2B]'
                    : 'text-slate-400'
              }`}
            />
            <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                ref={meterBarRef}
                className="h-full w-full origin-right rounded-full bg-gradient-to-l from-emerald-500 via-[#D95B2B] to-amber-400 will-change-transform"
                style={{ transform: 'scaleX(0.04)' }}
              />
            </div>
            <span
              className="w-16 text-left font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums"
              dir="ltr"
            >
              {liveBpm > 0 ? `${liveBpm} BPM` : isPlaying ? 'LIVE SYNC' : 'READY'}
            </span>
          </div>

          {/* Master Volume Fader */}
          <div className="flex items-center gap-2 min-w-[175px]">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'ביטול השתקה' : 'השתקה'}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4 text-rose-500" />
              ) : (
                <Volume2 className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              aria-label="עוצמת שמע ראשית"
              className="jbl-slider w-24 sm:w-28"
            />
            <span
              className="w-10 text-left font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums"
              dir="ltr"
            >
              {muted ? '0%' : `${volume}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Optional Studio Test Groove Strip (Only when user toggles built-in test) */}
      {showTestGrooves && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5 dark:border-slate-700/70 dark:bg-[#141B27]">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            אות בדיקה מובנה לכיול בס ואיקוולייזר (ללא צורך בנגן חיצוני):
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {GROOVE_OPTIONS.map((g) => {
              const active = sourceMode === 'groove' && currentGroove === g.id && isPlaying;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelectGroove(g.id)}
                  className={`min-h-[34px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#D95B2B] text-white'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Clean Live Sync Explanation Strip */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5 text-xs text-slate-600 dark:border-slate-700/60 dark:text-slate-400">
        <span>
          {syncNotice ? (
            <strong className="font-medium text-emerald-700 dark:text-emerald-300">
              {syncNotice}
            </strong>
          ) : (
            <>
              <strong className="text-slate-800 dark:text-slate-200">
                סינכרון אוטומטי מלא ללא העלאת שירים:
              </strong>{' '}
              הפעל כל שיר ב-<strong>Spotify</strong>, ב-<strong>YouTube Music</strong>, ב-<strong>Apple Music</strong> או בנגן המכשיר — התאורה והאיקוולייזר מסתנכרנים לשיר המתנגן בזמן אמת.
            </>
          )}
        </span>
      </div>
    </section>
  );
};
