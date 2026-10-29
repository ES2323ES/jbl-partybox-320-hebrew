/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  Disc3,
  Download,
  LayoutGrid,
  Moon,
  Sliders,
  Sparkles,
  Sun,
  WifiOff,
} from 'lucide-react';
import {
  APP_VERSION,
  AcousticEnvironment,
  AppVisualTheme,
  AuracastMode,
  BUILTIN_EQ_PRESETS,
  BassBoostMode,
  CustomSamplerSlot,
  DemoGrooveId,
  DjPadEffectId,
  EqPresetId,
  EqualizerState,
  FullBackupBundle,
  LIGHTSHOW_PRESETS,
  LightZoneKey,
  LightshowPresetId,
  LightshowState,
  MicGuitarState,
  NavTab,
  PartySceneDefinition,
  PartySceneId,
  SavedEqProfile,
  SpeakerSystemState,
} from './types/speaker';
import { audioEngine } from './services/audioEngine';
import { bluetoothBridge } from './services/bluetoothBridge';
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
const STORAGE_KEY_THEME = 'jbl_pb320_theme_v3';
const STORAGE_KEY_SAMPLES = 'jbl_pb320_samples_v1';

const DEFAULT_LIGHTSHOW: LightshowState = {
  enabled: true,
  preset: LightshowPresetId.Flow,
  primaryColor: '#E06336',
  secondaryColor: '#F59E0B',
  brightness: 80,
  speed: 1.0,
  strobeIntensity: 35,
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
  liveKaraokeActive: false,
};

