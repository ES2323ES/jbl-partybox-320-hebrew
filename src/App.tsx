import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SvgClose,
  SvgDownload,
  SvgEqualizer,
  SvgFolder,
  SvgForum,
  SvgGithub,
  SvgInfo,
  SvgLightControls,
  SvgMoon,
  SvgMusic,
  SvgNext,
  SvgPause,
  SvgPlay,
  SvgPrev,
  SvgRefresh,
  SvgSettings,
  SvgSpeakerBt,
  SvgSpeakerTune,
  SvgSun,
  SvgSystemTheme,
} from './components/SvgIcons';

const APP_VERSION = '0.3.0';
const BUILD_NUMBER = 5;
const GITHUB_REPO = 'ES2323ES/jbl-partybox-320-hebrew';
const GITHUB_PROFILE_URL = 'https://github.com/ES2323ES';
const MITMACHIM_PROFILE_URL =
  'https://mitmachim.top/user/%D7%90%D7%A9-%D7%94%D7%AA%D7%95%D7%A8%D7%94';

type ThemeMode = 'light' | 'dark' | 'system';
type BottomTab = 'connect' | 'control' | 'eq' | 'songs' | 'speaker';
type BassMode = 'off' | 'deep' | 'punchy';
type ProtocolFraming = 'auto' | 'harman_aa' | 'gatt_raw';

interface LightPresetItem {
  id: string;
  code: number;
  titleHe: string;
}

interface EqPresetItem {
  id: string;
  nameHe: string;
  gains: number[];
}

interface LocalSong {
  id: string;
  title: string;
  artist: string;
  url: string;
  durationSec: number;
}

interface ApkMetadataInfo {
  versionName: string;
  versionCode: number;
  architecture: string;
  apkSizeBytes: number;
  zipSizeBytes: number;
  sha256: string;
}

interface GithubReleaseData {
  tagName: string;
  title: string;
  notes: string;
  htmlUrl: string;
  apkUrl: string | null;
  isNewer: boolean;
}

interface GithubDevicePublishState {
  status: 'idle' | 'awaiting_user' | 'publishing' | 'completed' | 'expired' | 'error';
  userCode: string | null;
  verificationUri: string;
  repoUrl: string | null;
  releaseUrl: string | null;
  latestReleaseTag: string | null;
  hasPermanentKey: boolean;
  error: string | null;
}

const LIGHT_PRESETS: LightPresetItem[] = [
  { id: 'neon', code: 0x06, titleHe: 'ניאון' },
  { id: 'rock', code: 0x01, titleHe: 'רוק' },
  { id: 'flow', code: 0x02, titleHe: 'זרימה' },
  { id: 'cross', code: 0x03, titleHe: 'הצלבה' },
  { id: 'ripple', code: 0x04, titleHe: 'אדווה' },
  { id: 'flash', code: 0x05, titleHe: 'הבזק' },
  { id: 'freeze', code: 0x07, titleHe: 'קפיאה' },
];

const SWATCH_COLORS = [
  '#00F0FF',
  '#FF5A1F',
  '#E838FF',
  '#22C55E',
  '#3B82F6',
  '#FACC15',
  '#EF4444',
  '#FFFFFF',
];

const EQ_FREQS = [63, 125, 250, 500, 1000, 4000, 12000];
const EQ_LABELS = ['63Hz', '125Hz', '250Hz', '500Hz', '1kHz', '4kHz', '12kHz'];

const BUILTIN_EQ_PRESETS: EqPresetItem[] = [
  { id: 'jbl_sig', nameHe: 'חתימת JBL', gains: [3.5, 2.5, 0.5, 0.0, 1.5, 2.5, 3.0] },
  { id: 'party', nameHe: 'מסיבה', gains: [5.0, 4.0, 1.0, 0.0, 1.5, 3.5, 4.5] },
  { id: 'deep_bass', nameHe: 'בס עמוק', gains: [6.0, 5.0, 2.0, 0.0, -0.5, 1.0, 2.0] },
  { id: 'vocal', nameHe: 'שירה ודיבור', gains: [-1.5, -0.5, 1.5, 3.5, 4.0, 2.5, 1.0] },
  { id: 'outdoor', nameHe: 'שטח פתוח', gains: [4.5, 3.5, 2.0, 1.0, 2.0, 3.5, 4.0] },
  { id: 'flat', nameHe: 'מאוזן (0dB)', gains: [0, 0, 0, 0, 0, 0, 0] },
];

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return [255, 90, 31];
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  return [r, g, b];
}

