import React, { useEffect, useRef, useState } from 'react';
import {
  ListMusic,
  Mic,
  Music,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DemoGrooveId, PlaylistTrack } from '../types/speaker';
import { audioEngine } from '../services/audioEngine';

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
  onUploadFiles: (files: File[]) => void;
  onStartMicSync: () => void;
  onChangeVolume: (vol: number) => void;
  onToggleMute: () => void;
}

const GROOVE_OPTIONS: Array<{ id: DemoGrooveId; label: string }> = [
  { id: 'house_124', label: 'האוס מסיבות 124' },
  { id: 'mediterranean_112', label: 'ים-תיכוני 112' },
  { id: 'sub_tech_128', label: 'טכנו בס 128' },
  { id: 'bass_sweep', label: 'בדיקת סאב' },
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
  onUploadFiles,
  onStartMicSync,
  onChangeVolume,
  onToggleMute,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistTrack[]>([]);
  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [crossfade, setCrossfade] = useState(true);
  const [showQueue, setShowQueue] = useState(false);

  useEffect(() => {
    const sync = () => {
      const st = audioEngine.getSourceState();
      setPlaylist(st.playlist);
      setPlaylistIndex(st.playlistIndex);
      setCrossfade(st.crossfadeEnabled);
    };
    sync();
    return audioEngine.onPlaylistChange(sync);
  }, [uploadedFileName, sourceMode]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      onUploadFiles(files);
      setShowQueue(files.length > 1);
      e.target.value = '';
    }
  };

  const toggleCrossfade = () => {
    const next = !crossfade;
    audioEngine.setCrossfadeEnabled(next);
    setCrossfade(next);
  };

  return (
    <section
      aria-label="נגן שמע, רשימת השמעה ובדיקת סאונד בזמן אמת"
      className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-4 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Play/Skip Controls + Groove Selector */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            {playlist.length > 1 && sourceMode === 'file' && (
              <button
                type="button"
                onClick={() => audioEngine.prevTrack()}
                aria-label="שיר קודם"
                className="flex h-[44px] w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
              >
                <SkipForward className="h-4 w-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onTogglePlay}
              className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#C24E22] whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>{isPlaying ? 'השהה שמע' : 'הפעל מנוע שמע'}</span>
            </button>

            {playlist.length > 1 && sourceMode === 'file' && (
              <button
                type="button"
                onClick={() => audioEngine.nextTrack()}
                aria-label="מעבר חלק לשיר הבא"
                className="flex h-[44px] w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 cursor-pointer"
              >
                <SkipBack className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-700/70 dark:bg-[#141B27]">
            {GROOVE_OPTIONS.map((g) => {
              const active = sourceMode === 'groove' && currentGroove === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onSelectGroove(g.id)}
                  className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Playlist Upload + Crossfade + Mic Sync + Master Volume */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceMode === 'file'
                  ? 'border-[#D95B2B]/60 bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Upload className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span className="max-w-[130px] truncate">
                {playlist.length > 1
                  ? `פלייליסט (${playlist.length} שירים)`
                  : sourceMode === 'file' && uploadedFileName
                    ? uploadedFileName
                    : 'טען שירים מהטלפון'}
              </span>
            </button>

            {playlist.length > 0 && (
              <button
                type="button"
                onClick={() => setShowQueue((v) => !v)}
                className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 cursor-pointer whitespace-nowrap"
              >
                <ListMusic className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>רשימה ({playlist.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onStartMicSync}
              className={`flex min-h-[42px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                sourceMode === 'mic'
                  ? 'border-[#D95B2B]/60 bg-[#D95B2B]/10 text-[#B84318] dark:text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Mic className="h-3.5 w-3.5 text-[#D95B2B]" />
              <span>{sourceMode === 'mic' ? 'מאזין לקצב החדר' : 'סנכרון תאורה לחדר'}</span>
            </button>
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
              className="w-10 text-left font-mono text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums"
              dir="ltr"
            >
              {muted ? '0%' : `${volume}%`}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Multi-Track Playlist & Crossfade Strip */}
      {showQueue && playlist.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-200/80 bg-slate-50 p-3.5 dark:border-slate-700/70 dark:bg-[#141B27]">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              נגן רשימת השמעה מקומית ({playlist.length} רצועות)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleCrossfade}
                className={`flex min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  crossfade
                    ? 'bg-[#D95B2B] text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-300'
                }`}
              >
                <Shuffle className="h-3 w-3" />
                <span>מעבר חלק בין שירים: {crossfade ? 'פעיל (3 ש׳)' : 'כבוי'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  audioEngine.clearPlaylist();
                  setShowQueue(false);
                }}
                className="flex min-h-[34px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:text-rose-600 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-300 cursor-pointer"
              >
                <Trash2 className="h-3 w-3" />
                <span>נקה</span>
              </button>
            </div>
          </div>

          <div className="max-h-36 space-y-1 overflow-y-auto">
            {playlist.map((trk, idx) => {
              const active = sourceMode === 'file' && playlistIndex === idx;
              return (
                <button
                  key={trk.id}
                  type="button"
                  onClick={() => audioEngine.playPlaylistTrack(idx)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-right text-xs transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#D95B2B]/12 font-semibold text-[#B84318] dark:text-amber-200'
                      : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <span className="truncate">
                    {idx + 1}. {trk.name}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                    {active ? 'מתנגן כעת' : 'נגן'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Status Row */}
      {(sourceMode === 'file' || sourceMode === 'mic' || micError) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5 text-xs text-slate-600 dark:border-slate-700/60 dark:text-slate-400">
          <Music className="h-3.5 w-3.5 text-[#D95B2B]" />
          {micError ? (
            <span className="text-amber-700 dark:text-amber-300">{micError}</span>
          ) : sourceMode === 'file' ? (
            <span>
              מנגן דרך מעבד הסאונד של הרמקול:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {uploadedFileName}
              </strong>
              {playlist.length > 1 && crossfade ? ' · מעבר חלק בין שירים פעיל' : ''}
            </span>
          ) : (
            <span>
              סנכרון תאורה חי פעיל — המיקרופון מזהה את קצב התופים והבס בחדר ומפעיל את תאורת הרמקול בזמן אמת (גם מאפליקציות חיצוניות).
            </span>
          )}
        </div>
      )}
    </section>
  );
};
