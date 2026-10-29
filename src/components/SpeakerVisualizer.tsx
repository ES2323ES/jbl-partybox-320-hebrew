import React, { useEffect, useId, useRef, useState } from 'react';
import { Play, Pause, Sun, Volume2, VolumeX, Zap } from 'lucide-react';
import {
  BassBoostMode,
  LightZoneKey,
  LightshowPresetId,
  LightshowState,
} from '../types/speaker';
import { AudioAnalysisFrame, audioEngine } from '../services/audioEngine';

interface SpeakerVisualizerProps {
  lightshow: LightshowState;
  bassBoost: BassBoostMode;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  batteryPercent: number;
  playtimeBoost: boolean;
  onToggleLightshow: () => void;
  onCycleBassBoost: () => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onToggleZone: (zone: LightZoneKey) => void;
}

const STAR_COORDS = [
  { x: 96, y: 120, phase: 0.1 },
  { x: 204, y: 118, phase: 0.9 },
  { x: 78, y: 168, phase: 1.7 },
  { x: 222, y: 172, phase: 2.3 },
  { x: 84, y: 245, phase: 0.5 },
  { x: 216, y: 248, phase: 3.1 },
  { x: 92, y: 298, phase: 1.2 },
  { x: 208, y: 296, phase: 2.8 },
  { x: 78, y: 356, phase: 0.4 },
  { x: 222, y: 360, phase: 1.9 },
  { x: 95, y: 422, phase: 2.5 },
  { x: 205, y: 420, phase: 0.8 },
  { x: 126, y: 102, phase: 1.5 },
  { x: 174, y: 102, phase: 2.9 },
  { x: 124, y: 440, phase: 2.1 },
  { x: 176, y: 440, phase: 0.3 },
];