function wrapHarmanPacket(cmdId: number, payload: number[]): Uint8Array {
  const frame = new Uint8Array(3 + payload.length + 1);
  frame[0] = 0xaa;
  frame[1] = cmdId & 0xff;
  frame[2] = payload.length & 0xff;
  payload.forEach((b, i) => {
    frame[3 + i] = b & 0xff;
  });
  let xor = 0;
  for (let i = 0; i < frame.length - 1; i++) {
    xor ^= frame[i];
  }
  frame[frame.length - 1] = xor & 0xff;
  return frame;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function isRemoteTagNewer(tag: string): boolean {
  const trimmed = tag.trim();
  const seq = /^v(\d+)$/i.exec(trimmed);
  if (seq) {
    return Number(seq[1]) > BUILD_NUMBER;
  }
  const cleanR = trimmed.replace(/^v/i, '');
  if (cleanR === APP_VERSION) return false;
  const rp = cleanR.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const lp = APP_VERSION.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(rp.length, lp.length); i++) {
    const a = rp[i] || 0;
    const b = lp[i] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<BottomTab>('connect');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Theme Mode: light / dark / system
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('jbl_pb320_theme_native_v1');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore
    }
    return 'system';
  });

  useEffect(() => {
    const applyTheme = () => {
      const prefersDark =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = themeMode === 'dark' || (themeMode === 'system' && prefersDark);
      document.documentElement.classList.toggle('dark', isDark);
    };
    applyTheme();
    try {
      localStorage.setItem('jbl_pb320_theme_native_v1', themeMode);
    } catch {
      // ignore
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (themeMode === 'system') applyTheme();
    };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [themeMode]);

  // BLE Speaker Connection & Telemetry
  const [btConnected, setBtConnected] = useState(false);
  const [btConnecting, setBtConnecting] = useState(false);
  const [speakerName, setSpeakerName] = useState('טרם חוברה בוקסה');
  const [speakerBattery, setSpeakerBattery] = useState<number | null>(null);
  const [speakerFirmware, setSpeakerFirmware] = useState('—');
  const [speakerTransport, setSpeakerTransport] = useState('מנותק');
  const [speakerIdText, setSpeakerIdText] = useState('—');
  const [statusMessage, setStatusMessage] = useState(
    'באנדרואיד מומלץ להתקין את קובץ ה-APK הנייטיב לחיבור מלא ב-BLE + SPP'
  );
  const [txCount, setTxCount] = useState(0);
  const [lastTxHex, setLastTxHex] = useState('—');
  const bleWriteCharRef = useRef<any>(null);
  const bleDeviceRef = useRef<any>(null);

  // Speaker Controls & Lightshow State
  const [volume, setVolume] = useState(75);
  const [bassMode, setBassMode] = useState<BassMode>('deep');
  const [lightEnabled, setLightEnabled] = useState(true);
  const [lightPreset, setLightPreset] = useState<LightPresetItem>(LIGHT_PRESETS[0]);
  const [primaryHex, setPrimaryHex] = useState('#00F0FF');
  const [secondaryHex, setSecondaryHex] = useState('#E838FF');
  const [brightness, setBrightness] = useState(85);
  const [speedTenths, setSpeedTenths] = useState(10);
  const [zoneMask, setZoneMask] = useState(0x1f);
  const [beatSync, setBeatSync] = useState(true);
  const [micVolume, setMicVolume] = useState(65);
  const [micEcho, setMicEcho] = useState(30);

  // Equalizer State
  const [activeEqId, setActiveEqId] = useState('jbl_sig');
  const [eqGains, setEqGains] = useState<number[]>([...BUILTIN_EQ_PRESETS[0].gains]);
  const [customProfiles, setCustomProfiles] = useState<EqPresetItem[]>(() => {
    try {
      const raw = localStorage.getItem('jbl_pb320_custom_eq_v2');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newProfileName, setNewProfileName] = useState('');

  // Speaker System Settings State
  const [feedbackTones, setFeedbackTones] = useState(true);
  const [playtimeBoost, setPlaytimeBoost] = useState(false);
  const [outdoorMode, setOutdoorMode] = useState(false);
  const [autoStandby, setAutoStandby] = useState(true);
  const [startupLights, setStartupLights] = useState(true);
  const [stereoMode, setStereoMode] = useState(0);
  const [protocolMode, setProtocolMode] = useState<ProtocolFraming>('auto');

  // Local Song Player + WebAudio Equalizer Graph
  const [songs, setSongs] = useState<LocalSong[]>([]);
  const [songQuery, setSongQuery] = useState('');
  const [currentSongIdx, setCurrentSongIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Native APK Metadata & GitHub Releases Auto-Update / Publisher
  const [apkMeta, setApkMeta] = useState<ApkMetadataInfo | null>(null);
  const [ghRelease, setGhRelease] = useState<GithubReleaseData | null>(null);
  const [checkingGh, setCheckingGh] = useState(false);
  const [ghCheckError, setGhCheckError] = useState<string | null>(null);
  const [ghPubState, setGhPubState] = useState<GithubDevicePublishState | null>(null);

  useEffect(() => {
    fetch('/api/apk-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setApkMeta(data);
      })
      .catch(() => {});

    fetch('/api/github/device/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setGhPubState(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (
      !ghPubState ||
      (ghPubState.status !== 'awaiting_user' && ghPubState.status !== 'publishing')
    ) {
      return;
    }
    const timer = setInterval(() => {
      fetch('/api/github/device/sync', { method: 'POST' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setGhPubState(d);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [ghPubState]);

  const sendPacket = useCallback(async (packet: Uint8Array) => {
    const hex = bytesToHex(packet);
    setTxCount((c) => c + 1);
    setLastTxHex(hex);
    const ch = bleWriteCharRef.current;
    if (ch) {
      try {
        if (ch.writeValueWithoutResponse) {
          await ch.writeValueWithoutResponse(packet);
        } else {
          await ch.writeValue(packet);
        }
      } catch {
        // ignore BLE transient error
      }
    }
  }, []);

  const transmitLightshow = useCallback(
    (overrides?: Partial<{
      enabled: boolean;
      preset: LightPresetItem;
      mask: number;
      bright: number;
      spd: number;
      pHex: string;
      sHex: string;
      beat: boolean;
      proto: ProtocolFraming;
    }>) => {
      const en = overrides?.enabled ?? lightEnabled;
      const pr = overrides?.preset ?? lightPreset;
      const m = overrides?.mask ?? zoneMask;
      const br = overrides?.bright ?? brightness;
      const sp = overrides?.spd ?? speedTenths;
      const p1 = overrides?.pHex ?? primaryHex;
      const p2 = overrides?.sHex ?? secondaryHex;
      const bs = overrides?.beat ?? beatSync;
      const pm = overrides?.proto ?? protocolMode;

      const [r1, g1, b1] = parseHexRgb(p1);
      const [r2, g2, b2] = parseHexRgb(p2);
      const payload = [
        en ? 1 : 0,
        pr.code,
        m & 0x1f,
        br,
        sp,
        35,
        r1,
        g1,
        b1,
        r2,
        g2,
        b2,
        bs ? 1 : 0,
      ];
      const bytes =
        pm === 'gatt_raw'
          ? new Uint8Array(payload)
          : wrapHarmanPacket(0x31, payload);
      sendPacket(bytes);
    },
    [
      beatSync,
      brightness,
      lightEnabled,
      lightPreset,
      primaryHex,
      protocolMode,
      secondaryHex,
      sendPacket,
      speedTenths,
      zoneMask,
    ]
  );

  const transmitEqualizer = useCallback(
    (gains: number[], bass: BassMode, outdoor: boolean) => {
      const bassCode = bass === 'off' ? 0 : bass === 'deep' ? 1 : 2;
      const payload = [
        ...gains.slice(0, 7).map((g) => Math.round(Math.max(-6, Math.min(6, g)) * 10) & 0xff),
        bassCode,
        outdoor ? 1 : 0,
      ];
      sendPacket(wrapHarmanPacket(0x32, payload));
    },
    [sendPacket]
  );

  const transmitSpeakerSettings = useCallback(
    (
      tones: boolean,
      boost: boolean,
      standby: boolean,
      startup: boolean,
      stereo: number
    ) => {
      sendPacket(
        wrapHarmanPacket(0x33, [
          tones ? 1 : 0,
          boost ? 1 : 0,
          standby ? 1 : 0,
          startup ? 1 : 0,
          stereo & 0xff,
        ])
      );
    },
    [sendPacket]
  );

  // Sync WebAudio filters & volume
  useEffect(() => {
    if (audioElRef.current) {
      audioElRef.current.volume = Math.max(0, Math.min(1, volume / 100));
    }
  }, [volume]);

  useEffect(() => {
    eqFiltersRef.current.forEach((f, idx) => {
      const base = eqGains[idx] ?? 0;
      const bassExtra =
        idx <= 1 ? (bassMode === 'deep' ? 2.5 : bassMode === 'punchy' ? 1.5 : 0) : 0;
      f.gain.value = base + bassExtra;
    });
  }, [eqGains, bassMode]);

  const ensureAudioGraph = useCallback(() => {
    if (audioCtxRef.current || !audioElRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      const source = ctx.createMediaElementSource(audioElRef.current);
      const filters = EQ_FREQS.map((freq, idx) => {
        const f = ctx.createBiquadFilter();
        f.type = idx === 0 ? 'lowshelf' : idx === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        f.frequency.value = freq;
        f.Q.value = 1.1;
        f.gain.value = eqGains[idx] ?? 0;
        return f;
      });
      let prev: AudioNode = source;
      for (const f of filters) {
        prev.connect(f);
        prev = f;
      }
      prev.connect(ctx.destination);
      audioCtxRef.current = ctx;
      eqFiltersRef.current = filters;
    } catch {
      // ignore if already bound
    }
  }, [eqGains]);

  const connectWebBluetooth = async () => {
    const navBt = (navigator as any).bluetooth;
    if (!navBt) {
      setStatusMessage(
        'הדפדפן הנוכחי אינו תומך ב-Web Bluetooth — הורד והתקן את קובץ ה-APK הנייטיב לאנדרואיד לחיבור ישיר'
      );
      return;
    }
    try {
      setBtConnecting(true);
      setStatusMessage('מחפש רמקול JBL PartyBox 320...');
      const dev = await navBt.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          'battery_service',
          'device_information',
          0xfddf,
          '65786365-6c70-6f69-6e74-2e636f6d0000',
          0xffe0,
          0xfff0,
        ],
      });
      bleDeviceRef.current = dev;
      const server = await dev.gatt.connect();
      setBtConnected(true);
      setBtConnecting(false);
      setSpeakerName(dev.name || 'JBL PartyBox 320');
      setSpeakerIdText(dev.id ? String(dev.id).slice(0, 17) : 'BLE Active');
      setSpeakerTransport('BLE GATT ישיר');

      // Read Battery if exposed
      try {
        const batSvc = await server.getPrimaryService('battery_service');
        const batChar = await batSvc.getCharacteristic('battery_level');
        const val = await batChar.readValue();
        setSpeakerBattery(val.getUint8(0));
      } catch {
        // battery optional on some firmwares
      }

      // Read Firmware if exposed
      try {
        const infoSvc = await server.getPrimaryService('device_information');
        const fwChar = await infoSvc.getCharacteristic('firmware_revision_string');
        const val = await fwChar.readValue();
        const dec = new TextDecoder().decode(val.buffer).trim();
        if (dec) setSpeakerFirmware(dec);
      } catch {
        setSpeakerFirmware('Harman GATT v3.2');
      }

      // Discover writable characteristic
      try {
        const services = await server.getPrimaryServices();
        for (const s of services) {
          const chars = await s.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) {
              bleWriteCharRef.current = c;
              break;
            }
          }
          if (bleWriteCharRef.current) break;
        }
      } catch {
        // ignore
      }

      setStatusMessage('מחובר לבוקסה בהצלחה');
      dev.addEventListener('gattserverdisconnected', () => {
        setBtConnected(false);
        setSpeakerTransport('מנותק');
        setStatusMessage('החיבור לבוקסה נותק');
        bleWriteCharRef.current = null;
      });
    } catch (e: any) {
      setBtConnecting(false);
      setStatusMessage(
        e?.message ? `החיבור בוטל או נכשל: ${e.message}` : 'סריקת הבלוטוס בוטלה'
      );
    }
  };

  const disconnectSpeaker = () => {
    try {
      bleDeviceRef.current?.gatt?.disconnect();
    } catch {
      // ignore
    }
    bleWriteCharRef.current = null;
    setBtConnected(false);
    setSpeakerTransport('מנותק');
    setStatusMessage('נותק מהבוקסה');
  };

  const checkGithubLatestRelease = async () => {
    setCheckingGh(true);
    setGhCheckError(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) {
        throw new Error(`קוד תשובה ${res.status} מ-GitHub`);
      }
      const json = await res.json();
      const tag = String(json.tag_name || '');
      const assets = Array.isArray(json.assets) ? json.assets : [];
      const apkAsset = assets.find((a: any) =>
        String(a?.name || '').toLowerCase().endsWith('.apk')
      );
      setGhRelease({
        tagName: tag,
        title: String(json.name || tag),
        notes: String(json.body || ''),
        htmlUrl: String(
          json.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`
        ),
        apkUrl: apkAsset?.browser_download_url || null,
        isNewer: isRemoteTagNewer(tag),
      });
    } catch (err: any) {
      setGhCheckError(err?.message || 'שגיאה בבדיקת Releases ב-GitHub');
    } finally {
      setCheckingGh(false);
    }
  };

  const triggerPublishToGithub = async () => {
    try {
      const endpoint = ghPubState?.hasPermanentKey
        ? '/api/github/push-update'
        : '/api/github/device/start';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName: 'jbl-partybox-320-hebrew', isPrivate: false }),
      });
      const data = await res.json();
      setGhPubState(data);
    } catch {
      // ignore
    }
  };

  const filteredSongs = useMemo(() => {
    const q = songQuery.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [songs, songQuery]);

  const currentSong = filteredSongs[currentSongIdx] || null;

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const added: LocalSong[] = Array.from(fileList).map((f, i) => ({
      id: `local_${Date.now()}_${i}`,
      title: f.name.replace(/\.[^/.]+$/, ''),
      artist: 'קובץ מקומי במכשיר',
      url: URL.createObjectURL(f),
      durationSec: 0,
    }));
    setSongs((prev) => {
      const merged = [...added, ...prev];
      return merged;
    });
    if (currentSongIdx === -1 && added.length > 0) {
      setTimeout(() => playSongAt(0, [...added, ...songs]), 50);
    }
    e.target.value = '';
  };

  const playSongAt = (idx: number, listOverride?: LocalSong[]) => {
    const list = listOverride || filteredSongs;
    const target = list[idx];
    if (!target || !audioElRef.current) return;
    ensureAudioGraph();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    setCurrentSongIdx(idx);
    audioElRef.current.src = target.url;
    audioElRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  const togglePlayPause = () => {
    const el = audioElRef.current;
    if (!el) return;
    if (!currentSong && filteredSongs.length > 0) {
      playSongAt(0);
      return;
    }
    ensureAudioGraph();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    if (el.paused) {
      el.play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const playNext = () => {
    if (filteredSongs.length === 0) return;
    playSongAt((currentSongIdx + 1) % filteredSongs.length);
  };

  const playPrev = () => {
    if (filteredSongs.length === 0) return;
    playSongAt(currentSongIdx <= 0 ? filteredSongs.length - 1 : currentSongIdx - 1);
  };

  const saveCustomEq = () => {
    const clean = newProfileName.trim() || `פרופיל אישי ${customProfiles.length + 1}`;
    const item: EqPresetItem = {
      id: `custom_${Date.now()}`,
      nameHe: clean,
      gains: [...eqGains],
    };
    const updated = [item, ...customProfiles].slice(0, 8);
    setCustomProfiles(updated);
    setActiveEqId(item.id);
    setNewProfileName('');
    try {
      localStorage.setItem('jbl_pb320_custom_eq_v2', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  return (
    <div dir="rtl" className="min-h-dvh flex flex-col bg-[#F6F7F9] dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      <audio
        ref={audioElRef}
        onTimeUpdate={(e) => setCurrentTimeSec(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDurationSec(e.currentTarget.duration || 0)}
        onEnded={playNext}
        className="hidden"
      />

      {/* TOP HEADER BAR — Right: Settings, Center: Title, Left: About */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 dark:bg-[#131A26]/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-5xl mx-auto h-full px-3 sm:px-5 flex items-center justify-between gap-2">
          {/* Right Slot (Start in RTL): Settings Button */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="הגדרות האפליקציה"
            className="min-h-[42px] min-w-[42px] px-2.5 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700/80 flex items-center justify-center gap-2 text-slate-800 dark:text-slate-100 hover:border-orange-500 transition-colors cursor-pointer"
          >
            <SvgSettings className="w-5 h-5" />
            <span className="hidden sm:inline text-xs font-semibold">הגדרות</span>
          </button>

          {/* Center Slot: Speaker Title & Live Status */}
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                btConnected ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
            <h1 className="text-base sm:text-lg font-bold tracking-tight truncate">
              JBL PartyBox 320
            </h1>
          </div>

          {/* Left Slot (End in RTL): About Button ('אודות') */}
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="min-h-[42px] px-3 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700/80 flex items-center gap-1.5 text-slate-800 dark:text-slate-100 hover:border-orange-500 transition-colors cursor-pointer"
          >
            <SvgInfo className="w-4 h-4" />
            <span className="text-xs font-semibold">אודות</span>
          </button>
        </div>
      </header>

      {/* MAIN BODY SCREENS */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-3 sm:px-5 pt-4 pb-safe-nav">
        {/* TAB 1 (Rightmost): חיבור ופרטי בוקסה */}
        {activeTab === 'connect' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Speaker Connection & Details Card */}
            <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-base font-bold">חיבור ופרטי בוקסה</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    שם הרמקול, אחוז סוללה, גרסת קושחה וערוץ תקשורת
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {btConnected ? 'מחובר' : btConnecting ? 'מתחבר...' : 'מנותק'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] border border-slate-200/70 dark:border-slate-700/60 mb-4">
                <div className="text-lg font-bold">{speakerName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {statusMessage}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 mb-4">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536]">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">סוללה</div>
                  <div className="text-sm font-bold mt-1">
                    {speakerBattery !== null ? `${speakerBattery}%` : 'לא זמין'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536]">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    גרסת קושחה / פרוטוקול
                  </div>
                  <div className="text-sm font-bold mt-1">{speakerFirmware}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536]">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">ערוץ חיבור</div>
                  <div className="text-sm font-bold mt-1">{speakerTransport}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536]">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">מזהה התקן</div>
                  <div className="text-sm font-bold font-mono mt-1 truncate">
                    {speakerIdText}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={connectWebBluetooth}
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <SvgRefresh className="w-4 h-4" />
                  <span>סרוק וחבר בוקסה</span>
                </button>
                <button
                  type="button"
                  onClick={disconnectSpeaker}
                  className="min-h-[46px] px-4 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-sm font-semibold hover:border-slate-400 transition-colors cursor-pointer"
                >
                  נתק
                </button>
              </div>
            </section>

            {/* Native Android APK Download & GitHub Releases Publisher Card */}
            <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col justify-between">
              <div>
                <h2 className="text-base font-bold">אפליקציית Native Android (APK)</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  גרסה {apkMeta?.versionName || APP_VERSION} (Build {apkMeta?.versionCode || BUILD_NUMBER}) — כתובה ב-100%{' '}
                  <strong className="text-slate-800 dark:text-slate-200">
                    Native Java 17 ללא WebView
                  </strong>{' '}
                  לביצועים מיידיים, כל האייקונים ב-SVG, ועדכון אוטומטי מ-GitHub Releases.
                </p>

                <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536] text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">חבילה:</span>
                    <span className="font-mono">com.jblpartybox320.hebrewcontrol</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">גודל APK נייטיב:</span>
                    <span className="font-mono">
                      {apkMeta ? `${Math.round(apkMeta.apkSizeBytes / 1024)} KB` : 'מוכן להורדה'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <a
                  href="/JBL-PartyBox-320-HE.apk"
                  download="JBL-PartyBox-320-HE.apk"
                  className="w-full min-h-[46px] px-4 rounded-xl bg-slate-900 dark:bg-orange-600 text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity"
                >
                  <SvgDownload className="w-4 h-4" />
                  <span>הורד Native APK לאנדרואיד (v{APP_VERSION})</span>
                </a>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href="/JBL-PartyBox-320-HE-APK.zip"
                    download="JBL-PartyBox-320-HE-APK.zip"
                    className="min-h-[42px] px-3 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <SvgDownload className="w-3.5 h-3.5" />
                    <span>ארכיון APK + מדריך</span>
                  </a>
                  <a
                    href="/JBL-PartyBox-320-Native-Source.zip"
                    download="JBL-PartyBox-320-Native-Source.zip"
                    className="min-h-[42px] px-3 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <SvgFolder className="w-3.5 h-3.5" />
                    <span>קוד מקור Native מלא</span>
                  </a>
                </div>

                <button
                  type="button"
                  onClick={triggerPublishToGithub}
                  className="w-full min-h-[42px] px-3 rounded-xl bg-orange-50 dark:bg-[#2B1B17] border border-orange-500/70 text-orange-700 dark:text-orange-300 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer hover:bg-orange-100 dark:hover:bg-[#38221C] transition-colors"
                >
                  <SvgGithub className="w-4 h-4" />
                  <span>דחוף קוד Native + פרסם Release v5 ל-GitHub</span>
                </button>

                {ghPubState && ghPubState.status !== 'idle' && (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs space-y-2">
                    {ghPubState.status === 'awaiting_user' && ghPubState.userCode && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>קוד אישור חד-פעמי לדחיפה למאגר שלך:</span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(ghPubState.userCode || '');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#131A26] border border-slate-300 dark:border-slate-600 font-mono text-sm font-bold text-orange-600 dark:text-orange-400 cursor-pointer"
                            dir="ltr"
                          >
                            {ghPubState.userCode}
                          </button>
                        </div>
                        <a
                          href={ghPubState.verificationUri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full min-h-[38px] rounded-lg bg-orange-600 text-white font-bold flex items-center justify-center"
                        >
                          פתח את GitHub להדבקת הקוד ואישור הדחיפה
                        </a>
                      </div>
                    )}
                    {ghPubState.status === 'publishing' && (
                      <div className="font-semibold text-orange-600 dark:text-orange-400">
                        דוחף את כל קוד ה-Native, ה-CI ומעלה את Release v5 ל-GitHub...
                      </div>
                    )}
                    {ghPubState.status === 'completed' && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          נדחף ופורסם בהצלחה ({ghPubState.latestReleaseTag})!
                        </span>
                        {ghPubState.releaseUrl && (
                          <a
                            href={ghPubState.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-orange-600 dark:text-orange-400 font-bold"
                          >
                            צפה ב-Release ב-GitHub
                          </a>
                        )}
                      </div>
                    )}
                    {ghPubState.error && (
                      <div className="text-red-600 dark:text-red-400">{ghPubState.error}</div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: שליטה ותאורה בבוקסה */}
        {activeTab === 'control' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <section className="lg:col-span-5 space-y-4">
              {/* Volume & Bass Boost */}
              <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                <h2 className="text-base font-bold mb-1">עוצמת שמע והדגשת בס</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  שליטה מהירה בעוצמה הראשית ובמצב Bass Boost
                </p>

                <div className="mb-4">
                  <div className="flex justify-between text-xs font-semibold mb-1.5">
                    <span>עוצמה ראשית</span>
                    <span className="text-orange-600 dark:text-orange-400">{volume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full jbl-slider"
                  />
                </div>

                <div className="text-xs font-semibold mb-2">מצב Bass Boost</div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['off', 'כבוי'],
                      ['deep', 'עמוק (Deep)'],
                      ['punchy', 'חד (Punchy)'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setBassMode(id);
                        transmitEqualizer(eqGains, id, outdoorMode);
                      }}
                      className={`min-h-[42px] rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                        bassMode === id
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mic & Guitar */}
              <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                <h2 className="text-base font-bold mb-3">כניסת מיקרופון וגיטרה</h2>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span>עוצמת מיקרופון</span>
                      <span className="text-orange-600 dark:text-orange-400">{micVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={micVolume}
                      onChange={(e) => setMicVolume(Number(e.target.value))}
                      className="w-full jbl-slider"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span>אפקט הד (Echo)</span>
                      <span className="text-orange-600 dark:text-orange-400">{micEcho}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={micEcho}
                      onChange={(e) => setMicEcho(Number(e.target.value))}
                      className="w-full jbl-slider"
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* Lightshow Control Card */}
            <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold">תאורת מופע בבוקסה (Lightshow)</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    החלפת דפוסי תאורה, צבעים ו-5 אזורי LED ברמקול
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !lightEnabled;
                    setLightEnabled(next);
                    transmitLightshow({ enabled: next });
                  }}
                  className={`min-h-[38px] px-3.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                    lightEnabled
                      ? 'bg-orange-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {lightEnabled ? 'פעיל' : 'כבוי'}
                </button>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mb-4">
                {LIGHT_PRESETS.map((p) => {
                  const active = lightPreset.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setLightPreset(p);
                        const nextPrimary = p.id === 'neon' ? '#00F0FF' : primaryHex;
                        const nextSecondary = p.id === 'neon' ? '#E838FF' : secondaryHex;
                        if (p.id === 'neon') {
                          setPrimaryHex(nextPrimary);
                          setSecondaryHex(nextSecondary);
                        }
                        transmitLightshow({
                          preset: p,
                          pHex: nextPrimary,
                          sHex: nextSecondary,
                        });
                      }}
                      className={`min-h-[40px] rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                        active
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {p.titleHe}
                    </button>
                  );
                })}
              </div>

              <div className="text-xs font-semibold mb-2">צבע תאורה ראשי</div>
              <div className="flex flex-wrap items-center gap-2.5 mb-4">
                {SWATCH_COLORS.map((hex) => {
                  const selected = primaryHex.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`צבע ${hex}`}
                      onClick={() => {
                        setPrimaryHex(hex);
                        transmitLightshow({ pHex: hex });
                      }}
                      style={{ backgroundColor: hex }}
                      className={`w-8 h-8 rounded-full cursor-pointer transition-transform ${
                        selected
                          ? 'scale-110 ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-[#131A26]'
                          : 'border border-slate-300 dark:border-slate-600'
                      }`}
                    />
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span>בהירות תאורה</span>
                    <span className="text-orange-600 dark:text-orange-400">{brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={brightness}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBrightness(v);
                      transmitLightshow({ bright: v });
                    }}
                    className="w-full jbl-slider"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span>מהירות תנועה</span>
                    <span className="text-orange-600 dark:text-orange-400">
                      {(speedTenths / 10).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={20}
                    value={speedTenths}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setSpeedTenths(v);
                      transmitLightshow({ spd: v });
                    }}
                    className="w-full jbl-slider"
                  />
                </div>
              </div>

              <div className="text-xs font-semibold mb-2">אזורי LED בבוקסה</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  [0, 'טבעות וופרים'],
                  [1, 'סטרוב עליון'],
                  [2, 'סטרוב תחתון'],
                  [3, 'נצנוץ כוכבים'],
                  [4, 'פסי צד'],
                ].map(([bit, label]) => {
                  const b = bit as number;
                  const active = (zoneMask & (1 << b)) !== 0;
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        const nextMask = active ? zoneMask & ~(1 << b) : zoneMask | (1 << b);
                        setZoneMask(nextMask);
                        transmitLightshow({ mask: nextMask });
                      }}
                      className={`min-h-[40px] px-3 rounded-xl text-xs font-medium border text-right flex items-center justify-between cursor-pointer ${
                        active
                          ? 'bg-orange-50 dark:bg-[#2B1B17] border-orange-500 text-orange-700 dark:text-orange-300'
                          : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <span>{label as string}</span>
                      <span className="text-[11px] font-bold">{active ? 'פעיל' : 'כבוי'}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    const next = !beatSync;
                    setBeatSync(next);
                    transmitLightshow({ beat: next });
                  }}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-medium border text-right flex items-center justify-between cursor-pointer ${
                    beatSync
                      ? 'bg-orange-50 dark:bg-[#2B1B17] border-orange-500 text-orange-700 dark:text-orange-300'
                      : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span>סנכרון קצב</span>
                  <span className="text-[11px] font-bold">{beatSync ? 'פעיל' : 'כבוי'}</span>
                </button>
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: איקוולייזר */}
        {activeTab === 'eq' && (
          <div className="space-y-4">
            <section className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-base font-bold">איקוולייזר 7 ערוצים</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    כיוון מדויק של תדרי הבס, המיד והגבוהים (-6dB עד +6dB)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const flat = BUILTIN_EQ_PRESETS[BUILTIN_EQ_PRESETS.length - 1];
                    setActiveEqId(flat.id);
                    setEqGains([...flat.gains]);
                    transmitEqualizer(flat.gains, bassMode, outdoorMode);
                  }}
                  className="min-h-[38px] px-3 rounded-xl bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                >
                  איפוס (0dB)
                </button>
              </div>

              <div className="flex flex-wrap gap-2 mb-5">
                {[...BUILTIN_EQ_PRESETS, ...customProfiles].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setActiveEqId(preset.id);
                      setEqGains([...preset.gains]);
                      transmitEqualizer(preset.gains, bassMode, outdoorMode);
                    }}
                    className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold border cursor-pointer transition-colors ${
                      activeEqId === preset.id
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {preset.nameHe}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {EQ_LABELS.map((label, idx) => {
                  const val = eqGains[idx] ?? 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-xs font-semibold mb-1">
                        <span>{label}</span>
                        <span className="font-mono text-orange-600 dark:text-orange-400">
                          {val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1)} dB
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-6}
                        max={6}
                        step={0.5}
                        value={val}
                        onChange={(e) => {
                          const db = Number(e.target.value);
                          const next = [...eqGains];
                          next[idx] = db;
                          setEqGains(next);
                          setActiveEqId('custom');
                          transmitEqualizer(next, bassMode, outdoorMode);
                        }}
                        className="w-full jbl-slider"
                      />
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="שם לפרופיל אישי חדש..."
                  className="flex-1 min-h-[42px] px-3 rounded-xl bg-slate-50 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  onClick={saveCustomEq}
                  className="min-h-[42px] px-4 rounded-xl bg-orange-600 text-white text-xs font-bold cursor-pointer"
                >
                  שמור פרופיל אישי
                </button>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: בחירת שירים ונגן */}
        {activeTab === 'songs' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <section className="lg:col-span-5 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <h2 className="text-base font-bold mb-1">נגן ושליטה בשירים</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                באפליקציית ה-Native נטענים אוטומטית כל שירי המכשיר דרך MediaStore
              </p>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] mb-4">
                <div className="text-sm font-bold truncate">
                  {currentSong ? currentSong.title : 'לא נבחר שיר'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {currentSong ? currentSong.artist : 'בחר קובצי שמע מהמכשיר לניגון מיידי'}
                </div>
              </div>

              <div className="mb-4">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, Math.floor(durationSec))}
                  value={Math.floor(currentTimeSec)}
                  onChange={(e) => {
                    const sec = Number(e.target.value);
                    if (audioElRef.current) {
                      audioElRef.current.currentTime = sec;
                      setCurrentTimeSec(sec);
                    }
                  }}
                  className="w-full jbl-slider"
                />
                <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                  <span>{formatDuration(currentTimeSec)}</span>
                  <span>{formatDuration(durationSec)}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={playPrev}
                  aria-label="הקודם"
                  className="w-11 h-11 rounded-full bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  <SvgNext className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'השהה' : 'נגן'}
                  className="w-13 h-13 rounded-full bg-orange-600 text-white flex items-center justify-center cursor-pointer"
                >
                  {isPlaying ? <SvgPause className="w-5 h-5" /> : <SvgPlay className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={playNext}
                  aria-label="הבא"
                  className="w-11 h-11 rounded-full bg-slate-100 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer"
                >
                  <SvgPrev className="w-4 h-4" />
                </button>
              </div>
            </section>

            <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-base font-bold">רשימת שירים ({filteredSongs.length})</h2>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  onChange={handleFilesSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[40px] px-3.5 rounded-xl bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <SvgFolder className="w-4 h-4" />
                  <span>בחר שירים מהמכשיר</span>
                </button>
              </div>

              <input
                type="text"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="חיפוש שיר ברשימה..."
                className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs mb-3 outline-none focus:border-orange-500"
              />

              {filteredSongs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  טרם נבחרו שירים בתצוגת הדפדפן. לחץ על ״בחר שירים מהמכשיר״ לניגון מקומי מיידי.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {filteredSongs.map((s, idx) => {
                    const active = idx === currentSongIdx;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => playSongAt(idx)}
                        className={`w-full p-2.5 rounded-xl text-right flex items-center justify-between gap-2 border cursor-pointer ${
                          active
                            ? 'bg-orange-50 dark:bg-[#2B1B17] border-orange-500 text-orange-700 dark:text-orange-300'
                            : 'bg-slate-50 dark:bg-[#1C2536] border-transparent hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{s.title}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {s.artist}
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold shrink-0">
                          {active && isPlaying ? 'מנגן' : 'נגן'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 5 (Leftmost): הגדרות הבוקסה */}
        {activeTab === 'speaker' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <section className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-2">
              <h2 className="text-base font-bold">הגדרות חומרה וצלילי הבוקסה</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                שליטה בצלילי חיווי ההדלקה/חיבור של הרמקול, חיסכון בסוללה ומצב אקוסטי
              </p>

              {[
                {
                  label: 'צלילי חיווי מערכת בבוקסה (הדלקה / חיבור BT)',
                  val: feedbackTones,
                  set: (v: boolean) => {
                    setFeedbackTones(v);
                    transmitSpeakerSettings(
                      v,
                      playtimeBoost,
                      autoStandby,
                      startupLights,
                      stereoMode
                    );
                  },
                },
                {
                  label: 'Playtime Boost (הארכת חיי סוללה בבוקסה)',
                  val: playtimeBoost,
                  set: (v: boolean) => {
                    setPlaytimeBoost(v);
                    transmitSpeakerSettings(
                      feedbackTones,
                      v,
                      autoStandby,
                      startupLights,
                      stereoMode
                    );
                  },
                },
                {
                  label: 'התאמה אקוסטית לשטח פתוח (Outdoor Mode)',
                  val: outdoorMode,
                  set: (v: boolean) => {
                    setOutdoorMode(v);
                    transmitEqualizer(eqGains, bassMode, v);
                  },
                },
                {
                  label: 'המתנה אוטומטית (Auto-Standby לאחר 20 דק׳)',
                  val: autoStandby,
                  set: (v: boolean) => {
                    setAutoStandby(v);
                    transmitSpeakerSettings(
                      feedbackTones,
                      playtimeBoost,
                      v,
                      startupLights,
                      stereoMode
                    );
                  },
                },
                {
                  label: 'הדלקת תאורת מופע בעת הפעלת הבוקסה',
                  val: startupLights,
                  set: (v: boolean) => {
                    setStartupLights(v);
                    transmitSpeakerSettings(
                      feedbackTones,
                      playtimeBoost,
                      autoStandby,
                      v,
                      stereoMode
                    );
                  },
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="min-h-[44px] py-1.5 flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-b-0"
                >
                  <span className="text-xs font-medium">{row.label}</span>
                  <button
                    type="button"
                    onClick={() => row.set(!row.val)}
                    className={`min-w-[56px] min-h-[32px] px-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      row.val
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {row.val ? 'פעיל' : 'כבוי'}
                  </button>
                </div>
              ))}
            </section>

            <section className="lg:col-span-5 space-y-4">
              {/* Speaker Tone Triggers & Stereo */}
              <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                <h2 className="text-base font-bold mb-2">בדיקת צלילים ומצב רמקולים</h2>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    [1, 'צליל חיבור'],
                    [2, 'צופר מסיבה'],
                    [3, 'פולס בס'],
                  ].map(([code, name]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => sendPacket(wrapHarmanPacket(0x34, [code as number]))}
                      className="min-h-[40px] rounded-xl bg-slate-50 dark:bg-[#1C2536] border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:border-orange-500 cursor-pointer"
                    >
                      {name}
                    </button>
                  ))}
                </div>

                <div className="text-xs font-semibold mb-2">מצב סטריאו / Auracast</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    [0, 'יחיד'],
                    [1, 'סטריאו ימין'],
                    [2, 'סטריאו שמאל'],
                    [3, 'Auracast'],
                  ].map(([code, label]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        const c = code as number;
                        setStereoMode(c);
                        transmitSpeakerSettings(
                          feedbackTones,
                          playtimeBoost,
                          autoStandby,
                          startupLights,
                          c
                        );
                      }}
                      className={`min-h-[38px] rounded-xl text-xs font-semibold border cursor-pointer ${
                        stereoMode === code
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Protocol Framing & TX Hex */}
              <div className="rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5">
                <h2 className="text-base font-bold mb-2">פרוטוקול שידור לבוקסה</h2>
                <div className="space-y-1.5 mb-3">
                  {(
                    [
                      ['auto', 'אוטומטי כפול (BLE + SPP)'],
                      ['harman_aa', 'מסגרת Harman 0xAA'],
                      ['gatt_raw', 'פקודת GATT ישירה'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setProtocolMode(id);
                        transmitLightshow({ proto: id });
                      }}
                      className={`w-full min-h-[38px] px-3 rounded-xl text-xs font-semibold text-right border cursor-pointer ${
                        protocolMode === id
                          ? 'bg-orange-600 text-white border-orange-600'
                          : 'bg-slate-50 dark:bg-[#1C2536] border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                  TX ({txCount}): {lastTxHex}
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* FIXED BOTTOM NAVIGATION BAR (RTL order from Right to Left!) */}
      <nav
        aria-label="ניווט ראשי"
        className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#131A26]/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 nav-safe-bottom"
      >
        <div className="max-w-5xl mx-auto grid grid-cols-5 h-16">
          {(
            [
              { id: 'connect', label: 'חיבור', Icon: SvgSpeakerBt },
              { id: 'control', label: 'שליטה', Icon: SvgLightControls },
              { id: 'eq', label: 'איקוולייזר', Icon: SvgEqualizer },
              { id: 'songs', label: 'שירים', Icon: SvgMusic },
              { id: 'speaker', label: 'הבוקסה', Icon: SvgSpeakerTune },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`relative flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors ${
                  active
                    ? 'text-orange-600 dark:text-orange-400 font-bold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {active && (
                  <span className="absolute top-0 w-7 h-0.5 rounded-full bg-orange-600 dark:bg-orange-400" />
                )}
                <Icon className="w-5 h-5" />
                <span className="text-[11px] leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* SETTINGS MODAL (Opened from Top-Right Gear Icon) */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="w-full max-w-lg max-h-[88dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SvgSettings className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                <h2 className="text-base font-bold">הגדרות האפליקציה</h2>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="סגור הגדרות"
                className="min-h-[38px] min-w-[38px] rounded-xl bg-slate-100 dark:bg-[#1C2536] flex items-center justify-center cursor-pointer"
              >
                <SvgClose className="w-4 h-4" />
              </button>
            </div>

            {/* 1. Theme Mode: Light / Dark / System */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] space-y-2.5">
              <div className="text-xs font-bold">מצב תצוגה (בהיר / כהה / מערכת)</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'light', label: 'בהיר', Icon: SvgSun },
                    { id: 'dark', label: 'כהה', Icon: SvgMoon },
                    { id: 'system', label: 'מערכת', Icon: SvgSystemTheme },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemeMode(id)}
                    className={`min-h-[40px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 border cursor-pointer ${
                      themeMode === id
                        ? 'bg-orange-600 text-white border-orange-600'
                        : 'bg-white dark:bg-[#131A26] border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 2. GitHub Releases Auto-Update (By Tag) */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  עדכון אוטומטי מ-GitHub Releases (לפי תג)
                </span>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  מותקן: v{BUILD_NUMBER} ({APP_VERSION})
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                באפליקציית ה-Native האנדרואידית כפתור זה מוריד את ה-APK העדכני מ-Releases ופותח ישירות את מתקין החבילות של אנדרואיד.
              </p>

              <button
                type="button"
                onClick={checkGithubLatestRelease}
                disabled={checkingGh}
                className="w-full min-h-[42px] rounded-xl bg-orange-600 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <SvgRefresh className="w-4 h-4" />
                <span>{checkingGh ? 'בודק מול GitHub...' : 'בדוק תג גרסה אחרון ב-GitHub'}</span>
              </button>

              {ghCheckError && (
                <div className="text-xs text-red-600 dark:text-red-400">{ghCheckError}</div>
              )}

              {ghRelease && (
                <div className="p-3 rounded-xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
                  <div className="font-bold">
                    {ghRelease.isNewer
                      ? `נמצאה גרסה חדשה: ${ghRelease.tagName}`
                      : `הגרסה מעודכנת (תג אחרון ב-GitHub: ${ghRelease.tagName})`}
                  </div>
                  {ghRelease.notes && (
                    <div className="text-slate-500 dark:text-slate-400 whitespace-pre-line line-clamp-4">
                      {ghRelease.notes}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    {ghRelease.apkUrl && (
                      <a
                        href={ghRelease.apkUrl}
                        className="flex-1 min-h-[38px] rounded-lg bg-orange-600 text-white font-bold flex items-center justify-center gap-1.5"
                      >
                        <SvgDownload className="w-3.5 h-3.5" />
                        <span>הורד APK מה-Release</span>
                      </a>
                    )}
                    <a
                      href={ghRelease.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[38px] px-3 rounded-lg bg-slate-100 dark:bg-[#1C2536] font-semibold flex items-center justify-center"
                    >
                      דף ה-Release
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* 3. User Guide & Detailed App Overview */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] space-y-2 text-xs leading-relaxed">
              <div className="font-bold text-sm">מדריך שימוש ופירוט על האפליקציה</div>
              <div>
                <strong className="text-orange-600 dark:text-orange-400">
                  1. אפליקציית Native אמיתית (Java 17):
                </strong>{' '}
                קובץ ה-APK החדש בנוי ב-100% Native Android ללא WebView וללא דפי HTML, במשקל ~70KB בלבד, להזנקה מיידית וביצועים חלקים.
              </div>
              <div>
                <strong className="text-orange-600 dark:text-orange-400">
                  2. חיבור לבוקסה (לשונית ימנית):
                </strong>{' '}
                הדלק את ה-JBL PartyBox 320 ולחץ על ״סרוק וחבר בוקסה״ לקבלת חיווי סוללה, קושחה ושליטה מלאה ב-BLE GATT + RFCOMM SPP.
              </div>
              <div>
                <strong className="text-orange-600 dark:text-orange-400">
                  3. שליטה, איקוולייזר, שירים והגדרות בוקסה:
                </strong>{' '}
                עבור במהירות דרך הסרגל התחתון בין החלפת תאורה (כולל ניאון) ובס, איקוולייזר 7 תדרים חומרתי, בחירת שירים מהמכשיר והגדרות צלילי המערכת של הבוקסה.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABOUT MODAL (Opened from Top-Left 'אודות' Button) */}
      {aboutOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-2xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SvgInfo className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                <h2 className="text-base font-bold">אודות</h2>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                aria-label="סגור אודות"
                className="min-h-[38px] min-w-[38px] rounded-xl bg-slate-100 dark:bg-[#1C2536] flex items-center justify-center cursor-pointer"
              >
                <SvgClose className="w-4 h-4" />
              </button>
            </div>

            {/* Developer Credit ("אש התורה") */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1C2536] space-y-2">
              <div className="text-sm font-bold">JBL PartyBox Stage 320 — שליטה בעברית</div>
              <div className="text-sm font-bold text-orange-600 dark:text-orange-400">
                פיתוח והנדסה: ״אש התורה״
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                גרסת אפליקציה: {APP_VERSION} (Build {BUILD_NUMBER} · Release v{BUILD_NUMBER})
                <br />
                ארכיטקטורה: 100% Native Android (Java 17 + Vector SVG)
              </div>

              <div className="pt-2 space-y-2">
                <a
                  href={GITHUB_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-slate-900 dark:bg-orange-600 text-white text-xs font-bold flex items-center justify-center gap-2"
                >
                  <SvgGithub className="w-4 h-4" />
                  <span>פרופיל ״אש התורה״ ב-GitHub</span>
                </a>
                <a
                  href={MITMACHIM_PROFILE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[42px] px-3 rounded-xl bg-white dark:bg-[#131A26] border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center justify-center gap-2"
                >
                  <SvgForum className="w-4 h-4" />
                  <span>פרופיל ״אש התורה״ במתמחים טופ</span>
                </a>
              </div>
            </div>

            {/* What's New ("מה חדש") */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1C2536] space-y-1.5 text-xs">
              <div className="font-bold text-sm mb-1">מה חדש בגרסה {APP_VERSION}</div>
              <ul className="space-y-1.5 text-slate-600 dark:text-slate-300 list-disc pr-4">
                <li>
                  בנייה מחדש כאפליקציית <strong>100% Native Android (Java 17)</strong> ללא WebView וללא דמה ב-HTML.
                </li>
                <li>
                  כל האייקונים בפורמט וקטורי <strong>SVG</strong> חד ומינימליסטי עם ביצועים מהירים במיוחד.
                </li>
                <li>
                  מסך הגדרות (למעלה מימין): מצב בהיר/כהה/מערכת, מדריך שימוש ועדכון אוטומטי מ-GitHub Releases לפי תג.
                </li>
                <li>
                  שורה תחתונה קבועה (מימין לשמאל): חיבור ופרטי בוקסה, שליטה ותאורה, איקוולייזר, בחירת שירים והגדרות מערכת הבוקסה.
                </li>
                <li>
                  שדרוג מלא של תהליכי ה-CI וה-Releases ב-GitHub עם בדיקות אוטומטיות ופירוט מלא בכל שחרור.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
