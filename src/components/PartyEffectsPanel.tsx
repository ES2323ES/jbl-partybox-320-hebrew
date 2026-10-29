import React, { useEffect, useRef, useState } from 'react';
import {
  Disc3,
  Guitar,
  Mic,
  MicOff,
  Play,
  Radio,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import {
  AuracastMode,
  CustomSamplerSlot,
  DjPadEffectId,
  MicGuitarState,
} from '../types/speaker';
import { audioEngine } from '../services/audioEngine';

interface PartyEffectsPanelProps {
  micGuitar: MicGuitarState;
  auracastMode: AuracastMode;
  stereoChannel: 'L' | 'R';
  customSamples: CustomSamplerSlot[];
  onTriggerDjEffect: (effect: DjPadEffectId) => void;
  onUpdateMicGuitar: (patch: Partial<MicGuitarState>) => void;
  onResetMicGuitar: () => void;
  onChangeAuracast: (mode: AuracastMode, channel?: 'L' | 'R') => void;
  onSaveCustomSample: (slotIndex: number, dataUrl: string, durationSec: number) => void;
  onClearCustomSample: (slotIndex: number) => void;
}

const DJ_PADS: Array<{
  id: DjPadEffectId;
  title: string;
  subtitle: string;
  shortcut: string;
}> = [
  { id: 'airhorn', title: 'צופר אוויר (Airhorn)', subtitle: 'תרועת מועדונים קלאסית', shortcut: '1' },
  { id: 'bassdrop', title: 'דרופ סאב 808', subtitle: 'נפילת תדר עמוקה 150Hz→34Hz', shortcut: '2' },
  { id: 'laser', title: 'שיגור לייזר', subtitle: 'סוויפ סינתטי חד ומהיר', shortcut: '3' },
  { id: 'scratch', title: 'סקראץ׳ ויניל', subtitle: 'חיתוך פטיפון קצבי', shortcut: '4' },
  { id: 'applause', title: 'תשואות קהל', subtitle: 'מחיאות כפיים באצטדיון', shortcut: '5' },
  { id: 'siren', title: 'סירנת במה', subtitle: 'עליית מתח לפני פזמון', shortcut: '6' },
];

export const PartyEffectsPanel: React.FC<PartyEffectsPanelProps> = ({
  micGuitar,
  auracastMode,
  stereoChannel,
  customSamples,
  onTriggerDjEffect,
  onUpdateMicGuitar,
  onResetMicGuitar,
  onChangeAuracast,
  onSaveCustomSample,
  onClearCustomSample,
}) => {
  const [activePad, setActivePad] = useState<DjPadEffectId | null>(null);
  const [recordingSlot, setRecordingSlot] = useState<number | null>(null);
  const [samplerError, setSamplerError] = useState<string | null>(null);
  const [karaokeError, setKaraokeError] = useState<string | null>(null);
  const [voiceMeter, setVoiceMeter] = useState(0);
  const stopRecordingRef = useRef<(() => void) | null>(null);

  const firePad = (id: DjPadEffectId) => {
    setActivePad(id);
    onTriggerDjEffect(id);
    window.setTimeout(() => {
      setActivePad((curr) => (curr === id ? null : curr));
    }, 220);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const match = DJ_PADS.find((p) => p.shortcut === e.key);
      if (match) {
        firePad(match.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Poll live karaoke vocal level when active
  useEffect(() => {
    if (!micGuitar.liveKaraokeActive) {
      setVoiceMeter(0);
      return;
    }
    let raf: number | null = null;
    const tick = () => {
      const f = audioEngine.getAnalysisFrame();
      setVoiceMeter(f.karaokeVoiceLevel);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [micGuitar.liveKaraokeActive]);

  const handleToggleLiveKaraoke = async () => {
    setKaraokeError(null);
    const next = !micGuitar.liveKaraokeActive;
    const ok = await audioEngine.setLiveKaraokeEnabled(next, {
      volume: micGuitar.mic1Volume,
      bassDb: micGuitar.mic1Bass,
      trebleDb: micGuitar.mic1Treble,
      echoPercent: micGuitar.mic1Echo,
      vocalDucking: micGuitar.vocalDucking,
    });
    if (ok) {
      onUpdateMicGuitar({ liveKaraokeActive: next });
    } else {
      setKaraokeError(
        'לא ניתן להפעיל את המיקרופון כעת — אשר גישת מיקרופון במכשיר כדי לשיר או לכרוז בזמן אמת.'
      );
    }
  };

  const handleRecordSampleSlot = async (slotIndex: number) => {
    setSamplerError(null);
    if (recordingSlot === slotIndex) {
      stopRecordingRef.current?.();
      return;
    }
    if (recordingSlot !== null) return;

    try {
      setRecordingSlot(slotIndex);
      const session = await audioEngine.startSampleRecording(4);
      stopRecordingRef.current = session.stopEarly;
      const out = await session.result;
      onSaveCustomSample(slotIndex, out.dataUrl, out.durationSec);
    } catch {
      setSamplerError('גישה למיקרופון נדרשת להקלטת צליל אישי.');
    } finally {
      setRecordingSlot(null);
      stopRecordingRef.current = null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 1: 6 Built-in PartyPad DJ Sound Triggers + 4 Custom Recorded Voice Sampler Pads */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
            משטח אפקטי DJ חי + סמפלר הקלטות אישי
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            לחץ על כל משטח להשמעה מיידית עם הבזק תאורה, או הקלט עד 4 קריאות קהל אישיות משלך.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {DJ_PADS.map((pad) => {
            const isPressed = activePad === pad.id;
            return (
              <button
                key={pad.id}
                type="button"
                onClick={() => firePad(pad.id)}
                className={`flex min-h-[88px] flex-col justify-between rounded-xl border p-4 text-right transition-transform active:scale-[0.97] cursor-pointer ${
                  isPressed
                    ? 'border-[#D95B2B] bg-[#D95B2B]/15 text-slate-900 dark:text-white scale-[0.98]'
                    : 'border-slate-200 bg-slate-50/80 text-slate-900 hover:border-[#D95B2B]/50 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <Disc3 className="h-4 w-4 text-[#D95B2B]" />
                  <span
                    className="font-mono text-[11px] text-slate-400 tabular-nums"
                    dir="ltr"
                  >
                    [{pad.shortcut}]
                  </span>
                </div>
                <div className="mt-2">
                  <div className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    {pad.title}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {pad.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* 4 Personal Recorded Sampler Slots */}
        <div className="mt-6 border-t border-slate-200/80 pt-5 dark:border-slate-700/60">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                מקליט סמפלר אישי (4 כפתורים נשמרים במכשיר)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                הקלט עד 4 שניות לכל כפתור והפעל אותו בלחיצה במהלך המסיבה
              </p>
            </div>
          </div>

          {samplerError && (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
              {samplerError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {customSamples.map((slot) => {
              const isRec = recordingSlot === slot.slotIndex;
              const hasAudio = Boolean(slot.audioDataUrl);
              return (
                <div
                  key={slot.slotIndex}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-[#141B27]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      {slot.label}
                    </span>
                    {hasAudio && (
                      <span
                        className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums"
                        dir="ltr"
                      >
                        {slot.durationSec}s
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {hasAudio ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            slot.audioDataUrl &&
                            audioEngine.playCustomSampleDataUrl(slot.audioDataUrl)
                          }
                          className="flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#D95B2B] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#C24E22] cursor-pointer"
                        >
                          <Play className="h-3.5 w-3.5" />
                          <span>נגן</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onClearCustomSample(slot.slotIndex)}
                          aria-label={`מחק סמפל ${slot.label}`}
                          className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-rose-500 dark:border-slate-700 dark:bg-[#1E2738] cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRecordSampleSlot(slot.slotIndex)}
                        className={`flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                          isRec
                            ? 'border-rose-500 bg-rose-500 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200'
                        }`}
                      >
                        {isRec ? (
                          <>
                            <Square className="h-3 w-3" />
                            <span>עצור הקלטה...</span>
                          </>
                        ) : (
                          <>
                            <Mic className="h-3.5 w-3.5 text-[#D95B2B]" />
                            <span>הקלט (4 ש׳)</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 2: Live Phone Karaoke + Dual Mic & Guitar Rear Input Mixer */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              מצב קריוקי חי מהטלפון ומיקסר מיקרופון / גיטרה
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              שיר או כרוז ישירות דרך המיקרופון של הטלפון אל הרמקול עם הד אולפני והנמכת מוזיקה אוטומטית
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleToggleLiveKaraoke}
              className={`flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                micGuitar.liveKaraokeActive
                  ? 'bg-teal-600 text-white hover:bg-teal-700'
                  : 'bg-[#D95B2B] text-white hover:bg-[#C24E22]'
              }`}
            >
              {micGuitar.liveKaraokeActive ? (
                <>
                  <MicOff className="h-4 w-4" />
                  <span>כבה מיקרופון קריוקי חי</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  <span>הפעל מיקרופון קריוקי חי</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onResetMicGuitar}
              className="flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>איפוס</span>
            </button>
          </div>
        </div>

        {/* Live Vocal Level Bar */}
        {micGuitar.liveKaraokeActive && (
          <div className="mt-4 rounded-xl border border-teal-500/40 bg-teal-50/60 p-3.5 dark:bg-teal-950/25">
            <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-teal-900 dark:text-teal-200">
              <span>מיקרופון קריוקי חי פעיל — עוצמת קול בזמן אמת</span>
              <span className="font-mono tabular-nums" dir="ltr">
                {Math.round(voiceMeter * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div
                className="h-full rounded-full bg-teal-500 transition-all duration-75"
                style={{ width: `${Math.min(100, Math.round(voiceMeter * 100))}%` }}
              />
            </div>
          </div>
        )}

        {karaokeError && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{karaokeError}</p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Channel 1: Mic 1 + Vocal EQ + Karaoke Echo */}
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50 p-5 dark:border-slate-700/70 dark:bg-[#141B27]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-white">
                <Mic className="h-4 w-4 text-[#D95B2B]" />
                <span>ערוץ 1 — שירה, בס/טרבל ואפקט הד</span>
              </div>
              <span
                className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums"
                dir="ltr"
              >
                CH-1
              </span>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">עוצמת מיקרופון</span>
                  <span
                    className="font-mono text-slate-900 dark:text-slate-200 tabular-nums"
                    dir="ltr"
                  >
                    {micGuitar.mic1Volume}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={micGuitar.mic1Volume}
                  onChange={(e) =>
                    onUpdateMicGuitar({ mic1Volume: Number(e.target.value) })
                  }
                  className="jbl-slider w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">בס שירה</span>
                    <span
                      className="font-mono text-slate-900 dark:text-slate-200 tabular-nums"
                      dir="ltr"
                    >
                      {micGuitar.mic1Bass > 0
                        ? `+${micGuitar.mic1Bass} dB`
                        : `${micGuitar.mic1Bass} dB`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-6}
                    max={6}
                    step={1}
                    value={micGuitar.mic1Bass}
                    onChange={(e) =>
                      onUpdateMicGuitar({ mic1Bass: Number(e.target.value) })
                    }
                    className="jbl-slider w-full"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">טרבל שירה</span>
                    <span
                      className="font-mono text-slate-900 dark:text-slate-200 tabular-nums"
                      dir="ltr"
                    >
                      {micGuitar.mic1Treble > 0
                        ? `+${micGuitar.mic1Treble} dB`
                        : `${micGuitar.mic1Treble} dB`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-6}
                    max={6}
                    step={1}
                    value={micGuitar.mic1Treble}
                    onChange={(e) =>
                      onUpdateMicGuitar({ mic1Treble: Number(e.target.value) })
                    }
                    className="jbl-slider w-full"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    אפקט הד (Karaoke Echo)
                  </span>
                  <span
                    className="font-mono font-semibold text-[#D95B2B] tabular-nums"
                    dir="ltr"
                  >
                    {micGuitar.mic1Echo}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={micGuitar.mic1Echo}
                  onChange={(e) =>
                    onUpdateMicGuitar({ mic1Echo: Number(e.target.value) })
                  }
                  className="jbl-slider w-full"
                />
              </div>
            </div>
          </div>

          {/* Channel 2: Switchable Mic 2 / Guitar Preamp + Auto Voice Ducking */}
          <div className="space-y-4 rounded-xl border border-slate-200/80 bg-slate-50 p-5 dark:border-slate-700/70 dark:bg-[#141B27]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-slate-900 dark:text-white">
                {micGuitar.channel2Mode === 'guitar' ? (
                  <Guitar className="h-4 w-4 text-[#D95B2B]" />
                ) : (
                  <Mic className="h-4 w-4 text-[#D95B2B]" />
                )}
                <span>כניסה 2 — מיקרופון שני / גיטרה</span>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-[#1E2738]">
                <button
                  type="button"
                  onClick={() => onUpdateMicGuitar({ channel2Mode: 'mic' })}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    micGuitar.channel2Mode === 'mic'
                      ? 'bg-[#D95B2B] text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  מיקרופון 2
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateMicGuitar({ channel2Mode: 'guitar' })}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    micGuitar.channel2Mode === 'guitar'
                      ? 'bg-[#D95B2B] text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  גיטרה (Hi-Z)
                </button>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    {micGuitar.channel2Mode === 'guitar'
                      ? 'עוצמת ערוץ גיטרה'
                      : 'עוצמת מיקרופון 2'}
                  </span>
                  <span
                    className="font-mono text-slate-900 dark:text-slate-200 tabular-nums"
                    dir="ltr"
                  >
                    {micGuitar.channel2Volume}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={micGuitar.channel2Volume}
                  onChange={(e) =>
                    onUpdateMicGuitar({ channel2Volume: Number(e.target.value) })
                  }
                  className="jbl-slider w-full"
                />
              </div>

              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">
                    רגישות קדם-מגבר (Input Gain)
                  </span>
                  <span
                    className="font-mono text-slate-900 dark:text-slate-200 tabular-nums"
                    dir="ltr"
                  >
                    {micGuitar.channel2Gain}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={micGuitar.channel2Gain}
                  onChange={(e) =>
                    onUpdateMicGuitar({ channel2Gain: Number(e.target.value) })
                  }
                  className="jbl-slider w-full"
                />
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/80 pt-3 dark:border-slate-700/60">
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-white">
                    הנמכת מוזיקה אוטומטית בדיבור (Auto MC Ducking)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    מנמיך אוטומטית את המוזיקה ברגע שמזהים דיבור או שירה במיקרופון
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={micGuitar.vocalDucking}
                  onClick={() =>
                    onUpdateMicGuitar({ vocalDucking: !micGuitar.vocalDucking })
                  }
                  className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    micGuitar.vocalDucking
                      ? 'bg-[#D95B2B] text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-400'
                  }`}
                >
                  {micGuitar.vocalDucking ? 'פעיל' : 'כבוי'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: JBL Auracast™ Multi-Speaker & TWS Stereo Pairing */}
      <section className="neon-surface rounded-2xl border border-slate-200/90 bg-white p-6 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738]">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-[#D95B2B]" />
          <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            קישוריות JBL Auracast™ וזיווג רמקולים
          </h3>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          חיבור אלחוטי של שני רמקולי PartyBox Stage 320 לבמת סטריאו מלאה או שידור למספר רמקולים תומכי Auracast
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              mode: AuracastMode.Single,
              title: 'רמקול עצמאי (יחיד)',
              desc: 'ניגון סטריאו משולב מתיבה אחת ללא שידור חיצוני',
            },
            {
              mode: AuracastMode.Stereo,
              title: 'זוג סטריאו (TWS L/R)',
              desc: 'הפרדת ערוץ ימין ושמאל בין שני רמקולי Stage 320 זהים',
            },
            {
              mode: AuracastMode.PartyBroadcast,
              title: 'שידור מסיבה Auracast™',
              desc: 'סנכרון אודיו ותאורה עם רמקולי JBL נוספים בטווח הקליטה',
            },
          ].map((opt) => {
            const active = auracastMode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => onChangeAuracast(opt.mode)}
                className={`flex flex-col justify-between rounded-xl border p-4 text-right transition-colors cursor-pointer ${
                  active
                    ? 'border-[#D95B2B] bg-[#D95B2B]/[0.08] dark:bg-[#D95B2B]/[0.12]'
                    : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:hover:bg-slate-800'
                }`}
              >
                <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  {opt.title}
                </span>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{opt.desc}</p>
              </button>
            );
          })}
        </div>

        {auracastMode === AuracastMode.Stereo && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-[#141B27]">
            <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
              הקצאת ערוץ סטריאו לרמקול הנוכחי:
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChangeAuracast(AuracastMode.Stereo, 'R')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  stereoChannel === 'R'
                    ? 'bg-[#D95B2B] text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-300'
                }`}
              >
                ערוץ ימין (Right)
              </button>
              <button
                type="button"
                onClick={() => onChangeAuracast(AuracastMode.Stereo, 'L')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                  stereoChannel === 'L'
                    ? 'bg-[#D95B2B] text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-300'
                }`}
              >
                ערוץ שמאל (Left)
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
