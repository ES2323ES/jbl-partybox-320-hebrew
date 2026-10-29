/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  BookOpen,
  ClipboardList,
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
  AudioSyncSourceMode,
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
import { faultLogger } from './services/faultLogger';
import { SpeakerVisualizer } from './components/SpeakerVisualizer';
import { AudioSourceBar } from './components/AudioSourceBar';
import { OverviewPanel } from './components/OverviewPanel';
import { LightshowPanel } from './components/LightshowPanel';
import { EqualizerPanel } from './components/EqualizerPanel';
import { PartyEffectsPanel } from './components/PartyEffectsPanel';
import { UserGuidePanel } from './components/UserGuidePanel';
import { FaultLogPanel } from './components/FaultLogPanel';
import { ApkDownloadPanel } from './components/ApkDownloadPanel';
import { ConnectionModal } from './components/ConnectionModal';
import { useOnlineStatus, usePWAInstall } from './hooks/usePWAInstall';
import { PUBLIC_GITHUB_APK_URL } from './services/apkDownloader';

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
  const [activeSceneId, setActiveSceneId] = useState<PartySceneId | null>(null);
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null);
  const [unreadFaults, setUnreadFaults] = useState<number>(() =>
    faultLogger.getUnreadIssueCount()
  );
  const sleepStartVolRef = useRef<number>(72);
  const lightshowRef = useRef<LightshowState>(DEFAULT_LIGHTSHOW);
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

  // Subscribe to unread fault count for navigation indicator
  useEffect(() => {
    return faultLogger.subscribe(() => {
      setUnreadFaults(faultLogger.getUnreadIssueCount());
    });
  }, []);

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

  lightshowRef.current = lightshow;

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

  // Live Zero-Upload External Music Player Sync State
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceMode, setSourceMode] = useState<AudioSyncSourceMode>('player_sync');
  const [currentGroove, setCurrentGroove] = useState<DemoGrooveId>('house_124');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  useEffect(() => {
    return audioEngine.onStateChange(() => {
      const st = audioEngine.getSourceState();
      setIsPlaying(st.isPlaying);
      setSourceMode(st.sourceMode);
      setCurrentGroove(st.currentGroove);
    });
  }, []);

  // Auto-detect paired JBL Bluetooth speaker + open lighting channel + auto-start external player sync on Android APK
  useEffect(() => {
    if (!system.autoReconnect) return;

    const tryAutoConnect = () => {
      if (!bluetoothBridge.isAndroidNativeBridgeAvailable()) return;

      const perms = bluetoothBridge.getPermissionState();
      if (perms.microphone) {
        const st = audioEngine.getSourceState();
        if (!st.isPlaying) {
          void audioEngine.startLivePlayerSync();
        }
      }

      const paired = bluetoothBridge.getPairedAndroidSpeakers();
      const activeJbl =
        paired.find((d) => d.isJbl && d.isActiveAudioRoute) ||
        paired.find((d) => d.isJbl);
      if (activeJbl) {
        bluetoothBridge.connectAndroidSpeakerControl(
          activeJbl.address || activeJbl.name
        );
        bluetoothBridge.syncHardwareLightshow(lightshowRef.current, true);
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

  // REAL-TIME HARDWARE LIGHTSHOW SYNC TO PHYSICAL JBL SPEAKER!
  useEffect(() => {
    bluetoothBridge.syncHardwareLightshow(lightshow, false);
  }, [lightshow]);

  // REAL-TIME MUSIC BEAT-SYNC PULSE TO PHYSICAL JBL SPEAKER!
  useEffect(() => {
    return audioEngine.onBeatDetected((energy) => {
      const ls = lightshowRef.current;
      if (ls.enabled && ls.beatSync) {
        bluetoothBridge.triggerHardwareBeatPulse(
          energy,
          ls.primaryColor,
          ls.secondaryColor
        );
      }
    });
  }, []);

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

  // --- Zero-Upload External Music Player Sync Handlers ---

  const handleStartLivePlayerSync = useCallback(async () => {
    setSyncNotice(null);
    if (sourceMode === 'player_sync' && isPlaying) {
      audioEngine.pause();
      return;
    }
    const res = await audioEngine.startLivePlayerSync();
    if (!res.ok) {
      setSyncNotice(res.message);
    }
  }, [sourceMode, isPlaying]);

  const handleStartSystemAudioSync = useCallback(async () => {
    setSyncNotice(null);
    const res = await audioEngine.startSystemAudioSync();
    if (!res.ok) {
      setSyncNotice(res.message);
    }
  }, []);

  const handleTogglePlay = useCallback(() => {
    setSyncNotice(null);
    if (!isPlaying && sourceMode === 'player_sync') {
      void audioEngine.startLivePlayerSync().then((res) => {
        if (!res.ok) setSyncNotice(res.message);
      });
      return;
    }
    audioEngine.togglePlay();
  }, [isPlaying, sourceMode]);

  const handleSelectGroove = useCallback((groove: DemoGrooveId) => {
    setSyncNotice(null);
    audioEngine.startGroove(groove);
  }, []);

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

  // --- Profiles, Custom Sampler & Settings Backup Export / Import ---

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

  const desktopNavItems: Array<{
    id: NavTab;
    label: string;
    shortLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: NavTab.Overview, label: 'ראשי', shortLabel: 'ראשי', icon: LayoutGrid },
    { id: NavTab.Lightshow, label: 'תאורה וניאון', shortLabel: 'תאורה', icon: Sun },
    { id: NavTab.Equalizer, label: 'איקוולייזר', shortLabel: 'סאונד', icon: Sliders },
    { id: NavTab.PartyFx, label: 'קריוקי ואפקטים', shortLabel: 'קריוקי', icon: Disc3 },
    { id: NavTab.UserGuide, label: 'מדריך למשתמש', shortLabel: 'מדריך', icon: BookOpen },
    { id: NavTab.FaultLog, label: 'יומן תקלות', shortLabel: 'תקלות', icon: ClipboardList },
    ...(isNativeApk
      ? []
      : [
          {
            id: NavTab.ApkDownload,
            label: 'הורדה ו-GitHub',
            shortLabel: 'הורדה',
            icon: Download,
          },
        ]),
  ];

  // Mobile bottom bar keeps max 6 ergonomic icons
  const mobileNavItems = desktopNavItems.filter(
    (item) => item.id !== NavTab.ApkDownload
  );

  const isSpeakerConnected =
    system.connectionType === 'ble' || system.connectionType === 'android_bt';

  return (
    <div
      className={`min-h-dvh pb-safe-nav text-slate-800 dark:text-slate-100 md:pb-12 ${
        themeMode === 'neon'
          ? 'bg-[#090D1A]'
          : 'bg-[#F4F6FA] dark:bg-[#161D2B]'
      }`}
      dir="rtl"
    >
      {/* Stable Sticky 3-Zone Top Bar */}
      <header className="neon-header sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur-md dark:border-slate-700/70 dark:bg-[#1A2233]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
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
            className="hidden lg:flex items-center gap-5 text-sm font-medium"
          >
            {desktopNavItems.map((item) => {
              const active = activeTab === item.id;
              const showUnreadDot =
                item.id === NavTab.FaultLog && unreadFaults > 0 && !active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-1.5 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                    active
                      ? themeMode === 'neon'
                        ? 'border-cyan-400 text-white font-semibold'
                        : 'border-[#D95B2B] text-slate-900 dark:text-white font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  <span>{item.label}</span>
                  {showUnreadDot && (
                    <span
                      aria-label={`${unreadFaults} התראות חדשות`}
                      className="ms-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
                    />
                  )}
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
      <main id="top" className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8">
        {/* Contextual Workspace Intro + 3-Mode Display Lighting Selector + Quick Links */}
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
              <span>סינכרון אוטומטי מלא לנגן המוזיקה ללא העלאת שירים</span>
              <span aria-hidden="true">·</span>
              <span>בקרת תאורת BLE / SPP</span>
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
                <a
                  href={PUBLIC_GITHUB_APK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[42px] items-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C24E22] whitespace-nowrap shrink-0"
                >
                  <Download className="h-4 w-4" />
                  <span>{`הורדת APK (${APP_VERSION})`}</span>
                </a>

                {!isInstalled && isInstallable ? (
                  <button
                    type="button"
                    onClick={install}
                    className="neon-surface min-h-[42px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
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
                    className="neon-surface min-h-[42px] rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#1E2738] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
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

        {/* Zero-Upload Live External Music Player Sync & Master Volume Strip */}
        <div className="mb-6">
          <AudioSourceBar
            isPlaying={isPlaying}
            sourceMode={sourceMode}
            currentGroove={currentGroove}
            volume={system.volume}
            muted={system.muted}
            syncNotice={syncNotice}
            onTogglePlay={handleTogglePlay}
            onStartLivePlayerSync={handleStartLivePlayerSync}
            onStartSystemAudioSync={handleStartSystemAudioSync}
            onSelectGroove={handleSelectGroove}
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
          <div className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20">
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
          <div className="lg:col-span-7 xl:col-span-8 min-w-0">
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
                onOpenBluetoothModal={() => setConnectionModalOpen(true)}
                onOpenFaultLog={() => setActiveTab(NavTab.FaultLog)}
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

            {activeTab === NavTab.UserGuide && (
              <UserGuidePanel
                onNavigate={setActiveTab}
                onOpenBluetoothModal={() => setConnectionModalOpen(true)}
                onActivateNeon={handleActivateNeonLightshow}
              />
            )}

            {activeTab === NavTab.FaultLog && (
              <FaultLogPanel
                system={system}
                lightshow={lightshow}
                onOpenBluetoothModal={() => setConnectionModalOpen(true)}
              />
            )}

            {activeTab === NavTab.ApkDownload && <ApkDownloadPanel />}
          </div>
        </div>
      </main>

      {/* Non-intrusive Offline Connectivity Toast */}
      {!isOnline && !isNativeApk && (
        <div className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-800 shadow-md dark:border-amber-500/40 dark:bg-[#1E2738] dark:text-amber-300 lg:bottom-5">
          <WifiOff className="h-3.5 w-3.5" />
          <span>מצב לא מקוון — האפליקציה פועלת מהזיכרון המקומי</span>
        </div>
      )}

      {/* Mobile & Tablet Ergonomic Bottom Navigation Bar (< 15% Viewport Height) */}
      <nav
        aria-label="ניווט תחתון לנייד"
        className="neon-header nav-safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-700/80 dark:bg-[#1A2233]/95 lg:hidden"
      >
        <div className="grid h-16 grid-cols-6 items-center px-1">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            const showUnreadDot =
              item.id === NavTab.FaultLog && unreadFaults > 0 && !active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex min-h-[48px] flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
                  active
                    ? themeMode === 'neon'
                      ? 'text-cyan-400 font-semibold'
                      : 'text-[#D95B2B] font-semibold'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon className="h-4.5 w-4.5" />
                  {showUnreadDot && (
                    <span className="absolute -top-1 -right-1.5 h-2 w-2 rounded-full bg-amber-500" />
                  )}
                </div>
                <span className="mt-1 text-[10px] font-medium tracking-tight whitespace-nowrap">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Bluetooth, Lighting Channel & Permissions Modal */}
      <ConnectionModal
        open={connectionModalOpen}
        system={system}
        onClose={() => setConnectionModalOpen(false)}
        onConnectSpeaker={(deviceTitle, mode, batteryLevel) => {
          bluetoothBridge.syncHardwareLightshow(lightshowRef.current, true);
          setSystem((prev) => ({
            ...prev,
            connectionType: mode,
            bleDeviceTitle: deviceTitle,
            deviceName: deviceTitle,
            ...(typeof batteryLevel === 'number'
              ? { batteryPercent: batteryLevel }
              : {}),
          }));
        }}
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
        onOpenFaultLog={() => setActiveTab(NavTab.FaultLog)}
      />
    </div>
  );
}
