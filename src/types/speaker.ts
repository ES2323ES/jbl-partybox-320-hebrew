export enum NavTab {
  Overview = 'overview',
  Lightshow = 'lightshow',
  Equalizer = 'equalizer',
  PartyFx = 'party_fx',
  ApkDownload = 'apk_download',
}

export type AppVisualTheme = 'light' | 'dark' | 'neon';

export enum LightshowPresetId {
  Neon = 'neon',
  Rock = 'rock',
  Flow = 'flow',
  Cross = 'cross',
  Ripple = 'ripple',
  Flash = 'flash',
  Freeze = 'freeze',
}

export enum EqPresetId {
  JblSignature = 'jbl_signature',
  Party = 'party',
  Vocal = 'vocal',
  DeepBass = 'deep_bass',
  Outdoor = 'outdoor',
  Flat = 'flat',
  Custom = 'custom',
}

export enum BassBoostMode {
  Off = 'off',
  Deep = 'deep',
  Punchy = 'punchy',
}

export enum AcousticEnvironment {
  Indoor = 'indoor',
  Outdoor = 'outdoor',
}

export enum AuracastMode {
  Single = 'single',
  Stereo = 'stereo',
  PartyBroadcast = 'party_broadcast',
}

export type LightZoneKey =
  | 'rings'
  | 'strobeTop'
  | 'strobeBottom'
  | 'starry'
  | 'sideRails';

export interface LightZonesState {
  rings: boolean;
  strobeTop: boolean;
  strobeBottom: boolean;
  starry: boolean;
  sideRails: boolean;
}

export interface LightshowState {
  enabled: boolean;
  preset: LightshowPresetId;
  primaryColor: string;
  secondaryColor: string;
  brightness: number; // 10 - 100
  speed: number; // 0.3 - 2.5
  strobeIntensity: number; // 0 - 100
  beatSync: boolean;
  zones: LightZonesState;
}

export interface EqBandDefinition {
  index: number;
  freq: number;
  labelHz: string;
  hebrewRole: string;
}

export interface SavedEqProfile {
  id: string;
  name: string;
  gains: number[]; // length 7, -12 to +12 dB
  createdAt: string;
}

export interface EqualizerState {
  preset: EqPresetId;
  activeCustomId: string | null;
  gains: number[]; // length 7
  bassBoost: BassBoostMode;
  aiSoundBoost: boolean;
  environment: AcousticEnvironment;
}

export interface MicGuitarState {
  mic1Connected: boolean;
  mic1Volume: number; // 0 - 100
  mic1Bass: number; // -6 to +6
  mic1Treble: number; // -6 to +6
  mic1Echo: number; // 0 - 100
  channel2Mode: 'mic' | 'guitar';
  channel2Volume: number; // 0 - 100
  channel2Gain: number; // 0 - 100
  vocalDucking: boolean;
  liveKaraokeActive?: boolean;
}

export const APP_VERSION = '0.2.3';

export interface SpeakerSystemState {
  deviceName: string;
  connectionType: 'demo' | 'ble' | 'android_bt';
  bleDeviceTitle: string | null;
  volume: number; // 0 - 100
  muted: boolean;
  batteryPercent: number;
  playtimeBoost: boolean;
  auracastMode: AuracastMode;
  stereoChannel: 'L' | 'R';
  autoReconnect: boolean;
  notificationControlsEnabled: boolean;
}

export type DemoGrooveId =
  | 'house_124'
  | 'sub_tech_128'
  | 'mediterranean_112'
  | 'bass_sweep';

export type DjPadEffectId =
  | 'airhorn'
  | 'bassdrop'
  | 'laser'
  | 'scratch'
  | 'applause'
  | 'siren';

export type PartySceneId =
  | 'neon_club'
  | 'chill_welcome'
  | 'peak_party'
  | 'karaoke_stage'
  | 'night_neighbors';

export interface PartySceneDefinition {
  id: PartySceneId;
  title: string;
  subtitle: string;
  lightPreset: LightshowPresetId;
  primaryColor: string;
  secondaryColor: string;
  brightness: number;
  strobeIntensity: number;
  disableStrobes?: boolean;
  gains: number[];
  bassBoost: BassBoostMode;
  volume: number;
  vocalDucking?: boolean;
  echo?: number;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  url: string;
}

export interface CustomSamplerSlot {
  slotIndex: number; // 0..3
  label: string;
  audioDataUrl: string | null;
  durationSec: number;
}

export interface FullBackupBundle {
  appVersion: string;
  exportedAt: string;
  lightshow: LightshowState;
  eq: EqualizerState;
  micGuitar: MicGuitarState;
  savedProfiles: SavedEqProfile[];
  customSamples?: CustomSamplerSlot[];
}

