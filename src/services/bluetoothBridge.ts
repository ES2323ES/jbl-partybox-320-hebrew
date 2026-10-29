import {
  APP_VERSION,
  BassBoostMode,
  LightingProtocolMode,
  LightshowState,
} from '../types/speaker';
import { faultLogger } from './faultLogger';
import {
  JBL_KNOWN_OPTIONAL_SERVICES,
  buildJblBeatPulseFrame,
  buildJblLightshowFrames,
  bytesToHex,
  scoreJblControlCharacteristic,
} from './jblProtocol';

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

export interface LightingChannelDiagnostics {
  connected: boolean;
  transport: 'none' | 'web_ble_gatt' | 'android_ble_gatt' | 'android_spp' | 'android_dual';
  activeCharacteristicUuid: string | null;
  discoveredWritableCount: number;
  packetsSent: number;
  lastTxHex: string | null;
  lastAckHex: string | null;
  lastError: string | null;
}

export interface NativeExternalPlayerState {
  isMusicActive: boolean;
  bluetoothA2dpActive: boolean;
  activeRouteName: string;
  volumePercent: number;
  visualizerAvailable: boolean;
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
  setHardwareVolume: (percent: number, muted?: boolean) => void;
  getHardwareVolumePercent: () => number;
  setHardwareEqualizer: (gainsJson: string, bassStrengthPermille: number) => void;
  connectSpeakerControlChannel?: (addressOrName: string) => string;
  disconnectSpeakerControlChannel?: () => void;
  sendLightingHexPayload?: (hexPayload: string) => boolean;
  getLightingChannelStatusJson?: () => string;
  getExternalPlayerStateJson?: () => string;
  getSystemAudioFftJson?: () => string;
  sendMediaKey?: (action: string) => boolean;
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
    onJblLightingChannelEvent?: (eventJson: string) => void;
  }
}

interface WebBluetoothCharacteristicProperties {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
}

interface WebBluetoothGattCharacteristic {
  uuid: string;
  properties?: WebBluetoothCharacteristicProperties;
  readValue: () => Promise<DataView>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValue?: (value: BufferSource) => Promise<void>;
  startNotifications?: () => Promise<WebBluetoothGattCharacteristic>;
  addEventListener?: (
    event: string,
    cb: (ev: { target?: { value?: DataView } }) => void
  ) => void;
}

interface WebBluetoothGattService {
  uuid: string;
  getCharacteristic: (uuid: string | number) => Promise<WebBluetoothGattCharacteristic>;
  getCharacteristics: () => Promise<WebBluetoothGattCharacteristic[]>;
}

interface WebBluetoothGattServer {
  connected: boolean;
  connect: () => Promise<WebBluetoothGattServer>;
  disconnect: () => void;
  getPrimaryService: (uuid: string | number) => Promise<WebBluetoothGattService>;
  getPrimaryServices: () => Promise<WebBluetoothGattService[]>;
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

interface RankedWritableChar {
  serviceUuid: string;
  charUuid: string;
  char: WebBluetoothGattCharacteristic;
  preferWithoutResponse: boolean;
  score: number;
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

function looksLikeJblName(name: string): boolean {
  return /jbl|partybox|stage\s*320|harman|auracast/i.test(name);
}

class BluetoothSpeakerBridge {
  private activeBleDevice: WebBluetoothDevice | null = null;
  private writableChars: RankedWritableChar[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private protocolMode: LightingProtocolMode = 'auto_dual';

  private packetsSentCount = 0;
  private lastTxHex: string | null = null;
  private lastAckHex: string | null = null;
  private lastChannelError: string | null = null;
  private lastLightSyncMs = 0;
  private pendingLightSyncTimer: number | null = null;
  private latestPendingLightState: LightshowState | null = null;
  private lastBeatPulseMs = 0;

  private permissionListeners = new Set<(state: SpeakerPermissionState) => void>();
  private diagnosticsListeners = new Set<() => void>();
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
          faultLogger.record({
            severity: normalized.bluetoothConnect ? 'success' : 'warning',
            category: 'permissions',
            title: 'סטטוס הרשאות אנדרואיד עודכן',
            details: `Bluetooth Connect: ${normalized.bluetoothConnect ? 'מאושר' : 'חסר'} · Scan: ${normalized.bluetoothScan ? 'מאושר' : 'חסר'} · מיקרופון/שמע: ${normalized.microphone ? 'מאושר' : 'חסר'}`,
          });
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

      window.onJblLightingChannelEvent = (eventJson: string) => {
        try {
          const ev = JSON.parse(eventJson) as {
            type?: string;
            message?: string;
            ackHex?: string;
            error?: string;
          };
          if (ev.ackHex) {
            this.lastAckHex = ev.ackHex;
          }
          if (ev.error) {
            this.lastChannelError = ev.error;
            faultLogger.record({
              severity: 'warning',
              category: 'lighting',
              title: 'הודעה מערוץ התאורה ברמקול',
              details: ev.error,
              suggestionHe:
                'ודא שהרמקול JBL PartyBox 320 דולק ונמצא בטווח קליטה קרוב למכשיר.',
            });
          } else if (ev.message) {
            faultLogger.record({
              severity: 'success',
              category: 'lighting',
              title: 'ערוץ בקרת תאורה חובר באנדרואיד',
              details: ev.message,
            });
          }
          this.notifyDiagnosticsChanged();
        } catch {
          // ignore
        }
      };
    }
  }