const DEFAULT_SYSTEM: SpeakerSystemState = {
  deviceName: 'JBL PartyBox Stage 320',
  connectionType: 'demo',
  bleDeviceTitle: null,
  volume: 72,
  muted: false,
  batteryPercent: 86,
  playtimeBoost: false,
  auracastMode: AuracastMode.Single,
  stereoChannel: 'R',
  autoReconnect: true,
  notificationControlsEnabled: true,
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

const INITIAL_SAMPLER_SLOTS: CustomSamplerSlot[] = [
  { slotIndex: 0, label: 'קריאת מסיבה 1', audioDataUrl: null, durationSec: 0 },
  { slotIndex: 1, label: 'קריאת מסיבה 2', audioDataUrl: null, durationSec: 0 },
  { slotIndex: 2, label: 'קריאת מסיבה 3', audioDataUrl: null, durationSec: 0 },
  { slotIndex: 3, label: 'קריאת מסיבה 4', audioDataUrl: null, durationSec: 0 },
];

export default function App() {
  const { isNativeApk, isInstalled, isInstallable, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<NavTab>(NavTab.Overview);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [heroDownloading, setHeroDownloading] = useState(false);
  const [heroDownloadDone, setHeroDownloadDone] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState<PartySceneId | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const sleepStartVolRef = useRef<number>(72);
  const isOnline = useOnlineStatus();

  // 3-Mode Display Lighting Theme: 'light' | 'dark' | 'neon'
  const [themeMode, setThemeMode] = useState<AppVisualTheme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_THEME);
      if (saved === 'light' || saved === 'dark' || saved === 'neon') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('theme-neon');
    } else if (themeMode === 'neon') {
      root.classList.add('dark', 'theme-neon');
    } else {
      root.classList.remove('dark', 'theme-neon');
    }
    try {
      localStorage.setItem(STORAGE_KEY_THEME, themeMode);
    } catch {
      // ignore
    }
  }, [themeMode]);

  // Persisted Hardware States
  const [lightshow, setLightshow] = useState<LightshowState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.lightshow) {
          const presetValid = Object.values(LightshowPresetId).includes(
            parsed.lightshow.preset
          );
          return {
            ...DEFAULT_LIGHTSHOW,
            ...parsed.lightshow,
            preset: presetValid ? parsed.lightshow.preset : LightshowPresetId.Flow,
          };
        }
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
        if (parsed.micGuitar) {
          return {
            ...DEFAULT_MIC_GUITAR,
            ...parsed.micGuitar,
            liveKaraokeActive: false,
          };
        }
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

  const [customSamples, setCustomSamples] = useState<CustomSamplerSlot[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SAMPLES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 4) return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_SAMPLER_SLOTS;
  });

  // Live Audio Source Transport State
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceMode, setSourceMode] = useState<'groove' | 'file' | 'mic'>('groove');
  const [currentGroove, setCurrentGroove] = useState<DemoGrooveId>('house_124');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  // Auto-detect paired JBL Bluetooth speaker on launch & resume when autoReconnect is active
  useEffect(() => {
    if (!system.autoReconnect) return;

    const tryAutoConnect = () => {
      if (!bluetoothBridge.isAndroidNativeBridgeAvailable()) return;
      const paired = bluetoothBridge.getPairedAndroidSpeakers();
      const activeJbl =
        paired.find((d) => d.isJbl && d.isActiveAudioRoute) ||
        paired.find((d) => d.isJbl);
      if (activeJbl) {
        setSystem((prev) => ({
          ...prev,
          connectionType: 'android_bt',
          bleDeviceTitle: activeJbl.name,
          deviceName: activeJbl.name,
        }));
      }
    };

    tryAutoConnect();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        tryAutoConnect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [system.autoReconnect]);

  // Persist States
  useEffect(() => {
    try {
      const { liveKaraokeActive: _ignoreLive, ...persistedMic } = micGuitar;
      localStorage.setItem(
        STORAGE_KEY_STATE,
        JSON.stringify({ lightshow, eq, micGuitar: persistedMic, system })
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

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SAMPLES, JSON.stringify(customSamples));
    } catch {
      // ignore quota errors
    }
  }, [customSamples]);

  // Sync DSP Engine + Hardware Bridge on every parameter change
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
    const duckFactor =
      micGuitar.vocalDucking && !micGuitar.liveKaraokeActive ? 0.72 : 1;
    audioEngine.setVolume(Math.round(system.volume * duckFactor), system.muted);
  }, [
    system.volume,
    system.muted,
    micGuitar.vocalDucking,
    micGuitar.liveKaraokeActive,
  ]);

  useEffect(() => {
    audioEngine.updateLiveKaraokeParams({
      volume: micGuitar.mic1Volume,
      bassDb: micGuitar.mic1Bass,
      trebleDb: micGuitar.mic1Treble,
      echoPercent: micGuitar.mic1Echo,
      vocalDucking: micGuitar.vocalDucking,
    });
  }, [
    micGuitar.mic1Volume,
    micGuitar.mic1Bass,
    micGuitar.mic1Treble,
    micGuitar.mic1Echo,
    micGuitar.vocalDucking,
  ]);

  // Gradual Sleep & Fade-Out Timer
  useEffect(() => {
    if (sleepRemainingSec === null) return;
    if (sleepRemainingSec <= 0) {
      audioEngine.pause();
      setIsPlaying(false);
      setSystem((prev) => ({ ...prev, muted: true }));
      setLightshow((prev) => ({ ...prev, enabled: false }));
      setSleepRemainingSec(null);
      return;
    }

    const timer = window.setTimeout(() => {
      const nextSec = sleepRemainingSec - 1;
      if (nextSec > 0 && nextSec <= 60) {
        const scaledVol = Math.max(
          4,
          Math.round(sleepStartVolRef.current * (nextSec / 60))
        );
        setSystem((prev) => ({ ...prev, volume: scaledVol }));
      }
      setSleepRemainingSec(nextSec);
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [sleepRemainingSec]);

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

  const handleUploadFiles = useCallback(async (files: File[]) => {
    setMicError(null);
    try {
      const name = await audioEngine.loadAudioFiles(files);
      setUploadedFileName(name);
      setSourceMode('file');
      setIsPlaying(true);
    } catch {
      setMicError('לא ניתן היה לטעון את קובצי השמע שנבחרו.');
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
      setMicError(
        'הגישה למיקרופון נדחתה או אינה זמינה — ניתן לנגן מקצב מובנה או לטעון שירים מהמכשיר.'
      );
    }
  }, [sourceMode, isPlaying]);

  // --- Lightshow & Neon Handlers ---

  const handleUpdateLightshow = useCallback((patch: Partial<LightshowState>) => {
    setActiveSceneId(null);
    setLightshow((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSelectLightPreset = useCallback(
    (preset: LightshowPresetId, applyDefaultColors = true) => {
      setActiveSceneId(null);
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

  const handleActivateNeonLightshow = useCallback(() => {
    setThemeMode('neon');
    setLightshow((prev) => ({
      ...prev,
      enabled: true,
      preset: LightshowPresetId.Neon,
      primaryColor: '#00F0FF',
      secondaryColor: '#E838FF',
      brightness: Math.max(85, prev.brightness),
    }));
  }, []);

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

  // --- Equalizer & Smart Scene Handlers ---

  const handleChangeBandGain = useCallback((index: number, db: number) => {
    setActiveSceneId(null);
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

  const handleApplyCalibratedGains = useCallback(
    (gains: number[], environment: AcousticEnvironment) => {
      setActiveSceneId(null);
      setEq((prev) => ({
        ...prev,
        preset: EqPresetId.Custom,
        activeCustomId: null,
        gains: [...gains],
        environment,
      }));
    },
    []
  );

  const handleSelectEqPreset = useCallback(
    (preset: Exclude<EqPresetId, EqPresetId.Custom>) => {
      setActiveSceneId(null);
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

  const handleApplyPartyScene = useCallback((scene: PartySceneDefinition) => {
    setActiveSceneId(scene.id);
    if (scene.id === 'neon_club') {
      setThemeMode('neon');
    }
    setLightshow((prev) => ({
      ...prev,
      enabled: true,
      preset: scene.lightPreset,
      primaryColor: scene.primaryColor,
      secondaryColor: scene.secondaryColor,
      brightness: scene.brightness,
      strobeIntensity: scene.strobeIntensity,
      zones: {
        ...prev.zones,
        rings: true,
        starry: true,
        sideRails: true,
        strobeTop: !scene.disableStrobes,
        strobeBottom: !scene.disableStrobes,
      },
    }));
    setEq((prev) => ({
      ...prev,
      preset: EqPresetId.Custom,
      activeCustomId: null,
      gains: [...scene.gains],
      bassBoost: scene.bassBoost,
    }));
    setSystem((prev) => ({
      ...prev,
      volume: scene.volume,
      muted: false,
    }));
    if (typeof scene.vocalDucking === 'boolean' || typeof scene.echo === 'number') {
      setMicGuitar((prev) => ({
        ...prev,
        ...(typeof scene.vocalDucking === 'boolean'
          ? { vocalDucking: scene.vocalDucking }
          : {}),
        ...(typeof scene.echo === 'number' ? { mic1Echo: scene.echo } : {}),
      }));
    }
  }, []);

  // --- Sync Android Notification Shade & MediaSession ---

  useEffect(() => {
    bluetoothBridge.syncQuickControlNotification({
      enabled: system.notificationControlsEnabled,
      speakerName: system.deviceName,
      presetTitle: LIGHTSHOW_PRESETS[lightshow.preset].title,
      volume: system.muted ? 0 : system.volume,
      isPlaying,
      lightEnabled: lightshow.enabled,
      onTogglePlay: handleTogglePlay,
      onPrevTrack: () => audioEngine.prevTrack(),
      onNextTrack: () => audioEngine.nextTrack(),
    });
  }, [
    system.notificationControlsEnabled,
    system.deviceName,
    system.volume,
    system.muted,
    lightshow.preset,
    lightshow.enabled,
    isPlaying,
    handleTogglePlay,
  ]);

  useEffect(() => {
    return bluetoothBridge.onQuickNotificationAction((action) => {
      if (action === 'toggle_play') {
        handleTogglePlay();
      } else if (action === 'toggle_light') {
        setLightshow((prev) => ({ ...prev, enabled: !prev.enabled }));
      } else if (action === 'neon_mode') {
        handleActivateNeonLightshow();
      } else if (action === 'cycle_bass') {
        handleCycleBassBoost();
      } else if (action === 'toggle_mute') {
        setSystem((prev) => ({ ...prev, muted: !prev.muted }));
      }
    });
  }, [handleTogglePlay, handleActivateNeonLightshow, handleCycleBassBoost]);

  // --- Profiles, Custom Sampler & Full Backup Export / Import ---

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

  const handleSaveCustomSample = useCallback(
    (slotIndex: number, dataUrl: string, durationSec: number) => {
      setCustomSamples((prev) =>
        prev.map((s) =>
          s.slotIndex === slotIndex
            ? { ...s, audioDataUrl: dataUrl, durationSec }
            : s
        )
      );
    },
    []
  );

  const handleClearCustomSample = useCallback((slotIndex: number) => {
    setCustomSamples((prev) =>
      prev.map((s) =>
        s.slotIndex === slotIndex
          ? { ...s, audioDataUrl: null, durationSec: 0 }
          : s
      )
    );
  }, []);

  const handleExportFullBackup = useCallback(() => {
    const bundle: FullBackupBundle = {
      appVersion: APP_VERSION,
      exportedAt: new Date().toISOString(),
      lightshow,
      eq,
      micGuitar: { ...micGuitar, liveKaraokeActive: false },
      savedProfiles,
      customSamples,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JBL-PartyBox-320-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lightshow, eq, micGuitar, savedProfiles, customSamples]);

  const handleImportFullBackupFile = useCallback(
    async (file: File): Promise<string> => {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<FullBackupBundle>;
      if (!parsed.eq || !Array.isArray(parsed.eq.gains)) {
        throw new Error('קובץ הגיבוי שנבחר אינו מכיל נתוני הגדרות תקינים.');
      }
      if (parsed.lightshow) {
        setLightshow({ ...DEFAULT_LIGHTSHOW, ...parsed.lightshow });
      }
      setEq({ ...DEFAULT_EQ, ...parsed.eq });
      if (parsed.micGuitar) {
        setMicGuitar({
          ...DEFAULT_MIC_GUITAR,
          ...parsed.micGuitar,
          liveKaraokeActive: false,
        });
      }
      if (Array.isArray(parsed.savedProfiles)) {
        setSavedProfiles(parsed.savedProfiles);
      }
      if (Array.isArray(parsed.customSamples) && parsed.customSamples.length === 4) {
        setCustomSamples(parsed.customSamples);
      }
      return 'כל פרופילי הסאונד, התאורה והסמפלים שוחזרו בהצלחה מקובץ הגיבוי!';
    },
    []
  );

  const handleStartSleepTimer = useCallback(
    (minutes: number | null) => {
      if (minutes === null) {
        setSleepRemainingSec(null);
        return;
      }
      sleepStartVolRef.current = system.volume;
      setSleepRemainingSec(minutes * 60);
    },
    [system.volume]
  );

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
    { id: NavTab.PartyFx, label: 'אפקטים וקריוקי', shortLabel: 'קריוקי', icon: Disc3 },
  ];

  const navItems = isNativeApk
    ? baseNavItems
    : [
        ...baseNavItems,
        { id: NavTab.ApkDownload, label: 'הורדה ו-GitHub', shortLabel: 'הורדה', icon: Download },
      ];

  const isSpeakerConnected =
    system.connectionType === 'ble' || system.connectionType === 'android_bt';

  return (
    <div
      className={`min-h-screen pb-24 text-slate-800 transition-colors duration-200 dark:text-slate-100 md:pb-12 ${
        themeMode === 'neon'
          ? 'bg-[#090D1A]'
          : 'bg-[#F4F6FA] dark:bg-[#161D2B]'
      }`}
      dir="rtl"
    >
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="neon-header border-b border-slate-200/90 bg-white/95 backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-[#1A2233]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6 lg:px-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab(NavTab.Overview);
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
          >
            JBL PartyBox 320
          </a>

          {/* Zone 2: Clean Single-Line Navigation Links */}
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
                  className={`py-1.5 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                    active
                      ? themeMode === 'neon'
                        ? 'border-cyan-400 text-white font-semibold'
                        : 'border-[#D95B2B] text-slate-900 dark:text-white font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
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
              className={`flex min-h-[42px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isSpeakerConnected
                  ? 'bg-teal-600 hover:bg-teal-700'
                  : 'bg-[#D95B2B] hover:bg-[#C24E22]'
              }`}
            >
              <Bluetooth className="h-3.5 w-3.5" />
              <span>
                {isSpeakerConnected ? 'מחובר ב-Bluetooth' : 'חיבור בלוטוס לרמקול'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="top" className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        {/* Contextual Workspace Intro + 3-Mode Display Lighting Selector (Day / Evening / Neon!) + Download */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">
              {system.deviceName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                גרסה {APP_VERSION}
              </span>
              <span aria-hidden="true">·</span>
              <span>JBL Pro Sound</span>
              <span aria-hidden="true">·</span>
              <span>זוג וופרים 6.5״ + טוויטרים 25 מ״מ</span>
              <span aria-hidden="true">·</span>
              <span>תמיכה ב-Auracast™</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* 3-Option Display & Lighting Mode Selector: Day | Soft Evening | Beautiful Neon */}
            <div
              role="group"
              aria-label="בחירת תאורת תצוגה"
              className="neon-surface flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-[#1E2738]"
            >
              <button
                type="button"
                onClick={() => setThemeMode('light')}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  themeMode === 'light'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>יום בהיר</span>
              </button>

              <button
                type="button"
                onClick={() => setThemeMode('dark')}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  themeMode === 'dark'
                    ? 'bg-[#D95B2B] text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                <span>ערב רך</span>
              </button>

              <button
                type="button"
                onClick={handleActivateNeonLightshow}
                className={`flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  themeMode === 'neon'
                    ? 'bg-gradient-to-l from-cyan-500 to-fuchsia-600 text-white shadow-[0_0_16px_rgba(0,240,255,0.45)]'
                    : 'text-slate-600 hover:text-cyan-700 dark:text-slate-300 dark:hover:text-cyan-300'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>תאורת ניאון</span>
              </button>
            </div>

            {!isNativeApk && (
              <>
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
                  className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C24E22] disabled:opacity-75 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="h-4 w-4" />
                  <span>
                    {heroDownloading
                      ? 'מוריד ארכיון ZIP...'
                      : heroDownloadDone
                        ? `ירד בהצלחה (${ZIP_FILE_NAME})`
                        : `הורדת APK / ZIP (${APP_VERSION})`}
                  </span>
                </button>

                {!isInstalled && isInstallable ? (
                  <button
                    type="button"
                    onClick={install}
                    className="neon-surface min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    התקנה מהירה למכשיר
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
                    className="neon-surface min-h-[44px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {activeTab === NavTab.ApkDownload
                      ? 'חזרה למרכז השליטה'
                      : 'ניהול GitHub והורדות'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Real-Time Audio Source, Multi-Track Playlist & Master Volume Strip */}
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
            onUploadFiles={handleUploadFiles}
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
              onActivateNeonLightshow={handleActivateNeonLightshow}
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
                activeSceneId={activeSceneId}
                sleepRemainingSec={sleepRemainingSec}
                notificationControlsEnabled={system.notificationControlsEnabled}
                autoReconnect={system.autoReconnect}
                onNavigate={setActiveTab}
                onApplyPartyScene={handleApplyPartyScene}
                onSelectLightPreset={(preset, applyColors = false) =>
                  handleSelectLightPreset(preset, applyColors)
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
                onStartSleepTimer={handleStartSleepTimer}
                onToggleNotificationControls={() =>
                  setSystem((prev) => ({
                    ...prev,
                    notificationControlsEnabled: !prev.notificationControlsEnabled,
                  }))
                }
                onToggleAutoReconnect={() =>
                  setSystem((prev) => ({
                    ...prev,
                    autoReconnect: !prev.autoReconnect,
                  }))
                }
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
                onApplyCalibratedGains={handleApplyCalibratedGains}
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
                onExportFullBackup={handleExportFullBackup}
                onImportFullBackupFile={handleImportFullBackupFile}
              />
            )}

            {activeTab === NavTab.PartyFx && (
              <PartyEffectsPanel
                micGuitar={micGuitar}
                auracastMode={system.auracastMode}
                stereoChannel={system.stereoChannel}
                customSamples={customSamples}
                onTriggerDjEffect={handleTriggerDjEffect}
                onUpdateMicGuitar={(patch) =>
                  setMicGuitar((prev) => ({ ...prev, ...patch }))
                }
                onResetMicGuitar={() => {
                  audioEngine.stopLiveKaraoke();
                  setMicGuitar(DEFAULT_MIC_GUITAR);
                }}
                onChangeAuracast={(auracastMode, channel) =>
                  setSystem((prev) => ({
                    ...prev,
                    auracastMode,
                    ...(channel ? { stereoChannel: channel } : {}),
                  }))
                }
                onSaveCustomSample={handleSaveCustomSample}
                onClearCustomSample={handleClearCustomSample}
              />
            )}

            {activeTab === NavTab.ApkDownload && <ApkDownloadPanel />}
          </div>
        </div>
      </main>

      {/* Non-intrusive Offline Connectivity Toast */}
      {!isOnline && !isNativeApk && (
        <div className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 shadow-md dark:border-amber-500/40 dark:bg-[#1E2738] dark:text-amber-300 md:bottom-5">
          <WifiOff className="h-3.5 w-3.5" />
          <span>מצב לא מקוון — האפליקציה פועלת מהזיכרון המקומי</span>
        </div>
      )}

      {/* Mobile Ergonomic Bottom Navigation Bar (< 15% Viewport Height) */}
      <nav
        aria-label="ניווט תחתון לנייד"
        className="neon-header fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-700/80 dark:bg-[#1A2233]/95 md:hidden"
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
                  active
                    ? themeMode === 'neon'
                      ? 'text-cyan-400 font-semibold'
                      : 'text-[#D95B2B] font-semibold'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
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

      {/* Bluetooth, Permissions & Speaker Configuration Sheet */}
      <ConnectionModal
        open={connectionModalOpen}
        system={system}
        onClose={() => setConnectionModalOpen(false)}
        onConnectSpeaker={(deviceTitle, mode, batteryLevel) =>
          setSystem((prev) => ({
            ...prev,
            connectionType: mode,
            bleDeviceTitle: deviceTitle,
            deviceName: deviceTitle,
            ...(typeof batteryLevel === 'number'
              ? { batteryPercent: batteryLevel }
              : {}),
          }))
        }
        onSwitchToDemo={() => {
          bluetoothBridge.disconnectBle();
          setSystem((prev) => ({
            ...prev,
            connectionType: 'demo',
            bleDeviceTitle: null,
          }));
        }}
        onRenameSpeaker={(deviceName) =>
          setSystem((prev) => ({ ...prev, deviceName }))
        }
      />
    </div>
  );
}
