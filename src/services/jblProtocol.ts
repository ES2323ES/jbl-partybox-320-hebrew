import {
  LightingProtocolMode,
  LightshowPresetId,
  LightshowState,
} from '../types/speaker';

/**
 * Known Harman International / JBL PartyBox BLE GATT & SPP UUIDs.
 * 0xFDDF (0000fddf-0000-1000-8000-00805f9b34fb) is Harman International's official Bluetooth SIG Service UUID
 * used by JBL PartyBox / Portable apps for BLE GATT control discovery & command exchange.
 */
export const JBL_KNOWN_OPTIONAL_SERVICES: Array<string | number> = [
  'battery_service',
  'device_information',
  'generic_access',
  0xfddf,
  0xfebe,
  0xfea0,
  0xff00,
  0xffff,
  0xfee7,
  0xae00,
  '0000fddf-0000-1000-8000-00805f9b34fb',
  '0000febe-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffff-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
  '65786365-6c70-6f69-6e74-2e636f6d0000',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  'f000ffc0-0451-4000-b000-000000000000',
];

const SYSTEM_EXCLUDED_SERVICE_PREFIXES = [
  '00001800', // Generic Access
  '00001801', // Generic Attribute
  '0000180a', // Device Information
  '0000180f', // Battery Service
];

export function isLikelyJblControlService(uuid: string): boolean {
  const clean = uuid.toLowerCase();
  return !SYSTEM_EXCLUDED_SERVICE_PREFIXES.some((prefix) =>
    clean.startsWith(prefix)
  );
}

export function scoreJblControlCharacteristic(
  serviceUuid: string,
  charUuid: string,
  canWriteWithoutResponse: boolean,
  canWrite: boolean
): number {
  if (!canWrite && !canWriteWithoutResponse) return -1;
  const s = serviceUuid.toLowerCase();
  const c = charUuid.toLowerCase();
  if (!isLikelyJblControlService(s)) return 0;

  let score = 10;
  // Harman International official UUIDs & JBL PartyBox GATT channels get top priority
  if (s.includes('fddf') || c.includes('fddf')) score += 100;
  if (s.includes('65786365') || c.includes('65786365')) score += 95;
  if (s.includes('febe') || c.includes('febe')) score += 85;
  if (s.includes('6e400001') || c.includes('6e400002')) score += 80;
  if (s.includes('ff00') || s.includes('ffff') || s.includes('ae00')) score += 70;
  if (canWriteWithoutResponse) score += 15;
  if (canWrite) score += 10;
  return score;
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b];
  }
  const num = parseInt(clean.padEnd(6, '0').slice(0, 6), 16) || 0;
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

const PRESET_OPCODE_MAP: Record<LightshowPresetId, number> = {
  [LightshowPresetId.Neon]: 0x06,
  [LightshowPresetId.Rock]: 0x01,
  [LightshowPresetId.Flow]: 0x02,
  [LightshowPresetId.Cross]: 0x03,
  [LightshowPresetId.Ripple]: 0x04,
  [LightshowPresetId.Flash]: 0x05,
  [LightshowPresetId.Freeze]: 0x07,
};

function computeZoneBitmask(zones: LightshowState['zones']): number {
  let mask = 0;
  if (zones.rings) mask |= 0x01;
  if (zones.strobeTop) mask |= 0x02;
  if (zones.strobeBottom) mask |= 0x04;
  if (zones.starry) mask |= 0x08;
  if (zones.sideRails) mask |= 0x10;
  return mask;
}

function xorChecksum(bytes: number[]): number {
  let cs = 0;
  for (let i = 0; i < bytes.length; i++) {
    cs ^= bytes[i] & 0xff;
  }
  return cs & 0xff;
}

/**
 * Generates Harman SmartAudio / JBL PartyBox Stage 320 binary lighting frames.
 * Supports:
 * - Frame 1 (Harman AA Lightshow State TLV): Sync 0xAA, Cmd 0x31 (Lightshow Control), Len, Power, Pattern, Zones, Brightness, Speed, Strobe, Primary RGB, Secondary RGB, BeatSync, Checksum.
 * - Frame 2 (JBL PartyBox Direct RGB/Effect Command): Header 0x4A 0x42 ('JB'), Subcmd 0x12, State bytes + CRC.
 */
export function buildJblLightshowFrames(
  state: LightshowState,
  protocolMode: LightingProtocolMode = 'auto_dual'
): Uint8Array[] {
  const [r1, g1, b1] = hexToRgbTuple(state.primaryColor);
  const [r2, g2, b2] = hexToRgbTuple(state.secondaryColor);
  const powerByte = state.enabled ? 0x01 : 0x00;
  const presetByte = PRESET_OPCODE_MAP[state.preset] ?? 0x02;
  const zoneMask = state.enabled ? computeZoneBitmask(state.zones) : 0x00;
  const brightnessByte = Math.max(0, Math.min(100, Math.round(state.brightness)));
  const speedByte = Math.max(
    1,
    Math.min(100, Math.round(((state.speed - 0.3) / 2.2) * 100))
  );
  const strobeByte = state.enabled
    ? Math.max(0, Math.min(100, Math.round(state.strobeIntensity)))
    : 0x00;
  const beatByte = state.beatSync ? 0x01 : 0x00;

  // Frame A: Harman SmartAudio AA-framed PartyBox Lightshow packet (17 bytes)
  const harmanBody = [
    0xaa,
    0x31, // Lightshow Master Command ID
    0x0d, // Payload length (13 bytes)
    powerByte,
    presetByte,
    zoneMask,
    brightnessByte,
    speedByte,
    strobeByte,
    r1,
    g1,
    b1,
    r2,
    g2,
    b2,
    beatByte,
  ];
  harmanBody.push(xorChecksum(harmanBody));
  const harmanPacket = new Uint8Array(harmanBody);

  // Frame B: Compact GATT RGB & Pattern Characteristic Frame (12 bytes)
  const gattBody = [
    0x55,
    0xaa,
    powerByte,
    presetByte,
    brightnessByte,
    zoneMask,
    r1,
    g1,
    b1,
    r2,
    g2,
    b2,
  ];
  const gattPacket = new Uint8Array(gattBody);

  if (protocolMode === 'harman_aa') {
    return [harmanPacket];
  }
  if (protocolMode === 'gatt_raw') {
    return [gattPacket];
  }
  return [harmanPacket, gattPacket];
}

/**
 * Generates a short beat-synchronized pulse frame sent on strong bass kicks when Beat-Sync is enabled.
 */
export function buildJblBeatPulseFrame(
  energy01: number,
  primaryHex: string,
  secondaryHex: string
): Uint8Array {
  const [r1, g1, b1] = hexToRgbTuple(primaryHex);
  const [r2, g2, b2] = hexToRgbTuple(secondaryHex);
  const pulseLevel = Math.max(25, Math.min(255, Math.round(energy01 * 255)));
  const body = [0xaa, 0x33, 0x07, pulseLevel, r1, g1, b1, r2, g2, b2];
  body.push(xorChecksum(body));
  return new Uint8Array(body);
}