  public onDiagnosticsChanged(cb: () => void): () => void {
    this.diagnosticsListeners.add(cb);
    return () => {
      this.diagnosticsListeners.delete(cb);
    };
  }

  private notifyDiagnosticsChanged(): void {
    this.diagnosticsListeners.forEach((cb) => cb());
  }

  public setLightingProtocolMode(mode: LightingProtocolMode): void {
    this.protocolMode = mode;
    faultLogger.record({
      severity: 'info',
      category: 'lighting',
      title: 'פרוטוקול שידור תאורה שונה',
      details: `נבחר מצב שידור: ${
        mode === 'auto_dual'
          ? 'אוטומטי כפול (Harman AA + GATT)'
          : mode === 'harman_aa'
            ? 'Harman SmartAudio AA'
            : 'GATT ישיר'
      }`,
    });
    this.notifyDiagnosticsChanged();
  }

  public getLightingProtocolMode(): LightingProtocolMode {
    return this.protocolMode;
  }

  public isAndroidNativeBridgeAvailable(): boolean {
    return typeof window !== 'undefined' && Boolean(window.JblAndroidBridge);
  }

  public getLightingDiagnostics(): LightingChannelDiagnostics {
    if (
      this.isAndroidNativeBridgeAvailable() &&
      window.JblAndroidBridge?.getLightingChannelStatusJson
    ) {
      try {
        const raw = JSON.parse(
          window.JblAndroidBridge.getLightingChannelStatusJson()
        ) as {
          bleConnected?: boolean;
          sppConnected?: boolean;
          charUuid?: string;
          writableCount?: number;
          lastError?: string | null;
        };
        const bleOk = Boolean(raw.bleConnected);
        const sppOk = Boolean(raw.sppConnected);
        const transport =
          bleOk && sppOk
            ? 'android_dual'
            : bleOk
              ? 'android_ble_gatt'
              : sppOk
                ? 'android_spp'
                : 'none';
        return {
          connected: bleOk || sppOk,
          transport,
          activeCharacteristicUuid: raw.charUuid || (sppOk ? 'RFCOMM-SPP' : null),
          discoveredWritableCount: Number(raw.writableCount || (sppOk ? 1 : 0)),
          packetsSent: this.packetsSentCount,
          lastTxHex: this.lastTxHex,
          lastAckHex: this.lastAckHex,
          lastError: raw.lastError || this.lastChannelError,
        };
      } catch {
        // fallback below
      }
    }

    const webConnected = Boolean(
      this.activeBleDevice?.gatt?.connected && this.writableChars.length > 0
    );
    return {
      connected: webConnected,
      transport: webConnected ? 'web_ble_gatt' : 'none',
      activeCharacteristicUuid: this.writableChars[0]?.charUuid || null,
      discoveredWritableCount: this.writableChars.length,
      packetsSent: this.packetsSentCount,
      lastTxHex: this.lastTxHex,
      lastAckHex: this.lastAckHex,
      lastError: this.lastChannelError,
    };
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
      typeof Notification !== 'undefined'
        ? Notification.permission === 'granted'
        : true;

    return {
      isAndroidApk: false,
      bluetoothConnect: hasWebBt,
      bluetoothScan: hasWebBt,
      location: true,
      microphone:
        typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
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

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        if (options.enabled && typeof MediaMetadata !== 'undefined') {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: options.speakerName,
            artist: `JBL PartyBox 320 · עוצמה ${options.volume}%`,
            album: `תאורה: ${options.lightEnabled ? options.presetTitle : 'כבויה'}`,
          });
          navigator.mediaSession.playbackState = options.isPlaying
            ? 'playing'
            : 'paused';
          if (options.onTogglePlay) {
            navigator.mediaSession.setActionHandler('play', options.onTogglePlay);
            navigator.mediaSession.setActionHandler('pause', options.onTogglePlay);
          }
          if (options.onPrevTrack) {
            navigator.mediaSession.setActionHandler(
              'previoustrack',
              options.onPrevTrack
            );
          }
          if (options.onNextTrack) {
            navigator.mediaSession.setActionHandler(
              'nexttrack',
              options.onNextTrack
            );
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
      await new Promise((r) => window.setTimeout(r, 550));
      const st = this.getPermissionState();
      const ok = st.bluetoothConnect && st.bluetoothScan;
      faultLogger.record({
        severity: ok ? 'success' : 'info',
        category: 'permissions',
        title: ok ? 'כל הרשאות הרמקול אושרו באנדרואיד' : 'נשלחה בקשת הרשאות מערכת',
        details: ok
          ? 'הרשאות מכשירים קרובים (BLE/SPP), שמע/מיקרופון והתראות פעילות.'
          : 'ממתין לאישור המשתמש בחלון ההרשאות של אנדרואיד.',
      });
      return {
        granted: ok,
        message: ok
          ? 'כל הרשאות הבלוטוס, התאורה, השמע והסינכרון החי מאושרות ופעילות באנדרואיד.'
          : 'נפתחה בקשת הרשאות באנדרואיד — אשר גישה למכשירים קרובים ולשמע.',
        state: st,
      };
    }

    let micOk = false;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        micOk = true;
      } catch (err) {
        micOk = false;
        faultLogger.record({
          severity: 'warning',
          category: 'permissions',
          title: 'הרשאת מיקרופון לסינכרון קצב לא אושרה בדפדפן',
          details: err instanceof Error ? err.message : 'גישת שמע נדחתה',
          suggestionHe:
            'אשר הרשאת מיקרופון בסרגל הכתובת של הדפדפן או השתמש בכפתור שיתוף שמע מערכת.',
        });
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

    faultLogger.record({
      severity: micOk ? 'success' : 'info',
      category: 'permissions',
      title: 'בדיקת הרשאות דפדפן הושלמה',
      details: `Web Bluetooth זמין: ${updated.bluetoothConnect ? 'כן' : 'לא'} · סינכרון שמע חי: ${micOk ? 'מאושר' : 'ממתין'}`,
    });

    return {
      granted: true,
      message: micOk
        ? 'הרשאות השמע והסינכרון החי אושרו! האפליקציה מוכנה לסינכרון עם נגן המוזיקה ולסריקת BLE.'
        : 'הדפדפן מוכן להזרמת שמע לבלוטוס (להפעלת סינכרון אקוסטי יש לאשר גישת מיקרופון או שיתוף שמע מערכת).',
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
        return parsed.map((item) => {
          const name = String(item.name || 'התקן Bluetooth');
          return {
            name,
            address: String(item.address || ''),
            isJbl:
              typeof item.isJbl === 'boolean' ? item.isJbl : looksLikeJblName(name),
            isActiveAudioRoute: Boolean(item.isActiveAudioRoute),
          };
        });
      }
    } catch {
      // ignore
    }
    return [];
  }