export const EQ_BANDS: EqBandDefinition[] = [
  { index: 0, freq: 63, labelHz: '63Hz', hebrewRole: 'סאב-בס' },
  { index: 1, freq: 125, labelHz: '125Hz', hebrewRole: 'הדף בס' },
  { index: 2, freq: 250, labelHz: '250Hz', hebrewRole: 'חמימות' },
  { index: 3, freq: 500, labelHz: '500Hz', hebrewRole: 'גוף צליל' },
  { index: 4, freq: 1000, labelHz: '1kHz', hebrewRole: 'נוכחות קול' },
  { index: 5, freq: 4000, labelHz: '4kHz', hebrewRole: 'חדות ופירוט' },
  { index: 6, freq: 12000, labelHz: '12kHz', hebrewRole: 'גבוהים ואוויר' },
];

export const BUILTIN_EQ_PRESETS: Record<
  Exclude<EqPresetId, EqPresetId.Custom>,
  { title: string; subtitle: string; gains: number[] }
> = {
  [EqPresetId.JblSignature]: {
    title: 'JBL Signature',
    subtitle: 'איזון המקור של סדרת Stage 320 עם בס הדוק וגבוהים צלולים',
    gains: [4.5, 3.0, -0.5, 0.0, 1.5, 3.0, 4.0],
  },
  [EqPresetId.Party]: {
    title: 'מסיבה עוצמתית',
    subtitle: 'הדגשת V דינמית לרחבות ריקודים ומוזיקה אלקטרונית',
    gains: [6.5, 5.0, 1.0, -1.5, 1.0, 4.0, 5.5],
  },
  [EqPresetId.Vocal]: {
    title: 'ווקאל וקריוקי',
    subtitle: 'ניקוי תדרים נמוכים והבלטת שירה, דיבור וכלי מיתר',
    gains: [-2.0, -1.5, 1.0, 3.5, 5.0, 3.5, 1.5],
  },
  [EqPresetId.DeepBass]: {
    title: 'בס עמוק',
    subtitle: 'דחיפת תדרי 63Hz–125Hz להיפ-הופ, טראפ ודאנס',
    gains: [8.0, 6.0, 2.0, -1.0, 0.0, 1.5, 2.5],
  },
  [EqPresetId.Outdoor]: {
    title: 'שטח פתוח',
    subtitle: 'פיצוי אקוסטי לאובדן תדרי בס והקרנה למרחק בחוץ',
    gains: [7.0, 5.5, 2.5, 1.0, 2.5, 4.5, 4.0],
  },
  [EqPresetId.Flat]: {
    title: 'ניטרלי (0dB)',
    subtitle: 'תגובת תדר שטוחה ללא התערבות לכיול אולפני מדויק',
    gains: [0, 0, 0, 0, 0, 0, 0],
  },
};

export const LIGHTSHOW_PRESETS: Record<
  LightshowPresetId,
  {
    title: string;
    description: string;
    defaultPrimary: string;
    defaultSecondary: string;
  }
> = {
  [LightshowPresetId.Neon]: {
    title: 'ניאון זוהר (Neon)',
    description: 'הילת ניאון דו-שכבתית בטורקיז חשמלי ומג׳נטה זוהרת עם שובלי אור מסונכרנים',
    defaultPrimary: '#00F0FF',
    defaultSecondary: '#E838FF',
  },
  [LightshowPresetId.Rock]: {
    title: 'רוק (Rock)',
    description: 'פעימות אנרגטיות חדות בטבעות הוופרים עם הבזקים מסונכרנים לקצב התופים',
    defaultPrimary: '#FF5500',
    defaultSecondary: '#FFB800',
  },
  [LightshowPresetId.Flow]: {
    title: 'זרימה (Flow)',
    description: 'מעברי צבע נוזליים ורציפים לאורך שמיניית התאורה ופסי הצד',
    defaultPrimary: '#00D2FF',
    defaultSecondary: '#3A7BD5',
  },
  [LightshowPresetId.Cross]: {
    title: 'חצייה (Cross)',
    description: 'סיבוב מנוגד בין הטבעת העליונה לתחתונה ליצירת תנועת שמינייה היפנוטית',
    defaultPrimary: '#FF2E63',
    defaultSecondary: '#FF8A00',
  },
  [LightshowPresetId.Ripple]: {
    title: 'אדוות (Ripple)',
    description: 'גלי הדף מתפשטים ממרכז הוופרים החוצה בכל מכת בס עמוקה',
    defaultPrimary: '#10B981',
    defaultSecondary: '#06B6D4',
  },
  [LightshowPresetId.Flash]: {
    title: 'מבזק מועדון (Flash)',
    description: 'דגש על מבזקי הסטרוב העליון והתחתון יחד עם נצנוצי כוכבים מהירים',
    defaultPrimary: '#F8FAFC',
    defaultSecondary: '#FF5500',
  },
  [LightshowPresetId.Freeze]: {
    title: 'תאורת אווירה קבועה',
    description: 'הארה אחידה ושקטה בצבע נבחר ללא הבהובים לחללי אירוח וסלון',
    defaultPrimary: '#FF6B2B',
    defaultSecondary: '#FF9E68',
  },
};