export const SpeakerVisualizer: React.FC<SpeakerVisualizerProps> = ({
  lightshow,
  bassBoost,
  isPlaying,
  volume,
  muted,
  batteryPercent,
  playtimeBoost,
  onToggleLightshow,
  onCycleBassBoost,
  onTogglePlay,
  onToggleMute,
  onToggleZone,
}) => {
  const uid = useId().replace(/:/g, '');
  const [phase, setPhase] = useState(0);
  const [frame, setFrame] = useState<AudioAnalysisFrame>({
    spectrum: new Array(28).fill(0.04),
    subBassEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    isBeat: false,
    djFlare: 0,
  });

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTimeRef.current) / 1000);
      lastTimeRef.current = now;

      const audioFrame = audioEngine.getAnalysisFrame();
      setFrame(audioFrame);

      const beatMultiplier =
        lightshow.beatSync && isPlaying ? 1 + audioFrame.subBassEnergy * 1.85 : 1;
      setPhase((prev) => (prev + dt * lightshow.speed * 115 * beatMultiplier) % 360);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [lightshow.speed, lightshow.beatSync, isPlaying]);

  const masterDim = lightshow.enabled ? lightshow.brightness / 100 : 0;
  const bassPulse = isPlaying || frame.djFlare > 0.05 ? frame.subBassEnergy : 0;
  const wooferScale = 1 + bassPulse * (bassBoost === BassBoostMode.Off ? 0.045 : 0.082);

  // Preset-driven ring & strobe visual dynamics
  const isFreeze = lightshow.preset === LightshowPresetId.Freeze;
  const isFlash = lightshow.preset === LightshowPresetId.Flash;
  const isRipple = lightshow.preset === LightshowPresetId.Ripple;
  const isCross = lightshow.preset === LightshowPresetId.Cross;
  const isRock = lightshow.preset === LightshowPresetId.Rock;

  const upperRingAngle = isFreeze ? 45 : phase;
  const lowerRingAngle = isFreeze
    ? 225
    : isCross
      ? (360 - phase) % 360
      : (phase + 140) % 360;

  const ringEnergyOpacity =
    !lightshow.enabled || !lightshow.zones.rings
      ? 0
      : isFreeze
        ? masterDim * 0.92
        : isRock
          ? masterDim * (0.55 + bassPulse * 0.45)
          : isFlash
            ? masterDim * (frame.isBeat || Math.sin((phase * Math.PI) / 45) > 0.35 ? 1 : 0.22)
            : masterDim * (0.72 + bassPulse * 0.28);

  const strobeTrigger =
    lightshow.enabled &&
    lightshow.strobeIntensity > 0 &&
    !isFreeze &&
    ((lightshow.beatSync && frame.isBeat) ||
      Math.sin((phase * Math.PI) / Math.max(12, 55 - lightshow.strobeIntensity * 0.4)) >
        0.76 - (isFlash ? 0.22 : 0));

  const strobeTopOpacity =
    strobeTrigger && lightshow.zones.strobeTop
      ? Math.min(1, masterDim * (0.45 + (lightshow.strobeIntensity / 100) * 0.55))
      : lightshow.enabled && lightshow.zones.strobeTop
        ? masterDim * 0.14
        : 0;

  const strobeBottomOpacity =
    strobeTrigger && lightshow.zones.strobeBottom
      ? Math.min(1, masterDim * (0.45 + (lightshow.strobeIntensity / 100) * 0.55))
      : lightshow.enabled && lightshow.zones.strobeBottom
        ? masterDim * 0.14
        : 0;

  const sideRailsOpacity =
    lightshow.enabled && lightshow.zones.sideRails
      ? masterDim * (isFreeze ? 0.8 : 0.5 + 0.45 * Math.abs(Math.sin((phase * Math.PI) / 180)))
      : 0;

  const bassBoostLabel =
    bassBoost === BassBoostMode.Deep
      ? 'בס עמוק'
      : bassBoost === BassBoostMode.Punchy
        ? 'בס הדוק'
        : 'בס רגיל';

  const zoneButtons: Array<{ key: LightZoneKey; label: string; active: boolean }> = [
    { key: 'rings', label: 'טבעות שמינייה', active: lightshow.zones.rings },
    { key: 'strobeTop', label: 'סטרוב עליון', active: lightshow.zones.strobeTop },
    { key: 'strobeBottom', label: 'סטרוב תחתון', active: lightshow.zones.strobeBottom },
    { key: 'starry', label: 'כוכבים', active: lightshow.zones.starry },
    { key: 'sideRails', label: 'פסי צד', active: lightshow.zones.sideRails },
  ];

  return (
    <div className="relative flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 transition-colors dark:border-slate-700/70 dark:bg-[#1E2738] sm:p-6">
      {/* Top Hardware Unit Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            תצוגת רמקול חיה — Stage 320
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums" dir="ltr">
              240W RMS
            </span>
            <span aria-hidden="true">·</span>
            <span>IPX4 עמיד במים</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              סוללה {batteryPercent}% ({playtimeBoost ? 'עד 18 ש׳' : 'עד 15 ש׳'})
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'ביטול השתקה' : 'השתקת רמקול'}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {muted ? (
            <VolumeX className="h-4 w-4 text-rose-500" />
          ) : (
            <Volume2 className="h-4 w-4 text-[#D95B2B]" />
          )}
          <span className="font-mono tabular-nums" dir="ltr">
            {muted ? 'MUTE' : `${volume}%`}
          </span>
        </button>
      </div>

      {/* Interactive SVG Speaker Hardware Canvas inside a soft acoustic backdrop */}
      <div className="relative my-4 flex flex-col items-center justify-center rounded-2xl bg-slate-100/85 py-4 select-none dark:bg-[#141B27]">
        {/* Soft floor ambient reflection */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-2 h-12 w-56 rounded-full blur-2xl transition-opacity duration-150"
          style={{
            background: `radial-gradient(ellipse at center, ${lightshow.primaryColor} 0%, ${lightshow.secondaryColor} 55%, transparent 80%)`,
            opacity: lightshow.enabled ? masterDim * (0.28 + bassPulse * 0.35) : 0,
          }}
        />

        <svg
          viewBox="0 0 300 520"
          className="relative z-10 h-[350px] w-auto sm:h-[395px] drop-shadow-[0_18px_28px_rgba(15,23,42,0.28)]"
          role="img"
          aria-label="הדמיה אינטראקטיבית של רמקול JBL PartyBox Stage 320"
        >
          <defs>
            <linearGradient
              id={`upperRing-${uid}`}
              gradientTransform={`rotate(${upperRingAngle} 0.5 0.5)`}
            >
              <stop offset="0%" stopColor={lightshow.primaryColor} />
              <stop offset="55%" stopColor={lightshow.secondaryColor} />
              <stop offset="100%" stopColor={lightshow.primaryColor} />
            </linearGradient>

            <linearGradient
              id={`lowerRing-${uid}`}
              gradientTransform={`rotate(${lowerRingAngle} 0.5 0.5)`}
            >
              <stop offset="0%" stopColor={lightshow.secondaryColor} />
              <stop offset="50%" stopColor={lightshow.primaryColor} />
              <stop offset="100%" stopColor={lightshow.secondaryColor} />
            </linearGradient>

            <linearGradient id={`cabinetGrad-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2D3545" />
              <stop offset="45%" stopColor="#1E2532" />
              <stop offset="100%" stopColor="#141923" />
            </linearGradient>

            <radialGradient id={`grilleGrad-${uid}`} cx="50%" cy="48%" r="60%">
              <stop offset="0%" stopColor="#212836" />
              <stop offset="100%" stopColor="#121720" />
            </radialGradient>

            <filter id={`neonGlow-${uid}`} x="-35%" y="-35%" width="170%" height="170%">
              <feGaussianBlur stdDeviation="4.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Telescopic Handle Silhouette */}
          <path
            d="M 102 28 L 102 18 Q 102 10 112 10 L 188 10 Q 198 10 198 18 L 198 28"
            fill="none"
            stroke="#3B4559"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <rect x="122" y="7" width="56" height="6" rx="3" fill="#D95B2B" opacity="0.9" />

          {/* Main Rugged Enclosure */}
          <rect
            x="44"
            y="26"
            width="212"
            height="462"
            rx="38"
            fill={`url(#cabinetGrad-${uid})`}
            stroke="#3E485C"
            strokeWidth="2"
          />

          {/* Top Control Deck Bezel */}
          <path
            d="M 74 30 L 226 30 Q 242 30 245 48 L 55 48 Q 58 30 74 30 Z"
            fill="#1A202C"
            stroke="#323B4C"
            strokeWidth="1"
          />
          {/* Battery 5-segment hardware bar on top deck */}
          {[0, 1, 2, 3, 4].map((seg) => {
            const threshold = (seg + 1) * 20;
            const lit = batteryPercent >= threshold - 10;
            return (
              <rect
                key={seg}
                x={132 + seg * 8}
                y={37}
                width="5"
                height="4"
                rx="1"
                fill={lit ? (playtimeBoost ? '#F59E0B' : '#F8FAFC') : '#333C4D'}
              />
            );
          })}

          {/* Inner Acoustic Mesh Grille */}
          <rect
            x="56"
            y="54"
            width="188"
            height="418"
            rx="30"
            fill={`url(#grilleGrad-${uid})`}
            stroke="#293142"
            strokeWidth="1.5"
          />

          {/* Side Light Rails (Clickable Zone) */}
          <g
            onClick={() => onToggleZone('sideRails')}
            className="cursor-pointer"
          >
            <line
              x1="63"
              y1="112"
              x2="63"
              y2="412"
              stroke={`url(#upperRing-${uid})`}
              strokeWidth="4.5"
              strokeLinecap="round"
              opacity={sideRailsOpacity}
              filter={`url(#neonGlow-${uid})`}
            />
            <line
              x1="237"
              y1="112"
              x2="237"
              y2="412"
              stroke={`url(#lowerRing-${uid})`}
              strokeWidth="4.5"
              strokeLinecap="round"
              opacity={sideRailsOpacity}
              filter={`url(#neonGlow-${uid})`}
            />
          </g>

          {/* Upper Strobe Bar (Clickable Zone) */}
          <g onClick={() => onToggleZone('strobeTop')} className="cursor-pointer">
            <rect x="108" y="68" width="84" height="8" rx="4" fill="#252C3B" />
            <rect
              x="110"
              y="69"
              width="80"
              height="6"
              rx="3"
              fill="#FFFFFF"
              opacity={strobeTopOpacity}
              filter={`url(#neonGlow-${uid})`}
            />
          </g>

          {/* Dual 25mm Dome Tweeters */}
          <g>
            <circle cx="94" cy="94" r="15" fill="#1B212E" stroke="#31394B" strokeWidth="1.5" />
            <circle cx="94" cy="94" r="7" fill="#2A3242" />
            <circle cx="206" cy="94" r="15" fill="#1B212E" stroke="#31394B" strokeWidth="1.5" />
            <circle cx="206" cy="94" r="7" fill="#2A3242" />
          </g>

          {/* Starry Night Constellation LEDs (Clickable Zone) */}
          <g onClick={() => onToggleZone('starry')} className="cursor-pointer">
            {STAR_COORDS.map((star, idx) => {
              const twinkle = isFreeze
                ? 0.75
                : 0.25 + 0.75 * Math.max(0, Math.sin((phase * Math.PI) / 65 + star.phase * 3));
              const starOpacity =
                lightshow.enabled && lightshow.zones.starry
                  ? masterDim * twinkle * (0.65 + frame.highEnergy * 0.5)
                  : 0.08;
              return (
                <circle
                  key={idx}
                  cx={star.x}
                  cy={star.y}
                  r={lightshow.enabled && lightshow.zones.starry ? 2.3 : 1.5}
                  fill={idx % 3 === 0 ? '#FFFFFF' : lightshow.secondaryColor}
                  opacity={Math.min(1, starOpacity)}
                />
              );
            })}
          </g>

          {/* Figure-8 Light Rings Around Dual 6.5" Woofers (Clickable Zone) */}
          <g onClick={() => onToggleZone('rings')} className="cursor-pointer">
            <circle cx="150" cy="184" r="66" fill="none" stroke="#252C3B" strokeWidth="10" />
            <circle cx="150" cy="342" r="66" fill="none" stroke="#252C3B" strokeWidth="10" />

            <circle
              cx="150"
              cy="184"
              r="66"
              fill="none"
              stroke={`url(#upperRing-${uid})`}
              strokeWidth="10"
              strokeDasharray={isRipple ? '48 16' : isRock ? '90 14' : undefined}
              strokeDashoffset={isRipple ? -phase * 1.6 : 0}
              strokeLinecap="round"
              opacity={ringEnergyOpacity}
              filter={`url(#neonGlow-${uid})`}
            />

            <circle
              cx="150"
              cy="342"
              r="66"
              fill="none"
              stroke={`url(#lowerRing-${uid})`}
              strokeWidth="10"
              strokeDasharray={isRipple ? '48 16' : isRock ? '90 14' : undefined}
              strokeDashoffset={isRipple ? phase * 1.6 : 0}
              strokeLinecap="round"
              opacity={ringEnergyOpacity}
              filter={`url(#neonGlow-${uid})`}
            />

            {isRipple && lightshow.enabled && lightshow.zones.rings && (
              <>
                <circle
                  cx="150"
                  cy="184"
                  r={52 + ((phase % 90) / 90) * 24}
                  fill="none"
                  stroke={lightshow.primaryColor}
                  strokeWidth="2.5"
                  opacity={masterDim * (1 - (phase % 90) / 90) * 0.85}
                />
                <circle
                  cx="150"
                  cy="342"
                  r={52 + ((phase % 90) / 90) * 24}
                  fill="none"
                  stroke={lightshow.secondaryColor}
                  strokeWidth="2.5"
                  opacity={masterDim * (1 - (phase % 90) / 90) * 0.85}
                />
              </>
            )}
          </g>

          {/* Upper 6.5" High-Sensitivity Woofer Cone */}
          <g
            style={{
              transform: `scale(${wooferScale})`,
              transformOrigin: '150px 184px',
              transition: 'transform 55ms linear',
            }}
          >
            <circle cx="150" cy="184" r="56" fill="#171C27" stroke="#31394B" strokeWidth="3" />
            <circle cx="150" cy="184" r="44" fill="#1E2534" stroke="#2B3345" strokeWidth="1.5" />
            <circle cx="150" cy="184" r="20" fill="#283042" stroke="#3D465A" strokeWidth="1.5" />
          </g>

          {/* Lower 6.5" High-Sensitivity Woofer Cone */}
          <g
            style={{
              transform: `scale(${wooferScale})`,
              transformOrigin: '150px 342px',
              transition: 'transform 55ms linear',
            }}
          >
            <circle cx="150" cy="342" r="56" fill="#171C27" stroke="#31394B" strokeWidth="3" />
            <circle cx="150" cy="342" r="44" fill="#1E2534" stroke="#2B3345" strokeWidth="1.5" />
            <circle cx="150" cy="342" r="20" fill="#283042" stroke="#3D465A" strokeWidth="1.5" />
          </g>

          {/* Center JBL Metallic Badgeplate */}
          <g>
            <rect
              x="127"
              y="249"
              width="46"
              height="28"
              rx="6"
              fill="#D95B2B"
              stroke="#EC7A4E"
              strokeWidth="1"
            />
            <text
              x="150"
              y="268"
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize="14"
              fontWeight="700"
              fontFamily="Rubik, sans-serif"
              letterSpacing="1"
            >
              JBL
            </text>
          </g>

          {/* Lower Strobe Bar (Clickable Zone) */}
          <g onClick={() => onToggleZone('strobeBottom')} className="cursor-pointer">
            <rect x="108" y="446" width="84" height="8" rx="4" fill="#252C3B" />
            <rect
              x="110"
              y="447"
              width="80"
              height="6"
              rx="3"
              fill="#FFFFFF"
              opacity={strobeBottomOpacity}
              filter={`url(#neonGlow-${uid})`}
            />
          </g>

          {/* Rugged Wide Feet */}
          <path d="M 68 488 L 98 488 L 94 500 L 72 500 Z" fill="#232A38" />
          <path d="M 202 488 L 232 488 L 228 500 L 206 500 Z" fill="#232A38" />
          <rect x="115" y="489" width="70" height="5" rx="2.5" fill="#D95B2B" opacity="0.75" />
        </svg>
      </div>

      {/* Physical Top-Deck Quick Hardware Controls */}
      <div className="space-y-3 border-t border-slate-200/80 pt-4 dark:border-slate-700/70">
        <div className="grid grid-cols-3 gap-2.5">
          <button
            type="button"
            onClick={onTogglePlay}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isPlaying
                ? 'bg-[#D95B2B] text-white'
                : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>{isPlaying ? 'עצור שמע' : 'נגן בדיקה'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleLightshow}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              lightshow.enabled
                ? 'border border-[#D95B2B]/50 bg-[#D95B2B]/10 text-[#B84318] dark:text-amber-200'
                : 'border border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-400'
            }`}
          >
            <Sun className="h-4 w-4 text-[#D95B2B]" />
            <span>{lightshow.enabled ? 'תאורה פעילה' : 'תאורה כבויה'}</span>
          </button>

          <button
            type="button"
            onClick={onCycleBassBoost}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              bassBoost !== BassBoostMode.Off
                ? 'border border-[#D95B2B]/50 bg-[#D95B2B]/10 text-[#B84318] dark:text-amber-200'
                : 'border border-slate-200 bg-slate-50 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-[#151C28] dark:text-slate-400'
            }`}
          >
            <Zap className="h-4 w-4 text-[#D95B2B]" />
            <span>{bassBoostLabel}</span>
          </button>
        </div>

        {/* Direct Interactive Light Zone Toggles */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>אזורי תאורה פעילים (לחיצה לכיבוי/הדלקה ישירה)</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {Object.values(lightshow.zones).filter(Boolean).length}/5
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {zoneButtons.map((z) => (
              <button
                key={z.key}
                type="button"
                onClick={() => onToggleZone(z.key)}
                className={`min-h-[40px] rounded-lg px-1.5 py-1.5 text-[11px] font-medium transition-colors truncate cursor-pointer ${
                  z.active && lightshow.enabled
                    ? 'border border-[#D95B2B]/40 bg-[#D95B2B]/10 text-[#B84318] dark:border-slate-600 dark:bg-slate-700/70 dark:text-white'
                    : 'border border-slate-200/80 bg-slate-50 text-slate-400 hover:text-slate-700 dark:border-slate-800 dark:bg-[#151C28] dark:text-slate-500 dark:hover:text-slate-300'
                }`}
                title={z.label}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
