import React, { useState } from 'react';
import { Bluetooth, CheckCircle2, Speaker, X } from 'lucide-react';
import { SpeakerSystemState } from '../types/speaker';

interface ConnectionModalProps {
  open: boolean;
  system: SpeakerSystemState;
  onClose: () => void;
  onConnectBle: (deviceTitle: string) => void;
  onSwitchToDemo: () => void;
  onRenameSpeaker: (newName: string) => void;
}

interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean;
      optionalServices?: string[];
    }) => Promise<{ name?: string; id: string }>;
  };
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  open,
  system,
  onClose,
  onConnectBle,
  onSwitchToDemo,
  onRenameSpeaker,
}) => {
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState(system.deviceName);

  if (!open) return null;

  const handleWebBluetoothScan = async () => {
    setStatusMessage(null);
    const nav = navigator as NavigatorWithBluetooth;
    if (!nav.bluetooth) {
      setStatusMessage(
        'הדפדפן הנוכחי אינו חושף ממשק Web Bluetooth ישיר. באפשרותך לחבר את ה-PartyBox 320 בהגדרות ה-Bluetooth של המכשיר ולהזרים אליו את הסאונד והאיקוולייזר בזמן אמת מהאפליקציה.'
      );
      return;
    }

    try {
      setScanning(true);
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      const label = device.name || 'JBL PartyBox Stage 320';
      onConnectBle(label);
      setStatusMessage(`התקן "${label}" חובר בהצלחה.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('chosen')) {
        setStatusMessage('סריקת ה-Bluetooth בוטלה על ידי המשתמש.');
      } else {
        setStatusMessage(
          'גישת BLE ישירה חסומה במסגרת התצוגה המקדימה — חבר את הרמקול ב-Bluetooth הראשי של הטלפון/המחשב להזרמת שמע מלאה דרך מנוע האיקוולייזר.'
        );
      }
    } finally {
      setScanning(false);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = nameInput.trim();
    if (cleaned) {
      onRenameSpeaker(cleaned);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-modal-title"
    >
      <div className="w-full max-w-lg rounded-t-3xl border border-white/[0.1] bg-[#141821] p-6 shadow-2xl sm:rounded-2xl">
        {/* Mobile drag handle */}
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/15 sm:hidden" />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Bluetooth className="h-5 w-5 text-[#FF5500]" />
            <h2
              id="connection-modal-title"
              className="font-display text-lg font-semibold text-white"
            >
              חיבור והגדרות JBL PartyBox 320
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת חלון חיבור"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          {/* Active Mode Summary */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0B0D11] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Speaker className="h-4 w-4 text-[#FF5500]" />
                <span>{system.deviceName}</span>
              </div>
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  {system.connectionType === 'ble'
                    ? `מחובר ב-BLE (${system.bleDeviceTitle})`
                    : 'מעבד שמע והדמיה פעילים'}
                </span>
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              כל שינוי באיקוולייזר 7 הערוצים, ב-BassBoost ובאפקטי ה-PartyPad מעובד בזמן אמת ביציאת האודיו. כאשר המכשיר מחובר לרמקול ה-JBL ב-Bluetooth רגיל, השמע המכויל מוזרם ישירות אליו.
            </p>
          </div>

          {/* Web Bluetooth BLE Scan Trigger */}
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={scanning}
              onClick={handleWebBluetoothScan}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#FF5500] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#E64D00] disabled:opacity-60"
            >
              <Bluetooth className="h-4 w-4" />
              <span>
                {scanning
                  ? 'סורק התקני JBL קרובים...'
                  : 'סריקת רמקול באמצעות Web Bluetooth (BLE)'}
              </span>
            </button>

            {system.connectionType === 'ble' && (
              <button
                type="button"
                onClick={onSwitchToDemo}
                className="min-h-[42px] w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.07]"
              >
                חזרה למצב אולפן מקומי
              </button>
            )}

            {statusMessage && (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-300">
                {statusMessage}
              </p>
            )}
          </div>

          {/* Custom Speaker Name */}
          <form
            onSubmit={handleRenameSubmit}
            className="space-y-2 border-t border-white/[0.08] pt-4"
          >
            <label
              htmlFor="speaker-custom-name"
              className="block text-xs font-medium text-slate-300"
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
                className="min-h-[42px] flex-1 rounded-xl border border-white/[0.12] bg-[#0B0D11] px-3.5 text-sm text-white focus:border-[#FF5500] focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[42px] rounded-xl border border-white/[0.12] bg-white/[0.06] px-4 text-xs font-semibold text-white hover:bg-white/[0.12] whitespace-nowrap shrink-0"
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