export const COLOR_SWATCH_PAIRS: Array<{
  id: string;
  name: string;
  primary: string;
  secondary: string;
}> = [
  { id: 'neon_cyber', name: 'ניאון חשמלי', primary: '#00F0FF', secondary: '#E838FF' },
  { id: 'neon_sunset', name: 'ניאון שקיעה', primary: '#FF2A85', secondary: '#7B2CBF' },
  { id: 'jbl_orange', name: 'כתום JBL', primary: '#FF5500', secondary: '#FFB800' },
  { id: 'arctic_cyan', name: 'קרח טורקיז', primary: '#06B6D4', secondary: '#3B82F6' },
  { id: 'emerald_pulse', name: 'אזמרגד חי', primary: '#10B981', secondary: '#84CC16' },
  { id: 'amber_lounge', name: 'ענבר חם', primary: '#F59E0B', secondary: '#FDE047' },
];

export const PARTY_SCENES: PartySceneDefinition[] = [
  {
    id: 'neon_club',
    title: 'מועדון ניאון זוהר',
    subtitle: 'תאורת ניאון חשמלית + איקוולייזר מסיבה ובס הדוק',
    lightPreset: LightshowPresetId.Neon,
    primaryColor: '#00F0FF',
    secondaryColor: '#E838FF',
    brightness: 95,
    strobeIntensity: 45,
    gains: [6.5, 5.0, 1.0, -1.0, 1.5, 4.0, 5.5],
    bassBoost: BassBoostMode.Punchy,
    volume: 82,
  },
  {
    id: 'chill_welcome',
    title: 'קבלת פנים רגועה',
    subtitle: 'זרימת תאורה רכה ללא סטרובים + סאונד מאוזן ונעים',
    lightPreset: LightshowPresetId.Flow,
    primaryColor: '#38BDF8',
    secondaryColor: '#818CF8',
    brightness: 55,
    strobeIntensity: 0,
    disableStrobes: true,
    gains: [3.5, 2.5, 0.5, 0.0, 1.0, 2.5, 3.0],
    bassBoost: BassBoostMode.Deep,
    volume: 48,
  },
  {
    id: 'peak_party',
    title: 'שיא מסיבה',
    subtitle: 'עוצמה גבוהה, בס עמוק ומבזקים מסונכרנים לקצב',
    lightPreset: LightshowPresetId.Rock,
    primaryColor: '#FF5500',
    secondaryColor: '#FFB800',
    brightness: 100,
    strobeIntensity: 75,
    gains: [8.0, 6.0, 2.0, -1.0, 1.0, 3.5, 4.5],
    bassBoost: BassBoostMode.Punchy,
    volume: 88,
  },
  {
    id: 'karaoke_stage',
    title: 'במת קריוקי ושירה',
    subtitle: 'הבלטת תדרי קול, הד שירה והנמכת מוזיקה אוטומטית',
    lightPreset: LightshowPresetId.Ripple,
    primaryColor: '#EC4899',
    secondaryColor: '#8B5CF6',
    brightness: 75,
    strobeIntensity: 10,
    disableStrobes: true,
    gains: [-2.0, -1.5, 1.0, 3.5, 5.0, 3.5, 1.5],
    bassBoost: BassBoostMode.Off,
    volume: 68,
    vocalDucking: true,
    echo: 42,
  },
  {
    id: 'night_neighbors',
    title: 'מצב לילה לשכנים',
    subtitle: 'סינון תדרי סאב שעוברים קירות ושמירה על צליל עשיר וברור',
    lightPreset: LightshowPresetId.Freeze,
    primaryColor: '#F59E0B',
    secondaryColor: '#FB923C',
    brightness: 30,
    strobeIntensity: 0,
    disableStrobes: true,
    gains: [-6.5, -4.5, 0.0, 1.5, 2.5, 2.5, 1.5],
    bassBoost: BassBoostMode.Off,
    volume: 34,
  },
];