  public connectAndroidSpeakerControl(addressOrName: string): {
    ok: boolean;
    message: string;
  } {
    if (!this.isAndroidNativeBridgeAvailable() || !window.JblAndroidBridge) {
      return { ok: false, message: 'גשר אנדרואיד אינו פעיל בסביבה זו.' };
    }
    try {
      if (window.JblAndroidBridge.connectSpeakerControlChannel) {
        const resJson =
          window.JblAndroidBridge.connectSpeakerControlChannel(addressOrName);
        const parsed = JSON.parse(resJson) as {
          ok?: boolean;
          message?: string;
        };
        const msg =
          parsed.message ||
          `נפתח ערוץ בקרת תאורה וסאונד מול "${addressOrName}".`;
        faultLogger.record({
          severity: parsed.ok !== false ? 'success' : 'warning',
          category: 'bluetooth',
          title: 'חיבור ערוץ תאורה ברמקול (אנדרואיד BLE + SPP)',
          details: msg,
        });
        this.notifyDiagnosticsChanged();
        return { ok: parsed.ok !== false, message: msg };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'שגיאה בפתיחת ערוץ בקרה';
      faultLogger.record({
        severity: 'error',
        category: 'bluetooth',
        title: 'שגיאה בחיבור ערוץ הבקרה באנדרואיד',
        details: msg,
        suggestionHe: 'ודא שהרשאת מכשירים קרובים מאושרת ושהרמקול דולק.',
      });
    }
    return {
      ok: true,
      message: `מחובר לרמקול "${addressOrName}" דרך מערכת האודיו של אנדרואיד.`,
    };
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

  private async discoverWritableGattChannels(
    server: WebBluetoothGattServer
  ): Promise<RankedWritableChar[]> {
    const discovered: RankedWritableChar[] = [];
    try {
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        try {
          const chars = await svc.getCharacteristics();
          for (const ch of chars) {
            const props = ch.properties || {};
            const canWnr = Boolean(
              props.writeWithoutResponse || ch.writeValueWithoutResponse
            );
            const canW = Boolean(
              props.write || ch.writeValueWithResponse || ch.writeValue
            );

            // Subscribe to notify characteristics to receive speaker ACKs & status
            if (props.notify && ch.startNotifications && ch.addEventListener) {
              ch.startNotifications()
                .then(() => {
                  ch.addEventListener?.('characteristicvaluechanged', (ev) => {
                    const dv = ev.target?.value;
                    if (dv) {
                      const arr = new Uint8Array(
                        dv.buffer,
                        dv.byteOffset,
                        dv.byteLength
                      );
                      this.lastAckHex = bytesToHex(arr);
                      this.notifyDiagnosticsChanged();
                    }
                  });
                })
                .catch(() => {});
            }

            const score = scoreJblControlCharacteristic(
              svc.uuid,
              ch.uuid,
              canWnr,
              canW
            );
            if (score > 0) {
              discovered.push({
                serviceUuid: svc.uuid,
                charUuid: ch.uuid,
                char: ch,
                preferWithoutResponse: canWnr,
                score,
              });
            }
          }
        } catch {
          // ignore restricted service
        }
      }
    } catch (err) {
      faultLogger.record({
        severity: 'warning',
        category: 'lighting',
        title: 'סריקת שירותי GATT הושלמה חלקית',
        details:
          err instanceof Error
            ? err.message
            : 'חלק משירותי ה-BLE של הרמקול אינם חשופים לדפדפן',
      });
    }

    discovered.sort((a, b) => b.score - a.score);
    return discovered;
  }

  public async scanAndConnectBleSpeaker(
    preferJblFilter: boolean,
    onDisconnected?: () => void
  ): Promise<{
    ok: boolean;
    deviceName?: string;
    batteryLevel?: number | null;
    writableChannels?: number;
    message: string;
  }> {
    // 1. Inside Native Android APK: use Native Android BLE + Paired Classic SPP bridge!
    if (this.isAndroidNativeBridgeAvailable()) {
      const perms = this.getPermissionState();
      if (!perms.bluetoothConnect || !perms.bluetoothScan) {
        await this.requestAllSpeakerPermissions();
      }
      const paired = this.getPairedAndroidSpeakers();
      const jblSpeaker =
        paired.find((d) => d.isJbl && d.isActiveAudioRoute) ||
        paired.find((d) => d.isJbl) ||
        paired[0];

      if (jblSpeaker) {
        const ctrl = this.connectAndroidSpeakerControl(
          jblSpeaker.address || jblSpeaker.name
        );
        return {
          ok: true,
          deviceName: jblSpeaker.name,
          batteryLevel: null,
          writableChannels: 1,
          message: ctrl.message,
        };
      }

      // Trigger BLE scan on Android even if not yet paired in Classic list
      const scanCtrl = this.connectAndroidSpeakerControl('SCAN_JBL_BLE');
      if (scanCtrl.ok) {
        return {
          ok: true,
          deviceName: 'JBL PartyBox Stage 320',
          batteryLevel: null,
          writableChannels: 1,
          message: scanCtrl.message,
        };
      }

      faultLogger.record({
        severity: 'warning',
        category: 'bluetooth',
        title: 'לא נמצא רמקול JBL מזווג באנדרואיד',
        details:
          'רשימת התקני ה-Bluetooth המזווגים אינה כוללת כרגע רמקול JBL מחובר.',
        suggestionHe:
          'לחץ על ״פתח הגדרות Bluetooth באנדרואיד״, זווג את JBL PartyBox Stage 320 וחזור לאפליקציה.',
      });

      return {
        ok: false,
        message:
          'לא נמצא רמקול JBL מזווג. לחץ על ״פתח הגדרות Bluetooth באנדרואיד״, זווג את ה-PartyBox 320 ונסה שוב.',
      };
    }

    // 2. Web Browser: Web Bluetooth GATT Discovery + Writable Lighting Channels
    const nav = navigator as NavigatorWithWebBluetooth;
    if (!nav.bluetooth) {
      faultLogger.record({
        severity: 'warning',
        category: 'bluetooth',
        title: 'הדפדפן הנוכחי אינו תומך ב-Web Bluetooth לתאורה ישירה',
        details:
          'דפדפנים כמו Safari או תצוגה מוטמעת חוסמים גישת BLE GATT ישירה לערוץ התאורה.',
        suggestionHe:
          'לשליטה מלאה בתאורת הרמקול הנייד, התקן את קובץ ה-APK לאנדרואיד מלשונית ההורדה או פתח ב-Chrome.',
      });
      return {
        ok: false,
        message:
          'הדפדפן הנוכחי אינו תומך ב-Web Bluetooth לתאורה ישירה. לשליטה מלאה בתאורת הרמקול הנייד מומלץ להתקין את אפליקציית ה-APK לאנדרואיד או לפתוח ב-Chrome.',
      };
    }

    try {
      const options = preferJblFilter
        ? {
            filters: [
              { namePrefix: 'JBL' },
              { namePrefix: 'PartyBox' },
              { services: [0xfddf] },
              { services: ['battery_service'] },
            ],
            optionalServices: JBL_KNOWN_OPTIONAL_SERVICES,
          }
        : {
            acceptAllDevices: true,
            optionalServices: JBL_KNOWN_OPTIONAL_SERVICES,
          };

      const device = await nav.bluetooth.requestDevice(options);
      this.activeBleDevice = device;
      this.writableChars = [];
      this.lastChannelError = null;
      const label = device.name || 'JBL PartyBox Stage 320';

      if (device.addEventListener) {
        device.addEventListener('gattserverdisconnected', () => {
          this.writableChars = [];
          faultLogger.record({
            severity: 'warning',
            category: 'bluetooth',
            title: `הרמקול "${label}" התנתק מערוץ ה-BLE`,
            details: 'חיבור ה-GATT לרמקול נסגר.',
            suggestionHe: 'לחץ על ״חיבור בלוטוס לרמקול״ כדי להתחבר מחדש.',
          });
          this.notifyDiagnosticsChanged();
          onDisconnected?.();
        });
      }

      let batteryLevel: number | null = null;
      if (device.gatt) {
        const server = await device.gatt.connect();

        // Discover writable lighting/control characteristics
        this.writableChars = await this.discoverWritableGattChannels(server);

        try {
          const batterySvc = await server.getPrimaryService('battery_service');
          const batteryChar = await batterySvc.getCharacteristic('battery_level');
          const val = await batteryChar.readValue();
          batteryLevel = val.getUint8(0);
        } catch {
          // Battery service optional on Harman speakers
        }
      }

      const writableCount = this.writableChars.length;
      if (writableCount > 0) {
        faultLogger.record({
          severity: 'success',
          category: 'lighting',
          title: `חובר לרמקול "${label}" ונמצאו ${writableCount} ערוצי בקרת תאורה`,
          details: `ערוץ ראשי: ${this.writableChars[0].charUuid}`,
        });
      } else {
        faultLogger.record({
          severity: 'warning',
          category: 'lighting',
          title: `הרמקול "${label}" חובר, אך לא נחשף ערוץ כתיבת GATT בדפדפן`,
          details:
            'ייתכן שהרמקול ממתין לחיבור כפול (SPP + BLE) הזמין במלואו באפליקציית ה-APK לאנדרואיד.',
          suggestionHe:
            'באנדרואיד מומלץ להתקין את ה-APK המצורף התומך גם ב-RFCOMM SPP וגם ב-BLE GATT מול ה-PartyBox 320.',
        });
      }

      this.notifyDiagnosticsChanged();

      return {
        ok: true,
        deviceName: label,
        batteryLevel,
        writableChannels: writableCount,
        message:
          writableCount > 0
            ? `הרמקול "${label}" מחובר ומוכן! נמצאו ${writableCount} ערוצי בקרה פעילים לתאורה ולסאונד${batteryLevel !== null ? ` (סוללה: ${batteryLevel}%)` : ''}.`
            : `הרמקול "${label}" חובר לשמע. לשליטת תאורה חומרתית מלאה מומלץ להשתמש ב-APK המותקן או לזווג במצב BLE.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      if (
        msg.toLowerCase().includes('cancel') ||
        msg.toLowerCase().includes('chosen')
      ) {
        return {
          ok: false,
          message: 'סריקת ה-Bluetooth בוטלה. ניתן לסרוק שוב בכל עת.',
        };
      }

      const isIframePolicy =
        msg.toLowerCase().includes('policy') ||
        msg.toLowerCase().includes('disallowed') ||
        msg.toLowerCase().includes('security');

      faultLogger.record({
        severity: 'error',
        category: 'bluetooth',
        title: isIframePolicy
          ? 'סריקת Web Bluetooth חסומה בתוך חלון תצוגה מוטמע'
          : 'שגיאה בסריקת Bluetooth לרמקול',
        details: msg || 'לא ניתן לפתוח חלון סריקת BLE במסגרת זו.',
        suggestionHe: isIframePolicy
          ? 'פתח את האפליקציה בחלון דפדפן מלא או התקן את קובץ ה-APK באנדרואיד לעבודה מלאה עם הרמקול.'
          : 'ודא שה-Bluetooth במכשיר דולק ושהרמקול JBL PartyBox 320 במצב גלוי.',
      });

      return {
        ok: false,
        message: isIframePolicy
          ? 'סריקת BLE ישירה חסומה בתוך מסגרת תצוגה מקדימה זו — באפליקציית ה-APK באנדרואיד או בטאב דפדפן עצמאי החיבור והתאורה עובדים באופן מלא.'
          : `שגיאה בחיבור Bluetooth: ${msg}`,
      };
    }
  }

  public disconnectBle(): void {
    if (
      this.isAndroidNativeBridgeAvailable() &&
      window.JblAndroidBridge?.disconnectSpeakerControlChannel
    ) {
      try {
        window.JblAndroidBridge.disconnectSpeakerControlChannel();
      } catch {
        // ignore
      }
    }
    if (this.activeBleDevice?.gatt?.connected) {
      try {
        this.activeBleDevice.gatt.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeBleDevice = null;
    this.writableChars = [];
    this.notifyDiagnosticsChanged();
  }

  /**
   * Sends raw binary packet(s) to the connected JBL speaker over Native Android (BLE GATT + SPP)
   * or Web Bluetooth GATT using a serialized write queue so GATT operations never collide.
   */
  private enqueueSpeakerPackets(
    packets: Uint8Array[],
    logOnSuccess = false
  ): Promise<boolean> {
    const task = async (): Promise<boolean> => {
      if (packets.length === 0) return false;
      const primaryHex = bytesToHex(packets[0]);
      this.lastTxHex = primaryHex;

      // Path A: Native Android APK Bridge (writes to both BLE GATT & Classic RFCOMM SPP!)
      if (
        this.isAndroidNativeBridgeAvailable() &&
        window.JblAndroidBridge?.sendLightingHexPayload
      ) {
        let anyOk = false;
        for (const pkt of packets) {
          try {
            const hex = bytesToHex(pkt);
            const sent = window.JblAndroidBridge.sendLightingHexPayload(hex);
            if (sent) {
              anyOk = true;
              this.packetsSentCount += 1;
            }
          } catch (err) {
            this.lastChannelError =
              err instanceof Error ? err.message : 'שגיאת משלוח באנדרואיד';
          }
        }
        if (logOnSuccess) {
          faultLogger.record({
            severity: anyOk ? 'success' : 'warning',
            category: 'lighting',
            title: anyOk
              ? 'פקודת תאורה נשלחה לרמקול בהצלחה (אנדרואיד)'
              : 'לא נמצא ערוץ תאורה פתוח ברמקול כרגע',
            details: `TX Packet: ${primaryHex}`,
            suggestionHe: anyOk
              ? undefined
              : 'פתח את ״חיבור בלוטוס לרמקול״ ובחר את ה-JBL PartyBox 320 מהרשימה.',
          });
        }
        this.notifyDiagnosticsChanged();
        return anyOk;
      }

      // Path B: Web Bluetooth GATT Writable Characteristics
      if (!this.activeBleDevice?.gatt?.connected || this.writableChars.length === 0) {
        if (logOnSuccess) {
          faultLogger.record({
            severity: 'warning',
            category: 'lighting',
            title: 'בדיקת תאורה: טרם חובר ערוץ BLE פעיל לרמקול',
            details: `הוכנה חבילת שידור (${primaryHex}), אך הרמקול אינו מחובר כעת בערוץ GATT.`,
            suggestionHe:
              'לחץ על כפתור ״חיבור בלוטוס לרמקול״ בראש המסך וחבר את ה-JBL PartyBox Stage 320.',
          });
        }
        this.notifyDiagnosticsChanged();
        return false;
      }

      // Write to top-ranked Harman/JBL control characteristic(s) (up to top 2 candidates)
      const targets = this.writableChars.slice(0, 2);
      let wroteAny = false;

      for (const target of targets) {
        for (const pkt of packets) {
          try {
            const buf = pkt.buffer.slice(
              pkt.byteOffset,
              pkt.byteOffset + pkt.byteLength
            ) as ArrayBuffer;
            if (
              target.preferWithoutResponse &&
              target.char.writeValueWithoutResponse
            ) {
              await target.char.writeValueWithoutResponse(buf);
            } else if (target.char.writeValueWithResponse) {
              await target.char.writeValueWithResponse(buf);
            } else if (target.char.writeValue) {
              await target.char.writeValue(buf);
            }
            wroteAny = true;
            this.packetsSentCount += 1;
            this.lastChannelError = null;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'GATT write failed';
            this.lastChannelError = msg;
            if (logOnSuccess) {
              faultLogger.record({
                severity: 'error',
                category: 'lighting',
                title: 'שגיאה בכתיבת פקודת תאורה לערוץ GATT',
                details: `${target.charUuid}: ${msg}`,
                suggestionHe:
                  'נסה להחליף את מצב הפרוטוקול בסטודיו התאורה או לחבר מחדש את הרמקול.',
              });
            }
          }
        }
      }

      if (wroteAny && logOnSuccess) {
        faultLogger.record({
          severity: 'success',
          category: 'lighting',
          title: 'פקודת תאורה שודרה לרמקול בהצלחה (BLE GATT)',
          details: `ערוץ: ${targets[0].charUuid} · נתונים: ${primaryHex}`,
        });
      }
      this.notifyDiagnosticsChanged();
      return wroteAny;
    };

    const next = this.writeQueue.then(task, task);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Throttled real-time hardware lightshow state sync (prevents flooding BLE GATT when dragging color/brightness sliders).
   */
  public syncHardwareLightshow(state: LightshowState, immediate = false): void {
    this.latestPendingLightState = state;
    const now = performance.now();
    const minIntervalMs = 85;

    if (immediate || now - this.lastLightSyncMs >= minIntervalMs) {
      if (this.pendingLightSyncTimer !== null) {
        window.clearTimeout(this.pendingLightSyncTimer);
        this.pendingLightSyncTimer = null;
      }
      this.lastLightSyncMs = now;
      const frames = buildJblLightshowFrames(state, this.protocolMode);
      void this.enqueueSpeakerPackets(frames, immediate);
      return;
    }

    if (this.pendingLightSyncTimer === null) {
      this.pendingLightSyncTimer = window.setTimeout(() => {
        this.pendingLightSyncTimer = null;
        if (this.latestPendingLightState) {
          this.lastLightSyncMs = performance.now();
          const frames = buildJblLightshowFrames(
            this.latestPendingLightState,
            this.protocolMode
          );
          void this.enqueueSpeakerPackets(frames, false);
        }
      }, minIntervalMs);
    }
  }

  /**
   * Sends a live beat-synchronized pulse to the physical speaker on detected music kicks (max ~6 pulses/sec).
   */
  public triggerHardwareBeatPulse(
    energy01: number,
    primaryHex: string,
    secondaryHex: string
  ): void {
    const now = performance.now();
    if (now - this.lastBeatPulseMs < 175) return;

    const diag = this.getLightingDiagnostics();
    if (!diag.connected) return;

    this.lastBeatPulseMs = now;
    const pulse = buildJblBeatPulseFrame(energy01, primaryHex, secondaryHex);
    void this.enqueueSpeakerPackets([pulse], false);
  }

  public async sendTestLightingFlash(state: LightshowState): Promise<{
    ok: boolean;
    message: string;
  }> {
    const frames = buildJblLightshowFrames(
      { ...state, enabled: true },
      this.protocolMode
    );
    const ok = await this.enqueueSpeakerPackets(frames, true);
    if (ok) {
      return {
        ok: true,
        message: `פקודת התאורה שודרה בהצלחה לרמקול (${bytesToHex(frames[0]).slice(0, 18)}...)!`,
      };
    }
    return {
      ok: false,
      message:
        'לא אותר ערוץ בקרת תאורה פתוח כעת — חבר את הרמקול בחלון ״חיבור בלוטוס לרמקול״ ובדוק את יומן התקלות.',
    };
  }

  // --- External Player Hardware Integration (Zero Upload Sync!) ---

  public getNativeExternalPlayerState(): NativeExternalPlayerState | null {
    if (
      !this.isAndroidNativeBridgeAvailable() ||
      !window.JblAndroidBridge?.getExternalPlayerStateJson
    ) {
      return null;
    }
    try {
      const parsed = JSON.parse(
        window.JblAndroidBridge.getExternalPlayerStateJson()
      ) as Partial<NativeExternalPlayerState>;
      return {
        isMusicActive: Boolean(parsed.isMusicActive),
        bluetoothA2dpActive: Boolean(parsed.bluetoothA2dpActive),
        activeRouteName: String(parsed.activeRouteName || ''),
        volumePercent: Number(parsed.volumePercent ?? 70),
        visualizerAvailable: Boolean(parsed.visualizerAvailable),
      };
    } catch {
      return null;
    }
  }

  public getNativeSystemAudioBins(): number[] | null {
    if (
      !this.isAndroidNativeBridgeAvailable() ||
      !window.JblAndroidBridge?.getSystemAudioFftJson
    ) {
      return null;
    }
    try {
      const raw = window.JblAndroidBridge.getSystemAudioFftJson();
      if (!raw || raw === '[]') return null;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
      }
    } catch {
      // ignore
    }
    return null;
  }

  public dispatchExternalPlayerMediaKey(
    action: 'play_pause' | 'next' | 'previous'
  ): boolean {
    if (
      this.isAndroidNativeBridgeAvailable() &&
      window.JblAndroidBridge?.sendMediaKey
    ) {
      try {
        return Boolean(window.JblAndroidBridge.sendMediaKey(action));
      } catch {
        return false;
      }
    }
    return false;
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
      } catch (err) {
        faultLogger.record({
          severity: 'warning',
          category: 'audio_sync',
          title: 'שגיאה בעדכון איקוולייזר חומרתי באנדרואיד',
          details: err instanceof Error ? err.message : 'EQ sync error',
        });
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
    const res = await fetch(
      `https://api.github.com/repos/${repoSlug}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      }
    );
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
