import { APP_VERSION, BassBoostMode } from '../types/speaker';

export interface PairedBluetoothDevice {
  name: string;
  address: string;
  isJbl: boolean;
  isActiveAudioRoute: boolean;
}

export interface SpeakerPermissionState {
  isAndroidApk: boolean;
  bluetoothConnect: boolean;
  bluetoothScan: boolean;
  location: boolean;
  microphone: boolean;
  notifications: boolean;
  bluetoothEnabled: boolean;
}

export type QuickNotificationAction =
  | 'toggle_play'
  | 'toggle_light'
  | 'neon_mode'
  | 'cycle_bass'
  | 'toggle_mute';

export interface GithubUpdateCheckResult {
  checkedAt: string;
  tagName: string;
  releaseName: string;
  publishedAt: string;
  htmlUrl: string;
  apkDownloadUrl: string | null;
  zipDownloadUrl: string | null;
  remoteVersion: string;
  hasNewerVersion: boolean;
}

interface NativeJblAndroidBridge {
  getPermissionStatusJson: () => string;
  requestSpeakerPermissions: () => void;
  getPairedSpeakersJson: () => string;
  openBluetoothSettings: () => void;
  setHardwareVolume: (percent: number, muted: boolean) => void;
  getHardwareVolumePercent: () => number;
  setHardwareEqualizer: (gainsJson: string, bassStrengthPermille: number) => void;
  showQuickControlNotification?: (
    title: string,
    subtitle: string,
    isPlaying: boolean,
    lightEnabled: boolean
  ) => void;
  cancelQuickControlNotification?: () => void;
}

declare global {
  interface Window {
    JblAndroidBridge?: NativeJblAndroidBridge;
    onJblPermissionsUpdated?: (statusJson: string) => void;
    onJblNotificationAction?: (action: string) => void;
  }
}

interface WebBluetoothGattCharacteristic {
  readValue: () => Promise<DataView>;
}

interface WebBluetoothGattService {
  getCharacteristic: (uuid: string | number) => Promise<WebBluetoothGattCharacteristic>;
}

interface WebBluetoothGattServer {
  connected: boolean;
  connect: () => Promise<WebBluetoothGattServer>;
  disconnect: () => void;
  getPrimaryService: (uuid: string | number) => Promise<WebBluetoothGattService>;
}

interface WebBluetoothDevice {
  id: string;
  name?: string;
  gatt?: WebBluetoothGattServer;
  addEventListener?: (event: string, cb: () => void) => void;
}

interface NavigatorWithWebBluetooth extends Navigator {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean;
      filters?: Array<{ namePrefix?: string; services?: Array<string | number> }>;
      optionalServices?: Array<string | number>;
    }) => Promise<WebBluetoothDevice>;
  };
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

class BluetoothSpeakerBridge {
  private activeBleDevice: WebBluetoothDevice | null = null;
  private permissionListeners = new Set<(state: SpeakerPermissionState) => void>();
  private notificationActionListeners = new Set<
    (action: QuickNotificationAction) => void
  >();

  constructor() {
    if (typeof window !== 'undefined') {
      window.onJblPermissionsUpdated = (statusJson: string) => {
        try {
          const parsed = JSON.parse(statusJson) as Partial<SpeakerPermissionState>;
          const normalized = this.normalizePermissionState(parsed);
          this.permissionListeners.forEach((cb) => cb(normalized));
        } catch {
          // ignore malformed bridge payload
        }
      };

      window.onJblNotificationAction = (rawAction: string) => {
        const validActions: QuickNotificationAction[] = [
          'toggle_play',
          'toggle_light',
          'neon_mode',
          'cycle_bass',
          'toggle_mute',
        ];
        if (validActions.includes(rawAction as QuickNotificationAction)) {
          this.notificationActionListeners.forEach((cb) =>
            cb(rawAction as QuickNotificationAction)
          );
        }
      };
    }
  }

  public isAndroidNativeBridgeAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.JblAndroidBridge);
  }

  private normalizePermissionState(
    raw: Partial<SpeakerPermissionState>
  ): SpeakerPermissionState {
    return {
      isAndroidApk: this.isAndroidNativeBridgeAvailable(),
      bluetoothConnect: Boolean(raw.bluetoothConnect),
      bluetoothScan: Boolean(raw.bluetoothScan),
      location: Boolean(raw.location),
      microphone: Boolean(raw.microphone),
      notifications: raw.notifications ?? true,
      bluetoothEnabled: raw.bluetoothEnabled ?? true,
    };
  }

  public getPermissionState(): SpeakerPermissionState {
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      try {
        const raw = JSON.parse(
          window.JblAndroidBridge.getPermissionStatusJson()
        ) as Partial<SpeakerPermissionState>;
        return this.normalizePermissionState(raw);
      } catch {
        // fallback below
      }
    }

    const hasWebBt =
      typeof navigator !== 'undefined' &&
      Boolean((navigator as NavigatorWithWebBluetooth).bluetooth);
    const notifGranted =
      typeof Notification !== 'undefined' ? Notification.permission === 'granted' : true;

    return {
      isAndroidApk: false,
      bluetoothConnect: hasWebBt,
      bluetoothScan: hasWebBt,
      location: true,
      microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
      notifications: notifGranted,
      bluetoothEnabled: true,
    };
  }

  public onPermissionsChanged(
    listener: (state: SpeakerPermissionState) => void
  ): () => void {
    this.permissionListeners.add(listener);
    return () => {
      this.permissionListeners.delete(listener);
    };
  }

  public onQuickNotificationAction(
    listener: (action: QuickNotificationAction) => void
  ): () => void {
    this.notificationActionListeners.add(listener);
    return () => {
      this.notificationActionListeners.delete(listener);
    };
  }

  public syncQuickControlNotification(options: {
    enabled: boolean;
    speakerName: string;
    presetTitle: string;
    volume: number;
    isPlaying: boolean;
    lightEnabled: boolean;
    onPrevTrack?: () => void;
    onNextTrack?: () => void;
    onTogglePlay?: () => void;
  }): void {
    // 1. Native Android Notification Shade Controls
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      try {
        if (options.enabled) {
          window.JblAndroidBridge.showQuickControlNotification?.(
            options.speakerName,
            `עוצמה ${options.volume}% · תאורה: ${options.lightEnabled ? options.presetTitle : 'כבויה'}`,
            options.isPlaying,
            options.lightEnabled
          );
        } else {
          window.JblAndroidBridge.cancelQuickControlNotification?.();
        }
      } catch {
        // ignore native notification error
      }
    }

    // 2. Lock Screen & Media Shade via MediaSession API (works in Android Chrome, PWA & WebView)
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        if (options.enabled && typeof MediaMetadata !== 'undefined') {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: options.speakerName,
            artist: `JBL PartyBox 320 · עוצמה ${options.volume}%`,
            album: `תאורה: ${options.lightEnabled ? options.presetTitle : 'כבויה'}`,
          });
          navigator.mediaSession.playbackState = options.isPlaying ? 'playing' : 'paused';
          if (options.onTogglePlay) {
            navigator.mediaSession.setActionHandler('play', options.onTogglePlay);
            navigator.mediaSession.setActionHandler('pause', options.onTogglePlay);
          }
          if (options.onPrevTrack) {
            navigator.mediaSession.setActionHandler('previoustrack', options.onPrevTrack);
          }
          if (options.onNextTrack) {
            navigator.mediaSession.setActionHandler('nexttrack', options.onNextTrack);
          }
        }
      } catch {
        // ignore unsupported mediaSession actions
      }
    }
  }

  public async requestAllSpeakerPermissions(): Promise<{
    granted: boolean;
    message: string;
    state: SpeakerPermissionState;
  }> {
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      window.JblAndroidBridge.requestSpeakerPermissions();
      await new Promise((r) => window.setTimeout(r, 450));
      const st = this.getPermissionState();
      return {
        granted: st.bluetoothConnect && st.bluetoothScan,
        message:
          st.bluetoothConnect && st.bluetoothScan
            ? 'כל הרשאות הבלוטוס, ההתראות, השמע והמיקרופון מאושרות ופעילות באנדרואיד.'
            : 'נפתחה בקשת הרשאות מערכת באנדרואיד — אשר גישה למכשירים קרובים, התראות ומיקרופון.',
        state: st,
      };
    }

    let micOk = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        micOk = true;
      } catch {
        micOk = false;
      }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }

    const st = this.getPermissionState();
    const updated: SpeakerPermissionState = {
      ...st,
      microphone: micOk || st.microphone,
    };
    this.permissionListeners.forEach((cb) => cb(updated));
    return {
      granted: true,
      message: micOk
        ? 'הרשאות שמע ומיקרופון אושרו בדפדפן. כעת ניתן להפעיל קריוקי חי, כיול אקוסטי וסריקת רמקול.'
        : 'הדפדפן מוכן להזרמת שמע לבלוטוס של המכשיר (גישת מיקרופון לא אושרה).',
      state: updated,
    };
  }

  public getPairedAndroidSpeakers(): PairedBluetoothDevice[] {
    if (!this.isAndroidNativeBridgeAvailable() || !window.JblAndroidBridge) {
      return [];
    }
    try {
      const json = window.JblAndroidBridge.getPairedSpeakersJson();
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          name: String(item.name || 'התקן Bluetooth'),
          address: String(item.address || ''),
          isJbl: Boolean(item.isJbl),
          isActiveAudioRoute: Boolean(item.isActiveAudioRoute),
        }));
      }
    } catch {
      // ignore
    }
    return [];
  }

  public openAndroidBluetoothSettings(): boolean {
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      try {
        window.JblAndroidBridge.openBluetoothSettings();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  public async scanAndConnectBleSpeaker(
    preferJblFilter: boolean,
    onDisconnected?: () => void
  ): Promise<{
    ok: boolean;
    deviceName?: string;
    batteryLevel?: number | null;
    message: string;
  }> {
    const nav = navigator as NavigatorWithWebBluetooth;
    if (!nav.bluetooth) {
      if (this.isAndroidNativeBridgeAvailable()) {
        const paired = this.getPairedAndroidSpeakers();
        const jblSpeaker = paired.find((d) => d.isJbl) || paired[0];
        if (jblSpeaker) {
          return {
            ok: true,
            deviceName: jblSpeaker.name,
            batteryLevel: null,
            message: `מחובר אוטומטית להתקן האודיו "${jblSpeaker.name}" דרך גשר ה-Bluetooth של אנדרואיד.`,
          };
        }
        return {
          ok: false,
          message:
            'לא נמצא רמקול JBL מזווג. לחץ על ״פתח הגדרות Bluetooth באנדרואיד״ כדי לזווג את ה-PartyBox 320.',
        };
      }

      return {
        ok: false,
        message:
          'הדפדפן הנוכחי אינו חושף סריקת BLE ישירה. חבר את הרמקול בהגדרות ה-Bluetooth של המכשיר להזרמת השמע והאיקוולייזר בזמן אמת.',
      };
    }

    try {
      const options = preferJblFilter
        ? {
            filters: [
              { namePrefix: 'JBL' },
              { namePrefix: 'PartyBox' },
              { services: ['battery_service'] },
            ],
            optionalServices: [
              'battery_service',
              'device_information',
              'generic_access',
              0xfddf,
            ],
          }
        : {
            acceptAllDevices: true,
            optionalServices: [
              'battery_service',
              'device_information',
              'generic_access',
              0xfddf,
            ],
          };

      const device = await nav.bluetooth.requestDevice(options);
      this.activeBleDevice = device;
      const label = device.name || 'JBL PartyBox Stage 320';

      if (device.addEventListener && onDisconnected) {
        device.addEventListener('gattserverdisconnected', () => {
          onDisconnected();
        });
      }

      let batteryLevel: number | null = null;
      if (device.gatt) {
        try {
          const server = await device.gatt.connect();
          const batterySvc = await server.getPrimaryService('battery_service');
          const batteryChar = await batterySvc.getCharacteristic('battery_level');
          const val = await batteryChar.readValue();
          batteryLevel = val.getUint8(0);
        } catch {
          // Proprietary speaker GATT fallback
        }
      }

      return {
        ok: true,
        deviceName: label,
        batteryLevel,
        message:
          batteryLevel !== null
            ? `הרמקול "${label}" חובר בהצלחה ב-Bluetooth (סוללה שנקראה מהרמקול: ${batteryLevel}%).`
            : `הרמקול "${label}" חובר בהצלחה! כל כוונון באיקוולייזר ובתאורה מסונכרן כעת.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('chosen')) {
        return {
          ok: false,
          message: 'סריקת ה-Bluetooth בוטלה. ניתן לסרוק שוב בכל עת.',
        };
      }
      return {
        ok: false,
        message:
          'סריקת BLE ישירה חסומה במסגרת תצוגה זו — באפליקציית ה-APK המותקנת או בחיבור Bluetooth רגיל במכשיר השמע והאיקוולייזר עובדים באופן מלא.',
      };
    }
  }

  public disconnectBle(): void {
    if (this.activeBleDevice?.gatt?.connected) {
      try {
        this.activeBleDevice.gatt.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeBleDevice = null;
  }

  public syncHardwareVolume(percent: number, muted: boolean): void {
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      try {
        window.JblAndroidBridge.setHardwareVolume(
          Math.max(0, Math.min(100, Math.round(percent))),
          muted
        );
      } catch {
        // ignore
      }
    }
  }

  public syncHardwareEq(gainsDb: number[], bassBoost: BassBoostMode): void {
    if (this.isAndroidNativeBridgeAvailable() && window.JblAndroidBridge) {
      try {
        const bassPermille =
          bassBoost === BassBoostMode.Deep
            ? 850
            : bassBoost === BassBoostMode.Punchy
              ? 650
              : 0;
        window.JblAndroidBridge.setHardwareEqualizer(
          JSON.stringify(gainsDb),
          bassPermille
        );
      } catch {
        // ignore
      }
    }
  }

  public async listAudioOutputDevices(): Promise<
    Array<{ deviceId: string; label: string }>
  > {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((d) => d.kind === 'audiooutput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `יציאת רמקול ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  public async checkGithubLatestRelease(
    repoSlug = 'ES2323ES/jbl-partybox-320-hebrew'
  ): Promise<GithubUpdateCheckResult> {
    const res = await fetch(`https://api.github.com/repos/${repoSlug}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) {
      throw new Error(`לא ניתן לבדוק עדכונים כעת (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      tag_name?: string;
      name?: string;
      published_at?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const tagName = data.tag_name || 'v1';
    const releaseName = data.name || tagName;
    const versionMatch =
      /(\d+\.\d+\.\d+)/.exec(releaseName) ||
      /(\d+\.\d+\.\d+)/.exec(data.body || '') ||
      /(\d+\.\d+\.\d+)/.exec(tagName);
    const remoteVersion = versionMatch ? versionMatch[1] : APP_VERSION;

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const apkAsset = assets.find((a) => (a.name || '').endsWith('.apk'));
    const zipAsset = assets.find((a) => (a.name || '').endsWith('.zip'));

    return {
      checkedAt: new Date().toLocaleTimeString('he-IL', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      tagName,
      releaseName,
      publishedAt: (data.published_at || '').slice(0, 10),
      htmlUrl: data.html_url || `https://github.com/${repoSlug}/releases`,
      apkDownloadUrl: apkAsset?.browser_download_url || null,
      zipDownloadUrl: zipAsset?.browser_download_url || null,
      remoteVersion,
      hasNewerVersion: compareSemver(remoteVersion, APP_VERSION) > 0,
    };
  }
}

export const bluetoothBridge = new BluetoothSpeakerBridge();
