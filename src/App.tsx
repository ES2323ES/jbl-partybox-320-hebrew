/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Disc3, Download, LayoutGrid, Sliders, Sun, WifiOff } from 'lucide-react';
import {
  AcousticEnvironment,
  AuracastMode,
  BUILTIN_EQ_PRESETS,
  BassBoostMode,
  DemoGrooveId,
  DjPadEffectId,
  EqPresetId,
  EqualizerState,
  LIGHTSHOW_PRESETS,
  LightZoneKey,
  LightshowPresetId,
  LightshowState,
  MicGuitarState,
  NavTab,
  SavedEqProfile,
  SpeakerSystemState,
} from './types/speaker';
import { audioEngine } from './services/audioEngine';
import { SpeakerVisualizer } from './components/SpeakerVisualizer';
import { AudioSourceBar } from './components/AudioSourceBar';
import { OverviewPanel } from './components/OverviewPanel';
import { LightshowPanel } from './components/LightshowPanel';
import { EqualizerPanel } from './components/EqualizerPanel';
import { PartyEffectsPanel } from './components/PartyEffectsPanel';
import { ApkDownloadPanel } from './components/ApkDownloadPanel';
import { ConnectionModal } from './components/ConnectionModal';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import {
  ZIP_FILE_NAME,
  triggerVerifiedZipDownload,
} from './services/apkDownloader';

const STORAGE_KEY_STATE = 'jbl_pb320_he_state_v1';
const STORAGE_KEY_PROFILES = 'jbl_pb320_he_profiles_v1';

const DEFAULT_LIGHTSHOW: LightshowState = {
  enabled: true,
  preset: LightshowPresetId.Rock,
  primaryColor: '#FF5500',
  secondaryColor: '#FFB800',
  brightness: 85,
  speed: 1.1,
  strobeIntensity: 45,
  beatSync: true,
  zones: {
    rings: true,
    strobeTop: true,
    strobeBottom: true,
    starry: true,
    sideRails: true,
  },
};

const DEFAULT_EQ: EqualizerState = {
  preset: EqPresetId.JblSignature,
  activeCustomId: null,
  gains: [...BUILTIN_EQ_PRESETS[EqPresetId.JblSignature].gains],
  bassBoost: BassBoostMode.Deep,
  aiSoundBoost: true,
  environment: AcousticEnvironment.Indoor,
};

const DEFAULT_MIC_GUITAR: MicGuitarState = {
  mic1Connected: true,
  mic1Volume: 65,
  mic1Bass: 1,
  mic1Treble: 2,
  mic1Echo: 35,
  channel2Mode: 'guitar',
  channel2Volume: 60,
  channel2Gain: 50,
  vocalDucking: false,
};

const DEFAULT_SYSTEM: SpeakerSystemState = {
  deviceName: 'JBL PartyBox Stage 320',
  connectionType: 'demo',
  bleDeviceTitle: null,
  volume: 74,
  muted: false,
  batteryPercent: 86,
  playtimeBoost: false,
  auracastMode: AuracastMode.Single,
  stereoChannel: 'R',
};

const INITIAL_SAVED_PROFILES: SavedEqProfile[] = [
  {
    id: 'preset_rooftop_he',
    name: 'מסיבת גג ערב',
    gains: [6.0, 4.5, 1.0, 0.0, 2.0, 3.5, 4.5],
    createdAt: '2026-10-01',
  },
  {
    id: 'preset_acoustic_live',
    name: 'גיטרה ושירה חיה',
    gains: [1.5, 1.0, -1.0, 2.5, 4.0, 3.5, 2.5],
    createdAt: '2026-10-12',
  },
];

