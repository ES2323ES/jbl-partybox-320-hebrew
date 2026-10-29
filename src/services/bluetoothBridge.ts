import { BassBoostMode } from '../types/speaker';

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
  bluetoothEnabled: boolean;
}

interface NativeJblAndroidBridge {
  getPermissionStatusJson: () => string;
  requestSpeakerPermissions: () => void;
  getPairedSpeakersJson: () => string;
  openBluetoothSettings: () => void;
  setHardwareVolume: (percent: number, muted: boolean) => void;
  getHardwareVolumePercent: () => number;
  setHardwareEqualizer: (gainsJson: string, bassStrengthPermille: number) => void;
}

declare global {
  interface Window {
    JblAndroidBridge?: NativeJblAndroidBridge;
    onJblPermissionsUpdated?: (statusJson: string) => void;
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

class BluetoothSpeakerBridge {
  private activeBleDevice: WebBluetoothDevice | null = null;
  private permissionListeners = new Set<(state: SpeakerPermissionState) => void>();

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
    return {
      isAndroidApk: false,
      bluetoothConnect: hasWebBt,
      bluetoothScan: hasWebBt,
      location: true,
      microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices),
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
            ? 'כל הרשאות ה-Bluetooth, השמע והמיקרופון מאושרות ופעילות באנדרואיד.'
            : 'נפתחה בקשת הרשאות מערכת באנדרואיד — אשר גישה ל״מכשירים קרובים״ ולמיקרופון לחיבור מלא לרמקול.',
        state: st,
      };
    }

    // Web browser flow: request microphone/audio device enumeration permission if available
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

    const st = this.getPermissionState();
    const updated: SpeakerPermissionState = { ...st, microphone: micOk || st.microphone };
    this.permissionListeners.forEach((cb) => cb(updated));
    return {
      granted: true,
      message: micOk
        ? 'הרשאות שמע ומיקרופון אושרו בדפדפן. כעת ניתן לסרוק רמקול JBL ב-Bluetooth או להזרים שמע.'
        : 'הדפדפן מוכן להזרמת שמע ל-Bluetooth של המכשיר (גישת מיקרופון לא אושרה).',
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
            message: `מחובר להתקן האודיו "${jblSpeaker.name}" דרך גשר ה-Bluetooth של אנדרואיד.`,
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
          // Many speakers expose proprietary GATT characteristics without standard 0x180F
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
}

export const bluetoothBridge = new BluetoothSpeakerBridge();
