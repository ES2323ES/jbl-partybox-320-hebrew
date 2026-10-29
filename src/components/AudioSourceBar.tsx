import React, { useRef } from 'react';
import { Mic, Music, Pause, Play, Upload, Volume2, VolumeX } from 'lucide-react';
import { DemoGrooveId } from '../types/speaker';

interface AudioSourceBarProps {
  isPlaying: boolean;
  sourceMode: 'groove' | 'file' | 'mic';
  currentGroove: DemoGrooveId;
  uploadedFileName: string | null;
  volume: number;
  muted: boolean;
  micError: string | null;
  onTogglePlay: () => void;
  onSelectGroove: (groove: DemoGrooveId) => void;
  onUploadFile: (file: File) => void;
  onStartMicSync: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

const GROOVE_OPTIONS: Array<{ id: DemoGrooveId; label: string }> = [
  { id: 'house_124', label: 'האוס מסיבות 124 BPM' },
  { id: 'mediterranean_112', label: 'גרוב ים-תיכוני 112 BPM' },
  { id: 'sub_tech_128', label: 'טכנו בס עמוק 128 BPM' },
  { id: 'bass_sweep', label: 'בדיקת סאב 38Hz–95Hz' },
];

export const AudioSourceBar: React.FC<AudioSourceBarProps> = ({
  isPlaying,
  sourceMode,
  currentGroove,
  uploadedFileName,
  volume,
  muted,
  micError,
  onTogglePlay,
  onSelectGroove,
  onUploadFile,
  onStartMicSync,
  onChangeVolume,
  onToggleMute,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadFile(file);
      e.target.value = '';
    }
  };

  return (
    <section
      aria-label="נגן שמע ובדיקת סאונד בזמן אמת"
      className="rounded-2xl border border-white/[0.08] bg-[#12161E] p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Left/Right in RTL: Play Button + Source Title + Groove Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#FF5500] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#E64D00] whitespace-nowrap shrink-0"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isPlaying ? 'השהה שמע חי' : 'הפעל מנוע שמע'}</span>
          </button>

          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-[#0B0D11] p-1 border border-white/[0.06]">
            {GROOVE_OPTIONS.map((g) => {
              const active = sourceMode === 'groove' && currentGroove === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelectGroove(g.id)}
                  className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white/[0.12] text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* External File Upload + Mic Beat Sync + Master Volume */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                sourceMode === 'file'
                  ? 'border-[#FF5500]/60 bg-[#FF5500]/15 text-white'
                  : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
              }`}
            >
              <Upload className="h-3.5 w-3.5 text-[#FF5500]" />
              <span className="max-w-[140px] truncate">
                {sourceMode === 'file' && uploadedFileName
                  ? uploadedFileName
                  : 'שיר מהמכשיר'}
              </span>
            </button>

            <button
              type="button"
              onClick={onStartMicSync}
              className={`flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                sourceMode === 'mic'
                  ? 'border-[#FF5500]/60 bg-[#FF5500]/15 text-white'
                  : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]'
              }`}
            >
              <Mic className="h-3.5 w-3.5 text-[#FF5500]" />
              <span>{sourceMode === 'mic' ? 'מאזין לקצב החדר' : 'סנכרון מיקרופון'}</span>
            </button>
          </div>

          {/* Master Volume Fader */}
          <div className="flex items-center gap-2.5 min-w-[180px]">
            <button
              type="button"
              onClick={onToggleMute}
              aria-label={muted ? 'ביטול השתקה' : 'השתקה'}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/[0.06]"
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4 text-rose-400" />
              ) : (
                <Volume2 className="h-4 w-4 text-slate-300" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => onChangeVolume(Number(e.target.value))}
              aria-label="עוצמת שמע ראשית"
              className="jbl-slider w-28 sm:w-32"
            />
            <span
              className="w-10 text-left font-mono text-xs font-medium text-slate-300 tabular-nums"
              dir="ltr"
            >
              {muted ? '0%' : `${volume}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Subtle status row without pills */}
      {(sourceMode === 'file' || sourceMode === 'mic' || micError) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-2.5 text-xs text-slate-400">
          <Music className="h-3.5 w-3.5 text-[#FF5500]" />
          {micError ? (
            <span className="text-amber-400">{micError}</span>
          ) : sourceMode === 'file' ? (
            <span>
              מנגן קובץ מקומי דרך מעבד ה-EQ והבס: <strong className="text-slate-200">{uploadedFileName}</strong>
            </span>
          ) : (
            <span>
              מצב סנכרון חדר פעיל — התאורה והספקטרום מגיבים למוזיקה החיה שנקלטת במיקרופון ללא השמעה חוזרת.
            </span>
          )}
        </div>
      )}
    </section>
  );
};