export default function App() {
  const { isNativeApk, isInstalled, isInstallable, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    typeof window !== 'undefined' &&
    (window.navigator.userAgent.includes('JBLPartyBox320AndroidAPK') ||
      window.location.protocol === 'file:')
      ? NavTab.Overview
      : NavTab.ApkDownload
  );
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [heroDownloading, setHeroDownloading] = useState(false);
  const [heroDownloadDone, setHeroDownloadDone] = useState(false);
  const isOnline = useOnlineStatus();

  // Persisted Hardware States
  const [lightshow, setLightshow] = useState<LightshowState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.lightshow) return { ...DEFAULT_LIGHTSHOW, ...parsed.lightshow };
      }
    } catch {
      // ignore
    }
    return DEFAULT_LIGHTSHOW;
  });

  const [eq, setEq] = useState<EqualizerState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.eq) return { ...DEFAULT_EQ, ...parsed.eq };
      }
    } catch {
      // ignore
    }
    return DEFAULT_EQ;
  });

  const [micGuitar, setMicGuitar] = useState<MicGuitarState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.micGuitar) return { ...DEFAULT_MIC_GUITAR, ...parsed.micGuitar };
      }
    } catch {
      // ignore
    }
    return DEFAULT_MIC_GUITAR;
  });

  const [system, setSystem] = useState<SpeakerSystemState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.system) return { ...DEFAULT_SYSTEM, ...parsed.system };
      }
    } catch {
      // ignore
    }
    return DEFAULT_SYSTEM;
  });

  const [savedProfiles, setSavedProfiles] = useState<SavedEqProfile[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_SAVED_PROFILES;
  });

  // Live Audio Source Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceMode, setSourceMode] = useState<'groove' | 'file' | 'mic'>('groove');
  const [currentGroove, setCurrentGroove] = useState<DemoGrooveId>('house_124');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  // Sync state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_STATE,
        JSON.stringify({ lightshow, eq, micGuitar, system })
      );
    } catch {
      // ignore quota errors
    }
  }, [lightshow, eq, micGuitar, system]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(savedProfiles));
    } catch {
      // ignore
    }
  }, [savedProfiles]);

  // Sync DSP Engine on every parameter change
  useEffect(() => {
    audioEngine.setEqGains(eq.gains);
  }, [eq.gains]);

  useEffect(() => {
    audioEngine.setBassBoost(eq.bassBoost);
  }, [eq.bassBoost]);

  useEffect(() => {
    audioEngine.setEnvironment(eq.environment);
  }, [eq.environment]);

  useEffect(() => {
    audioEngine.setAiSoundBoost(eq.aiSoundBoost);
  }, [eq.aiSoundBoost]);

  useEffect(() => {
    audioEngine.setPlaytimeBoost(system.playtimeBoost);
  }, [system.playtimeBoost]);

  useEffect(() => {
    const duckFactor = micGuitar.vocalDucking ? 0.65 : 1;
    audioEngine.setVolume(Math.round(system.volume * duckFactor), system.muted);
  }, [system.volume, system.muted, micGuitar.vocalDucking]);

  // --- Audio Transport Handlers ---

  const handleTogglePlay = useCallback(() => {
    setMicError(null);
    const playing = audioEngine.togglePlay();
    const st = audioEngine.getSourceState();
    setIsPlaying(playing);
    setSourceMode(st.sourceMode);
  }, []);

  const handleSelectGroove = useCallback((groove: DemoGrooveId) => {
    setMicError(null);
    audioEngine.startGroove(groove);
    setCurrentGroove(groove);
    setSourceMode('groove');
    setIsPlaying(true);
  }, []);

  const handleUploadFile = useCallback(async (file: File) => {
    setMicError(null);
    try {
      const name = await audioEngine.loadAudioFile(file);
      setUploadedFileName(name);
      setSourceMode('file');
      setIsPlaying(true);
    } catch {
      setMicError('לא ניתן היה לטעון את קובץ השמע שנבחר.');
    }
  }, []);

  const handleStartMicSync = useCallback(async () => {
    setMicError(null);
    if (sourceMode === 'mic' && isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
      setSourceMode('groove');
      return;
    }
    const ok = await audioEngine.startMicBeatSync();
    if (ok) {
      setSourceMode('mic');
      setIsPlaying(true);
    } else {
      setMicError('הגישה למיקרופון נדחתה או אינה זמינה — ניתן לנגן מקצב מובנה או להעלות שיר.');
    }
  }, [sourceMode, isPlaying]);

  // --- Lightshow Handlers ---

  const handleUpdateLightshow = useCallback((patch: Partial<LightshowState>) => {
    setLightshow((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectLightPreset = useCallback(
    (preset: LightshowPresetId, applyDefaultColors = true) => {
      const meta = LIGHTSHOW_PRESETS[preset];
      setLightshow((prev) => ({
        ...prev,
        enabled: true,
        preset,
        ...(applyDefaultColors
          ? {
              primaryColor: meta.defaultPrimary,
              secondaryColor: meta.defaultSecondary,
            }
          : {}),
      }));
    },
    []
  );

  const handleToggleZone = useCallback((zone: LightZoneKey) => {
    setLightshow((prev) => ({
      ...prev,
      zones: {
        ...prev.zones,
        [zone]: !prev.zones[zone],
      },
    }));
  }, []);

  const handleSetAllZones = useCallback((active: boolean) => {
    setLightshow((prev) => ({
      ...prev,
      enabled: active ? true : prev.enabled,
      zones: {
        rings: active,
        strobeTop: active,
        strobeBottom: active,
        starry: active,
        sideRails: active,
      },
    }));
  }, []);

  // --- Equalizer Handlers ---

  const handleChangeBandGain = useCallback((index: number, db: number) => {
    setEq((prev) => {
      const nextGains = [...prev.gains];
      nextGains[index] = db;
      return {
        ...prev,
        preset: EqPresetId.Custom,
        activeCustomId: null,
        gains: nextGains,
      };
    });
  }, []);

  const handleSelectEqPreset = useCallback(
    (preset: Exclude<EqPresetId, EqPresetId.Custom>) => {
      setEq((prev) => ({
        ...prev,
        preset,
        activeCustomId: null,
        gains: [...BUILTIN_EQ_PRESETS[preset].gains],
      }));
    },
    []
  );

  const handleCycleBassBoost = useCallback(() => {
    setEq((prev) => {
      const next =
        prev.bassBoost === BassBoostMode.Off
          ? BassBoostMode.Deep
          : prev.bassBoost === BassBoostMode.Deep
            ? BassBoostMode.Punchy
            : BassBoostMode.Off;
      return { ...prev, bassBoost: next };
    });
  }, []);

  const handleSaveProfile = useCallback(
    (name: string) => {
      const id = `custom_${Date.now()}`;
      const newProfile: SavedEqProfile = {
        id,
        name,
        gains: [...eq.gains],
        createdAt: new Date().toISOString().slice(0, 10),
      };
      setSavedProfiles((prev) => [newProfile, ...prev]);
      setEq((prev) => ({
        ...prev,
        preset: EqPresetId.Custom,
        activeCustomId: id,
      }));
    },
    [eq.gains]
  );

  const handleApplySavedProfile = useCallback((profile: SavedEqProfile) => {
    setEq((prev) => ({
      ...prev,
      preset: EqPresetId.Custom,
      activeCustomId: profile.id,
      gains: [...profile.gains],
    }));
  }, []);

  const handleDeleteSavedProfile = useCallback((id: string) => {
    setSavedProfiles((prev) => prev.filter((p) => p.id !== id));
    setEq((prev) =>
      prev.activeCustomId === id ? { ...prev, activeCustomId: null } : prev
    );
  }, []);

  const handleTriggerDjEffect = useCallback((effect: DjPadEffectId) => {
    audioEngine.triggerDjEffect(effect);
  }, []);

  const baseNavItems: Array<{
    id: NavTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: NavTab.Overview, label: 'סקירה כללית', shortLabel: 'ראשי', icon: LayoutGrid },
    { id: NavTab.Lightshow, label: 'תאורת מופע', shortLabel: 'תאורה', icon: Sun },
    { id: NavTab.Equalizer, label: 'איקוולייזר וסאונד', shortLabel: 'איקוולייזר', icon: Sliders },
    { id: NavTab.PartyFx, label: 'אפקטים ומיקרופון', shortLabel: 'אפקטים', icon: Disc3 },
  ];

  const navItems = isNativeApk
    ? baseNavItems
    : [
        ...baseNavItems,
        { id: NavTab.ApkDownload, label: 'הורדת ZIP / APK', shortLabel: 'הורדה', icon: Download },
      ];

  return (
    <div className="min-h-screen bg-[#0B0D11] pb-24 text-[#F3F5F8] md:pb-12" dir="rtl">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-white/[0.08] bg-[#0B0D11]">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-4 sm:px-6 lg:px-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab(NavTab.Overview);
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            JBL PartyBox 320
          </a>

          {/* Zone 2: Clean Single-Line Navigation Links (up to 5 items) */}
          <nav
            aria-label="ניווט ראשי"
            className="hidden md:flex items-center gap-7 text-sm font-medium"
          >
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'border-[#FF5500] text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action Button */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setConnectionModalOpen(true)}
              className="min-h-[40px] rounded-xl bg-[#FF5500] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#E64D00] whitespace-nowrap shrink-0"
            >
              {system.connectionType === 'ble' ? 'מחובר ב-BLE' : 'חיבור לרמקול'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="top" className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        {/* Contextual Intro + Direct Prominent APK Download Button */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {system.deviceName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
              <span>JBL Pro Sound</span>
              <span aria-hidden="true">·</span>
              <span>זוג וופרים 6.5״ + טוויטרים 25 מ״מ</span>
              <span aria-hidden="true">·</span>
              <span>תמיכה ב-Auracast™</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums" dir="ltr">
                FW 2.4.0
              </span>
            </div>
          </div>

          {!isNativeApk && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={heroDownloading}
                onClick={async () => {
                  setHeroDownloading(true);
                  const res = await triggerVerifiedZipDownload();
                  setHeroDownloading(false);
                  if (res.ok) {
                    setHeroDownloadDone(true);
                    window.setTimeout(() => setHeroDownloadDone(false), 5000);
                  } else {
                    setActiveTab(NavTab.ApkDownload);
                  }
                }}
                className="flex min-h-[46px] items-center gap-2 rounded-xl bg-[#FF5500] px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-[#FF5500]/20 transition-colors hover:bg-[#E64D00] disabled:opacity-75 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="h-4 w-4" />
                <span>
                  {heroDownloading
                    ? 'מוריד ארכיון ZIP...'
                    : heroDownloadDone
                      ? `ירד בהצלחה (${ZIP_FILE_NAME})`
                      : 'הורדת קובץ ZIP (מכיל APK · 1.65 MB)'}
                </span>
              </button>

              {!isInstalled && isInstallable ? (
                <button
                  type="button"
                  onClick={install}
                  className="min-h-[46px] rounded-xl border border-white/[0.12] bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.09] whitespace-nowrap shrink-0"
                >
                  התקנת אפליקציה מהירה
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setActiveTab(
                      activeTab === NavTab.ApkDownload
                        ? NavTab.Overview
                        : NavTab.ApkDownload
                    )
                  }
                  className="min-h-[46px] rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/[0.08] whitespace-nowrap shrink-0"
                >
                  {activeTab === NavTab.ApkDownload
                    ? 'חזרה למרכז השליטה'
                    : 'פרטי חבילה והתקנה'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Real-Time Audio Source & Master Volume Strip */}
        <div className="mb-6">
          <AudioSourceBar
            isPlaying={isPlaying}
            sourceMode={sourceMode}
            currentGroove={currentGroove}
            uploadedFileName={uploadedFileName}
            volume={system.volume}
            muted={system.muted}
            micError={micError}
            onTogglePlay={handleTogglePlay}
            onSelectGroove={handleSelectGroove}
            onUploadFile={handleUploadFile}
            onStartMicSync={handleStartMicSync}
            onChangeVolume={(vol) =>
              setSystem((prev) => ({ ...prev, volume: vol, muted: false }))
            }
            onToggleMute={() =>
              setSystem((prev) => ({ ...prev, muted: !prev.muted }))
            }
          />
        </div>

        {/* Two-Column Studio Hardware Grid */}
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Interactive Live JBL PartyBox Stage 320 Unit */}
          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-6">
            <SpeakerVisualizer
              lightshow={lightshow}
              bassBoost={eq.bassBoost}
              isPlaying={isPlaying}
              volume={system.volume}
              muted={system.muted}
              batteryPercent={system.batteryPercent}
              playtimeBoost={system.playtimeBoost}
              onToggleLightshow={() =>
                handleUpdateLightshow({ enabled: !lightshow.enabled })
              }
              onCycleBassBoost={handleCycleBassBoost}
              onTogglePlay={handleTogglePlay}
              onToggleMute={() =>
                setSystem((prev) => ({ ...prev, muted: !prev.muted }))
              }
              onToggleZone={handleToggleZone}
            />
          </div>

          {/* Active Workspace Panel */}
          <div className="lg:col-span-7 xl:col-span-8">
            {activeTab === NavTab.Overview && (
              <OverviewPanel
                lightshow={lightshow}
                eq={eq}
                batteryPercent={system.batteryPercent}
                playtimeBoost={system.playtimeBoost}
                volume={system.volume}
                onNavigate={setActiveTab}
                onSelectLightPreset={(preset) =>
                  handleSelectLightPreset(preset, false)
                }
                onUpdateLightColors={(primaryColor, secondaryColor) =>
                  handleUpdateLightshow({
                    enabled: true,
                    primaryColor,
                    secondaryColor,
                  })
                }
                onSelectEqPreset={handleSelectEqPreset}
                onChangeBassBoost={(bassBoost) =>
                  setEq((prev) => ({ ...prev, bassBoost }))
                }
                onTogglePlaytimeBoost={() =>
                  setSystem((prev) => ({
                    ...prev,
                    playtimeBoost: !prev.playtimeBoost,
                  }))
                }
                onTriggerDjEffect={handleTriggerDjEffect}
              />
            )}

            {activeTab === NavTab.Lightshow && (
              <LightshowPanel
                lightshow={lightshow}
                onUpdateLightshow={handleUpdateLightshow}
                onSelectPreset={handleSelectLightPreset}
                onToggleZone={handleToggleZone}
                onSetAllZones={handleSetAllZones}
                onResetLightshow={() => setLightshow(DEFAULT_LIGHTSHOW)}
              />
            )}

            {activeTab === NavTab.Equalizer && (
              <EqualizerPanel
                eq={eq}
                playtimeBoost={system.playtimeBoost}
                savedProfiles={savedProfiles}
                onChangeBandGain={handleChangeBandGain}
                onSelectPreset={handleSelectEqPreset}
                onResetFlat={() => handleSelectEqPreset(EqPresetId.Flat)}
                onChangeBassBoost={(bassBoost) =>
                  setEq((prev) => ({ ...prev, bassBoost }))
                }
                onToggleAiSoundBoost={() =>
                  setEq((prev) => ({
                    ...prev,
                    aiSoundBoost: !prev.aiSoundBoost,
                  }))
                }
                onChangeEnvironment={(environment) =>
                  setEq((prev) => ({ ...prev, environment }))
                }
                onSaveProfile={handleSaveProfile}
                onApplySavedProfile={handleApplySavedProfile}
                onDeleteSavedProfile={handleDeleteSavedProfile}
              />
            )}

            {activeTab === NavTab.PartyFx && (
              <PartyEffectsPanel
                micGuitar={micGuitar}
                auracastMode={system.auracastMode}
                stereoChannel={system.stereoChannel}
                onTriggerDjEffect={handleTriggerDjEffect}
                onUpdateMicGuitar={(patch) =>
                  setMicGuitar((prev) => ({ ...prev, ...patch }))
                }
                onResetMicGuitar={() => setMicGuitar(DEFAULT_MIC_GUITAR)}
                onChangeAuracast={(auracastMode, channel) =>
                  setSystem((prev) => ({
                    ...prev,
                    auracastMode,
                    ...(channel ? { stereoChannel: channel } : {}),
                  }))
                }
              />
            )}

            {activeTab === NavTab.ApkDownload && <ApkDownloadPanel />}
          </div>
        </div>
      </main>

      {/* Non-intrusive Offline Connectivity Toast */}
      {!isOnline && !isNativeApk && (
        <div className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-[#141821] px-3.5 py-2 text-xs font-medium text-amber-300 shadow-lg md:bottom-5">
          <WifiOff className="h-3.5 w-3.5" />
          <span>מצב לא מקוון — האפליקציה פועלת מהזיכרון המקומי</span>
        </div>
      )}

      {/* Mobile Ergonomic Bottom Navigation Bar (< 15% Viewport Height) */}
      <nav
        aria-label="ניווט תחתון לנייד"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/[0.08] bg-[#0B0D11]/95 backdrop-blur-md md:hidden"
      >
        <div
          className={`grid h-16 items-center px-1.5 ${
            navItems.length === 5 ? 'grid-cols-5' : 'grid-cols-4'
          }`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl transition-colors ${
                  active ? 'text-[#FF5500]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="mt-1 text-[10px] font-medium tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Web Bluetooth & Device Configuration Sheet */}
      <ConnectionModal
        open={connectionModalOpen}
        system={system}
        onClose={() => setConnectionModalOpen(false)}
        onConnectBle={(bleDeviceTitle) =>
          setSystem((prev) => ({
            ...prev,
            connectionType: 'ble',
            bleDeviceTitle,
            deviceName: bleDeviceTitle,
          }))
        }
        onSwitchToDemo={() =>
          setSystem((prev) => ({
            ...prev,
            connectionType: 'demo',
            bleDeviceTitle: null,
          }))
        }
        onRenameSpeaker={(deviceName) =>
          setSystem((prev) => ({ ...prev, deviceName }))
        }
      />
    </div>
  );
}
