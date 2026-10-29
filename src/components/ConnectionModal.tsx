import React, { useEffect, useState } from 'react';
import {
  Bluetooth,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Speaker,
  Volume2,
  X,
} from 'lucide-react';
import { SpeakerSystemState } from '../types/speaker';
import {
  PairedBluetoothDevice,
  SpeakerPermissionState,
  bluetoothBridge,
} from '../services/bluetoothBridge';
import { audioEngine } from '../services/audioEngine';

interface ConnectionModalProps {
  open: boolean;
  system: SpeakerSystemState;
  onClose: () => void;
  onConnectSpeaker: (
    deviceTitle: string,
    mode: 'ble' | 'android_bt',
    batteryLevel?: number | null
  ) => void;
  onSwitchToDemo: () => void;
  onRenameSpeaker: (newName: string) => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  open,
  system,
  onClose,
  onConnectSpeaker,
  onSwitchToDemo,
  onRenameSpeaker,
}) => {
  const [scanning, setScanning] = useState(false);
  const [requestingPerms, setRequestingPerms] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(system.deviceName);
  const [permState, setPermState] = useState<SpeakerPermissionState>(() =>
    bluetoothBridge.getPermissionState()
  );
  const [pairedAndroidDevices, setPairedAndroidDevices] = useState<
    PairedBluetoothDevice[]
  >([]);
  const [audioOutputs, setAudioOutputs] = useState<
    Array<{ deviceId: string; label: string }>
  >([]);
  const [selectedSinkId, setSelectedSinkId] = useState<string>('default');

  const refreshBridgeData = () => {
    setPermState(bluetoothBridge.getPermissionState());
    setPairedAndroidDevices(bluetoothBridge.getPairedAndroidSpeakers());
    bluetoothBridge.listAudioOutputDevices().then(setAudioOutputs);
  };

  useEffect(() => {
    if (!open) return;
    setNameInput(system.deviceName);
    refreshBridgeData();
    const unsub = bluetoothBridge.onPermissionsChanged((st) => {
      setPermState(st);
      setPairedAndroidDevices(bluetoothBridge.getPairedAndroidSpeakers());
    });
    return unsub;
  }, [open, system.deviceName]);

  if (!open) return null;

  const handleRequestPermissions = async () => {
    setRequestingPerms(true);
    setStatusMessage(null);
    const res = await bluetoothBridge.requestAllSpeakerPermissions();
    setPermState(res.state);
    setPairedAndroidDevices(bluetoothBridge.getPairedAndroidSpeakers());
    const outs = await bluetoothBridge.listAudioOutputDevices();
    setAudioOutputs(outs);
    setStatusMessage(res.message);
    setRequestingPerms(false);
  };

  const handleScanBluetooth = async (jblFilterOnly: boolean) => {
    setScanning(true);
    setStatusMessage(null);
    const res = await bluetoothBridge.scanAndConnectBleSpeaker(jblFilterOnly, () => {
      onSwitchToDemo();
    });
    setScanning(false);
    setStatusMessage(res.message);
    if (res.ok && res.deviceName) {
      onConnectSpeaker(
        res.deviceName,
        permState.isAndroidApk ? 'android_bt' : 'ble',
        res.batteryLevel
      );
    }
  };

  const handleSelectOutputSink = async (deviceId: string) => {
    setSelectedSinkId(deviceId);
    const ok = await audioEngine.setOutputSink(deviceId);
    if (ok) {
      const found = audioOutputs.find((d) => d.deviceId === deviceId);
      setStatusMessage(
        `יציאת האודיו של האפליקציה הועברה אל: ${found?.label || 'התקן Bluetooth'}`
      );
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameInput.trim();
    if (cleaned) {
      onRenameSpeaker(cleaned);
    }
  };

  const isConnected =
    system.connectionType === 'ble' || system.connectionType === 'android_bt';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 p-0 backdrop-blur-xs sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-[#1E2738] sm:rounded-2xl">
        {/* Mobile drag handle */}
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-600 sm:hidden" />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Bluetooth className="h-5 w-5 text-[#D95B2B]" />
            <h2
              id="connection-modal-title"
              className="font-display text-lg font-semibold text-slate-900 dark:text-white"
            >
              חיבור בלוטוס והרשאות רמקול
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת חלון חיבור"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Active Speaker Status */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Speaker className="h-4 w-4 text-[#D95B2B]" />
                <span>{system.deviceName}</span>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  {isConnected
                    ? `מחובר (${system.bleDeviceTitle || system.deviceName})`
                    : 'מוכן להזרמת שמע'}
                </span>
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              האפליקציה כוללת הרשאות מלאות ל-Bluetooth (סריקה, חיבור וזיווג), בקרת עוצמת שמע חומרתית, מיקרופון לסנכרון קצב ומעבד איקוולייזר 7 ערוצים הפועל בזמן אמת מול הרמקול הנייד.
            </p>
          </div>

          {/* Step 1: Hardware Permissions Check & Grant */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#182030]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <span>הרשאות Bluetooth, מיקום סריקה ושמע</span>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {permState.bluetoothConnect && permState.bluetoothScan
                  ? 'הרשאות פעילות'
                  : 'נדרש אישור'}
              </span>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
              <span>
                Bluetooth: <strong>{permState.bluetoothConnect ? 'מאושר' : 'ממתין'}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                סריקת מכשירים קרובים: <strong>{permState.bluetoothScan ? 'מאושר' : 'ממתין'}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                שמע ומיקרופון: <strong>{permState.microphone ? 'מאושר' : 'זמין'}</strong>
              </span>
            </div>

            <button
              type="button"
              disabled={requestingPerms}
              onClick={handleRequestPermissions}
              className="mt-3 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:bg-[#141B27] dark:text-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ShieldCheck className="h-4 w-4 text-[#D95B2B]" />
              <span>
                {requestingPerms
                  ? 'מבקש הרשאות מערכת...'
                  : 'אשר והפעל את כל ההרשאות לרמקול (Bluetooth + שמע)'}
              </span>
            </button>
          </div>

          {/* Native Android Paired Speakers List (Visible inside installed Android APK) */}
          {permState.isAndroidApk && (
            <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-[#141B27]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  רמקולי Bluetooth מזווגים במכשיר האנדרואיד
                </span>
                <button
                  type="button"
                  onClick={refreshBridgeData}
                  className="flex items-center gap-1 text-xs text-[#D95B2B] hover:underline cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>רענן</span>
                </button>
              </div>

              {pairedAndroidDevices.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  טרם נמצא רמקול מזווג או שנדרש אישור הרשאת ״מכשירים קרובים״. לחץ למטה לפתיחת הגדרות ה-Bluetooth באנדרואיד וזווג את ה-JBL PartyBox 320.
                </p>
              ) : (
                <div className="space-y-2">
                  {pairedAndroidDevices.map((dev) => (
                    <button
                      key={dev.address || dev.name}
                      type="button"
                      onClick={() => {
                        onConnectSpeaker(dev.name, 'android_bt');
                        setStatusMessage(
                          `מחובר לרמקול "${dev.name}" — השמע, הווליום והאיקוולייזר מסונכרנים.`
                        );
                      }}
                      className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-right text-xs hover:border-[#D95B2B] dark:border-slate-700 dark:bg-[#1E2738] cursor-pointer"
                    >
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {dev.name}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400" dir="ltr">
                          {dev.address}
                        </div>
                      </div>
                      <span className="font-medium text-[#D95B2B]">
                        {dev.isActiveAudioRoute ? 'פעיל כעת בשמע' : 'בחר רמקול'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => bluetoothBridge.openAndroidBluetoothSettings()}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-[#1E2738] dark:text-white cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>פתח הגדרות Bluetooth באנדרואיד לזיווג הרמקול</span>
              </button>
            </div>
          )}

          {/* Step 2: Bluetooth BLE Scanner Buttons */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={scanning}
                onClick={() => handleScanBluetooth(true)}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#D95B2B] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#C24E22] disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Bluetooth className="h-4 w-4" />
                <span>
                  {scanning ? 'סורק רמקולי JBL...' : 'סרוק רמקול JBL PartyBox'}
                </span>
              </button>

              <button
                type="button"
                disabled={scanning}
                onClick={() => handleScanBluetooth(false)}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap cursor-pointer"
              >
                <Bluetooth className="h-4 w-4 text-[#D95B2B]" />
                <span>סרוק את כל התקני ה-Bluetooth</span>
              </button>
            </div>

            {isConnected && (
              <button
                type="button"
                onClick={onSwitchToDemo}
                className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300 cursor-pointer"
              >
                נתק חיבור Bluetooth וחזור למצב אולפן מקומי
              </button>
            )}

            {statusMessage && (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-300">
                {statusMessage}
              </p>
            )}
          </div>

          {/* Audio Output Routing (if browser exposes audiooutput devices) */}
          {audioOutputs.length > 1 && (
            <div className="space-y-1.5 border-t border-slate-200/80 pt-4 dark:border-slate-700/60">
              <label
                htmlFor="audio-sink-select"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                <Volume2 className="h-3.5 w-3.5 text-[#D95B2B]" />
                <span>ניתוב יציאת שמע (בחר את רמקול ה-Bluetooth שלך):</span>
              </label>
              <select
                id="audio-sink-select"
                value={selectedSinkId}
                onChange={(e) => handleSelectOutputSink(e.target.value)}
                className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 focus:border-[#D95B2B] focus:outline-none dark:border-slate-700 dark:bg-[#141B27] dark:text-slate-200"
              >
                {audioOutputs.map((out) => (
                  <option key={out.deviceId} value={out.deviceId}>
                    {out.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Custom Speaker Name */}
          <form
            onSubmit={handleRenameSubmit}
            className="space-y-2 border-t border-slate-200/80 pt-4 dark:border-slate-700/60"
          >
            <label
              htmlFor="speaker-custom-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              שם הרמקול בתצוגה
            </label>
            <div className="flex gap-2">
              <input
                id="speaker-custom-name"
                type="text"
                maxLength={28}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="min-h-[42px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 focus:border-[#D95B2B] focus:outline-none dark:border-slate-700 dark:bg-[#141B27] dark:text-white"
              />
              <button
                type="submit"
                className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-100 px-4 text-xs font-semibold text-slate-800 hover:bg-slate-200 dark:border-slate-700 dark:bg-[#141B27] dark:text-white dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                עדכן שם
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
