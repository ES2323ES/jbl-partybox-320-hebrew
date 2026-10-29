import {
  AcousticEnvironment,
  AudioSyncSourceMode,
  BassBoostMode,
  DemoGrooveId,
  DjPadEffectId,
  EQ_BANDS,
} from '../types/speaker';
import { bluetoothBridge } from './bluetoothBridge';
import { faultLogger } from './faultLogger';

export interface AudioAnalysisFrame {
  spectrum: number[]; // 28 normalized bars 0..1
  subBassEnergy: number; // 0..1 (40Hz - 110Hz)
  midEnergy: number; // 0..1
  highEnergy: number; // 0..1
  isBeat: boolean;
  detectedBpm: number; // 0 when idle, 70..180 when active rhythm detected
  djFlare: number; // 0..1 decaying flare triggered by DJ pads
  karaokeVoiceLevel: number; // 0..1 live vocal mic energy
  externalMusicActive: boolean;
}

export interface RoomCalibrationResult {
  calibratedGains: number[];
  detectedEnvironment: AcousticEnvironment;
  summaryHe: string;
  usedLiveMic: boolean;
}

class PartyBoxAudioEngine {
  private ctx: AudioContext | null = null;
  private musicDuckGain: GainNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassBoostFilter: BiquadFilterNode | null = null;
  private environmentLowFilter: BiquadFilterNode | null = null;
  private environmentHighFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;

  // Live External Player Sync & Studio Test State (Zero Song Upload!)
  private sourceMode: AudioSyncSourceMode = 'player_sync';
  private isPlaying = false;
  private currentGroove: DemoGrooveId = 'house_124';
  private grooveTimer: number | null = null;
  private stepIndex = 0;
  private stateListeners = new Set<() => void>();

  // External Player Capture Streams (Acoustic Room/Player Sync or Direct System Audio)
  private syncStream: MediaStream | null = null;
  private syncSource: MediaStreamAudioSourceNode | null = null;
  private syncAnalyser: AnalyserNode | null = null;
  private syncFreqData: Uint8Array<ArrayBuffer> | null = null;

  // Live Karaoke Mic Chain + Voice-Activated MC Auto-Ducking
  private karaokeStream: MediaStream | null = null;
  private karaokeSource: MediaStreamAudioSourceNode | null = null;
  private karaokeHpFilter: BiquadFilterNode | null = null;
  private karaokeBassFilter: BiquadFilterNode | null = null;
  private karaokeTrebleFilter: BiquadFilterNode | null = null;
  private karaokeDryGain: GainNode | null = null;
  private karaokeDelay: DelayNode | null = null;
  private karaokeFeedback: GainNode | null = null;
  private karaokeWetGain: GainNode | null = null;
  private karaokeAnalyser: AnalyserNode | null = null;
  private karaokeTimeData: Uint8Array<ArrayBuffer> | null = null;
  private karaokeActive = false;
  private karaokeVocalDucking = false;
  private lastVoiceDetectedMs = 0;
  private currentVoiceRms = 0;

  // Custom 4-Slot Sampler MediaRecorder
  private activeRecorder: MediaRecorder | null = null;

  // Beat, BPM & DJ flare tracking (zero-GC preallocated buffers)
  private reusableSpectrum: number[] = new Array(28).fill(0.03);
  private prevBassAvg = 0;
  private lastBeatTime = 0;
  private beatIntervalsMs: number[] = [];
  private detectedBpm = 0;
  private djFlareValue = 0;
  private beatListeners = new Set<(energy: number) => void>();

  // Stored DSP settings for pre-init sync
  private currentGains: number[] = [4.5, 3.0, -0.5, 0.0, 1.5, 3.0, 4.0];
  private currentBassBoost: BassBoostMode = BassBoostMode.Deep;
  private currentEnvironment: AcousticEnvironment = AcousticEnvironment.Indoor;
  private currentAiBoost = true;
  private currentPlaytimeBoost = false;
  private currentVolume = 72;
  private currentMuted = false;

  public onStateChange(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  public onBeatDetected(cb: (energy: number) => void): () => void {
    this.beatListeners.add(cb);
    return () => {
      this.beatListeners.delete(cb);
    };
  }

  private notifyStateChanged(): void {
    this.stateListeners.forEach((cb) => cb());
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AudioCtx();

      this.musicDuckGain = this.ctx.createGain();
      this.musicDuckGain.gain.value = 1.0;

      // Build 7-Band EQ chain
      this.eqFilters = EQ_BANDS.map((band, idx) => {
        const filter = this.ctx!.createBiquadFilter();
        if (idx === 0) {
          filter.type = 'lowshelf';
        } else if (idx === EQ_BANDS.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.25;
        }
        filter.frequency.value = band.freq;
        filter.gain.value = this.currentGains[idx] ?? 0;
        return filter;
      });

      this.bassBoostFilter = this.ctx.createBiquadFilter();
      this.bassBoostFilter.type = 'peaking';

      this.environmentLowFilter = this.ctx.createBiquadFilter();
      this.environmentLowFilter.type = 'lowshelf';
      this.environmentLowFilter.frequency.value = 95;

      this.environmentHighFilter = this.ctx.createBiquadFilter();
      this.environmentHighFilter.type = 'highshelf';
      this.environmentHighFilter.frequency.value = 6500;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.14;

      this.masterGain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.74;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

      // Output chain: musicDuckGain -> eq[0..6] -> bassBoost -> envLow -> envHigh -> compressor -> analyser -> masterGain -> destination
      this.musicDuckGain.connect(this.eqFilters[0]);
      for (let i = 0; i < this.eqFilters.length - 1; i++) {
        this.eqFilters[i].connect(this.eqFilters[i + 1]);
      }
      const lastEq = this.eqFilters[this.eqFilters.length - 1];
      lastEq.connect(this.bassBoostFilter);
      this.bassBoostFilter.connect(this.environmentLowFilter);
      this.environmentLowFilter.connect(this.environmentHighFilter);
      this.environmentHighFilter.connect(this.compressor);
      this.compressor.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.applyDspSettings();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getChainInput(): AudioNode {
    this.ensureContext();
    return this.musicDuckGain!;
  }

  public applyDspSettings(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.eqFilters.forEach((filter, idx) => {
      const targetGain = this.currentPlaytimeBoost
        ? (this.currentGains[idx] ?? 0) * 0.65 - (idx <= 1 ? 2.5 : 0)
        : (this.currentGains[idx] ?? 0);
      filter.gain.setTargetAtTime(targetGain, now, 0.025);
    });

    if (this.bassBoostFilter) {
      if (
        this.currentPlaytimeBoost ||
        this.currentBassBoost === BassBoostMode.Off
      ) {
        this.bassBoostFilter.frequency.setTargetAtTime(60, now, 0.03);
        this.bassBoostFilter.Q.setTargetAtTime(1.0, now, 0.03);
        this.bassBoostFilter.gain.setTargetAtTime(0, now, 0.03);
      } else if (this.currentBassBoost === BassBoostMode.Deep) {
        this.bassBoostFilter.frequency.setTargetAtTime(48, now, 0.03);
        this.bassBoostFilter.Q.setTargetAtTime(1.1, now, 0.03);
        this.bassBoostFilter.gain.setTargetAtTime(6.5, now, 0.03);
      } else {
        this.bassBoostFilter.frequency.setTargetAtTime(84, now, 0.03);
        this.bassBoostFilter.Q.setTargetAtTime(1.45, now, 0.03);
        this.bassBoostFilter.gain.setTargetAtTime(5.5, now, 0.03);
      }
    }

    if (this.environmentLowFilter && this.environmentHighFilter) {
      if (this.currentEnvironment === AcousticEnvironment.Outdoor) {
        this.environmentLowFilter.gain.setTargetAtTime(2.5, now, 0.04);
        this.environmentHighFilter.gain.setTargetAtTime(2.0, now, 0.04);
      } else {
        this.environmentLowFilter.gain.setTargetAtTime(0, now, 0.04);
        this.environmentHighFilter.gain.setTargetAtTime(0, now, 0.04);
      }
    }

    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(
        this.currentAiBoost ? -18 : -4,
        now,
        0.04
      );
      this.compressor.ratio.setTargetAtTime(
        this.currentAiBoost ? 4.5 : 1.5,
        now,
        0.04
      );
    }

    if (this.masterGain) {
      const effectiveGain = this.currentMuted
        ? 0
        : Math.pow(this.currentVolume / 100, 1.65);
      this.masterGain.gain.setTargetAtTime(effectiveGain, now, 0.025);
    }
  }

  public setEqGains(gains: number[]): void {
    this.currentGains = [...gains];
    this.applyDspSettings();
    bluetoothBridge.syncHardwareEq(this.currentGains, this.currentBassBoost);
  }

  public setBassBoost(mode: BassBoostMode): void {
    this.currentBassBoost = mode;
    this.applyDspSettings();
    bluetoothBridge.syncHardwareEq(this.currentGains, this.currentBassBoost);
  }

  public setEnvironment(env: AcousticEnvironment): void {
    this.currentEnvironment = env;
    this.applyDspSettings();
  }

  public setAiSoundBoost(enabled: boolean): void {
    this.currentAiBoost = enabled;
    this.applyDspSettings();
  }

  public setPlaytimeBoost(enabled: boolean): void {
    this.currentPlaytimeBoost = enabled;
    this.applyDspSettings();
  }

  public setVolume(volume: number, muted: boolean): void {
    this.currentVolume = volume;
    this.currentMuted = muted;
    this.applyDspSettings();
    bluetoothBridge.syncHardwareVolume(volume, muted);
  }

  public async setOutputSink(deviceId: string): Promise<boolean> {
    try {
      const ctx = this.ensureContext() as AudioContext & {
        setSinkId?: (id: string) => Promise<void>;
      };
      if (typeof ctx.setSinkId === 'function') {
        await ctx.setSinkId(deviceId);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  public computeCompositeCurve(
    gains: number[],
    bassBoost: BassBoostMode,
    environment: AcousticEnvironment,
    playtimeBoost: boolean
  ): Array<{ freq: number; db: number }> {
    const numPoints = 64;
    const minLog = Math.log10(25);
    const maxLog = Math.log10(18000);
    const freqs = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      freqs[i] = Math.pow(
        10,
        minLog + (i / (numPoints - 1)) * (maxLog - minLog)
      );
    }

    const results: Array<{ freq: number; db: number }> = [];
    for (let i = 0; i < numPoints; i++) {
      const f = freqs[i];
      let totalDb = 0;

      EQ_BANDS.forEach((band, idx) => {
        const g = playtimeBoost
          ? (gains[idx] ?? 0) * 0.65 - (idx <= 1 ? 2.5 : 0)
          : (gains[idx] ?? 0);
        if (Math.abs(g) < 0.01) return;

        const octaveDist = Math.log2(f / band.freq);
        if (idx === 0) {
          const weight = 1 / (1 + Math.exp(octaveDist * 2.8));
          totalDb += g * weight;
        } else if (idx === EQ_BANDS.length - 1) {
          const weight = 1 / (1 + Math.exp(-octaveDist * 2.8));
          totalDb += g * weight;
        } else {
          const bandwidth = 0.72;
          const weight = Math.exp(
            -(octaveDist * octaveDist) / (2 * bandwidth * bandwidth)
          );
          totalDb += g * weight;
        }
      });

      if (!playtimeBoost && bassBoost === BassBoostMode.Deep) {
        const oct = Math.log2(f / 48);
        totalDb += 6.5 * Math.exp(-(oct * oct) / (2 * 0.65 * 0.65));
      } else if (!playtimeBoost && bassBoost === BassBoostMode.Punchy) {
        const oct = Math.log2(f / 84);
        totalDb += 5.5 * Math.exp(-(oct * oct) / (2 * 0.52 * 0.52));
      }

      if (environment === AcousticEnvironment.Outdoor) {
        const lowWeight = 1 / (1 + Math.exp(Math.log2(f / 95) * 2.6));
        const highWeight = 1 / (1 + Math.exp(-Math.log2(f / 6500) * 2.6));
        totalDb += 2.5 * lowWeight + 2.0 * highWeight;
      }

      results.push({ freq: f, db: Math.max(-15, Math.min(15, totalDb)) });
    }
    return results;
  }

  // --- Zero-Upload External Music Player Sync & Transport ---

  public getSourceState() {
    const ext = bluetoothBridge.getNativeExternalPlayerState();
    return {
      sourceMode: this.sourceMode,
      isPlaying: this.isPlaying || Boolean(ext?.isMusicActive),
      currentGroove: this.currentGroove,
      detectedBpm: this.detectedBpm,
      externalMusicActive: Boolean(ext?.isMusicActive),
      activeRouteName: ext?.activeRouteName || '',
    };
  }

  /**
   * Starts automatic Live Sync with songs playing in the user's external music player
   * (Spotify, YouTube Music, Apple Music, Samsung Music, etc.) — NO SONG UPLOAD NEEDED!
   * On Android APK: uses Master Mix Visualizer(0) + DSP Session 0 automatically; falls back to live room audio pickup if needed.
   * On Browser: activates raw music frequency listener (no echo-cancellation distortion) to sync beats & lights in real time.
   */
  public async startLivePlayerSync(): Promise<{
    ok: boolean;
    mode: AudioSyncSourceMode;
    message: string;
  }> {
    this.stopGrooveTimer();

    // 1. Native Android APK: Master Output Mix Visualizer(0) works directly with Spotify / YouTube / any player!
    if (bluetoothBridge.isAndroidNativeBridgeAvailable()) {
      const extState = bluetoothBridge.getNativeExternalPlayerState();
      if (extState?.visualizerAvailable) {
        this.stopSyncStream();
        this.sourceMode = 'player_sync';
        this.isPlaying = true;
        bluetoothBridge.syncHardwareEq(this.currentGains, this.currentBassBoost);
        faultLogger.record({
          severity: 'success',
          category: 'audio_sync',
          title: 'סינכרון ישיר לנגן המוזיקה באנדרואיד הופעל',
          details:
            'מנתח בזמן אמת את ערוץ השמע הראשי של המכשיר (Session 0) מכל נגן (Spotify, YouTube Music וכדומה) ללא צורך בהעלאת שירים.',
        });
        this.notifyStateChanged();
        return {
          ok: true,
          mode: 'player_sync',
          message:
            'סינכרון ישיר פעיל! כל שיר שתפעיל בנגן המוזיקה במכשיר מסונכרן אוטומטית לתאורה ולאיקוולייזר.',
        };
      }
    }

    // 2. Web / Acoustic Live Music Listener (high-fidelity un-filtered music pickup)
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      faultLogger.record({
        severity: 'error',
        category: 'audio_sync',
        title: 'ממשק לכידת שמע אינו נתמך בדפדפן זה',
        details: 'navigator.mediaDevices אינו זמין.',
        suggestionHe: 'פתח את האפליקציה ב-Chrome או באפליקציית ה-APK באנדרואיד.',
      });
      return {
        ok: false,
        mode: this.sourceMode,
        message: 'הדפדפן אינו תומך בלכידת שמע חיה — מומלץ להשתמש ב-Chrome או ב-APK.',
      };
    }

    try {
      const ctx = this.ensureContext();
      this.stopSyncStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.attachSyncStream(ctx, stream, 'player_sync');
      faultLogger.record({
        severity: 'success',
        category: 'audio_sync',
        title: 'סינכרון חי עם השירים המתנגנים הופעל',
        details:
          'קולט ומנתח בזמן אמת את קצב הבס, התדרים וה-BPM מהשירים המתנגנים בנגן שלך ללא שום העלאת קבצים.',
      });
      return {
        ok: true,
        mode: 'player_sync',
        message:
          'מסונכרן בזמן אמת עם השירים המתנגנים בנגן שלך! התאורה והספקטרום מגיבים אוטומטית לקצב.',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'גישת שמע נדחתה';
      faultLogger.record({
        severity: 'warning',
        category: 'audio_sync',
        title: 'נדרש אישור גישת שמע לסינכרון עם הנגן בדפדפן',
        details: msg,
        suggestionHe:
          'אשר הרשאת מיקרופון בסרגל הכתובת או לחץ על ״סינכרון שמע מערכת/כרטיסייה״ כדי ללכוד שמע ישירות מהמחשב.',
      });
      return {
        ok: false,
        mode: this.sourceMode,
        message:
          'כדי לסנכרן אוטומטית עם הנגן בדפדפן, אשר גישת שמע או לחץ על ״שמע מערכת / כרטיסייה״.',
      };
    }
  }

  /**
   * Direct digital system/tab audio capture on Desktop/Web browsers (Spotify Web, YouTube, Windows/Mac system audio)
   * using getDisplayMedia({ audio: true }) — 100% pure digital signal without room noise and zero file uploads!
   */
  public async startSystemAudioSync(): Promise<{
    ok: boolean;
    message: string;
  }> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      return this.startLivePlayerSync();
    }

    try {
      const ctx = this.ensureContext();
      this.stopGrooveTimer();
      this.stopSyncStream();

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });

      const audioTracks = stream.getAudioTracks();
      // Stop the video track immediately if audio is present — we only need pure audio sync!
      stream.getVideoTracks().forEach((vt) => vt.stop());

      if (audioTracks.length === 0) {
        faultLogger.record({
          severity: 'warning',
          category: 'audio_sync',
          title: 'שיתוף שמע מערכת בוצע ללא סימון תיבת השמע',
          details: 'לא התקבל ערוץ שמע מהכרטיסייה או מהמערכת.',
          suggestionHe:
            'בחלון השיתוף שנפתח, סמן את התיבה ״שתף גם שמע כרטיסייה / שמע מערכת״ (Share audio).',
        });
        return {
          ok: false,
          message:
            'לא סומנה תיבת ״שתף שמע״ (Share audio) בחלון שנפתח — סמן אותה לסינכרון דיגיטלי מלא עם הנגן.',
        };
      }

      const audioOnlyStream = new MediaStream(audioTracks);
      audioTracks[0].addEventListener('ended', () => {
        if (this.sourceMode === 'system_audio') {
          this.isPlaying = false;
          this.notifyStateChanged();
        }
      });

      this.attachSyncStream(ctx, audioOnlyStream, 'system_audio');
      faultLogger.record({
        severity: 'success',
        category: 'audio_sync',
        title: 'סינכרון שמע דיגיטלי ישיר מהמערכת/נגן פעיל',
        details: `מחובר לערוץ השמע: ${audioTracks[0].label || 'System/Tab Audio'}`,
      });

      return {
        ok: true,
        message:
          'סינכרון שמע דיגיטלי ישיר פעיל! כל שיר ב-YouTube / Spotify מסונכרן ישירות לתאורה ולספקטרום.',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('denied')) {
        return {
          ok: false,
          message: 'בחירת מקור שמע המערכת בוטלה.',
        };
      }
      faultLogger.record({
        severity: 'warning',
        category: 'audio_sync',
        title: 'שיתוף שמע מערכת אינו זמין במסגרת זו — עובר לסינכרון חי אוטומטי',
        details: msg || 'getDisplayMedia restricted',
      });
      return this.startLivePlayerSync();
    }
  }

  private attachSyncStream(
    ctx: AudioContext,
    stream: MediaStream,
    mode: 'player_sync' | 'system_audio'
  ): void {
    this.syncStream = stream;
    this.syncSource = ctx.createMediaStreamSource(stream);
    this.syncAnalyser = ctx.createAnalyser();
    this.syncAnalyser.fftSize = 256;
    this.syncAnalyser.smoothingTimeConstant = 0.72;
    this.syncFreqData = new Uint8Array(this.syncAnalyser.frequencyBinCount);
    this.syncSource.connect(this.syncAnalyser);

    this.sourceMode = mode;
    this.isPlaying = true;
    this.notifyStateChanged();
  }

  private stopSyncStream(): void {
    if (this.syncSource) {
      try {
        this.syncSource.disconnect();
      } catch {
        // ignore
      }
      this.syncSource = null;
    }
    if (this.syncStream) {
      this.syncStream.getTracks().forEach((t) => t.stop());
      this.syncStream = null;
    }
    this.syncAnalyser = null;
    this.syncFreqData = null;
  }

  private stopGrooveTimer(): void {
    if (this.grooveTimer !== null) {
      window.clearInterval(this.grooveTimer);
      this.grooveTimer = null;
    }
  }

  public startGroove(grooveId?: DemoGrooveId): void {
    const ctx = this.ensureContext();
    this.stopSyncStream();
    this.stopGrooveTimer();

    if (grooveId) {
      this.currentGroove = grooveId;
    }
    this.sourceMode = 'groove';
    this.isPlaying = true;

    const bpmMap: Record<DemoGrooveId, number> = {
      house_124: 124,
      sub_tech_128: 128,
      mediterranean_112: 112,
      bass_sweep: 100,
    };
    const bpm = bpmMap[this.currentGroove];
    this.detectedBpm = bpm;
    const sixteenthMs = (60 / bpm / 4) * 1000;

    this.stepIndex = 0;
    this.triggerGrooveStep(ctx, this.stepIndex);
    this.grooveTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.ctx) return;
      this.stepIndex = (this.stepIndex + 1) % 16;
      this.triggerGrooveStep(this.ctx, this.stepIndex);
    }, sixteenthMs);

    this.notifyStateChanged();
  }

  public togglePlay(): boolean {
    // On Android APK when in player_sync mode: toggle the user's real external music player!
    if (
      this.sourceMode === 'player_sync' &&
      bluetoothBridge.isAndroidNativeBridgeAvailable()
    ) {
      bluetoothBridge.dispatchExternalPlayerMediaKey('play_pause');
      const next = !this.isPlaying;
      this.isPlaying = next;
      this.notifyStateChanged();
      return next;
    }

    if (this.isPlaying) {
      this.pause();
      return false;
    }

    if (this.sourceMode === 'groove') {
      this.startGroove(this.currentGroove);
      return true;
    }

    void this.startLivePlayerSync();
    return true;
  }

  public pause(): void {
    this.isPlaying = false;
    this.detectedBpm = 0;
    this.stopGrooveTimer();
    this.stopSyncStream();
    this.notifyStateChanged();
  }

  public nextTrack(): void {
    bluetoothBridge.dispatchExternalPlayerMediaKey('next');
  }

  public prevTrack(): void {
    bluetoothBridge.dispatchExternalPlayerMediaKey('previous');
  }

  // --- Live Karaoke Microphone Engine + Real Voice Auto-Ducking ---

  public async setLiveKaraokeEnabled(
    enabled: boolean,
    params: {
      volume: number;
      bassDb: number;
      trebleDb: number;
      echoPercent: number;
      vocalDucking: boolean;
    }
  ): Promise<boolean> {
    if (!enabled) {
      this.stopLiveKaraoke();
      return true;
    }

    try {
      const ctx = this.ensureContext();
      this.stopLiveKaraoke();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.karaokeStream = stream;
      this.karaokeSource = ctx.createMediaStreamSource(stream);

      this.karaokeHpFilter = ctx.createBiquadFilter();
      this.karaokeHpFilter.type = 'highpass';
      this.karaokeHpFilter.frequency.value = 85;

      this.karaokeBassFilter = ctx.createBiquadFilter();
      this.karaokeBassFilter.type = 'lowshelf';
      this.karaokeBassFilter.frequency.value = 185;

      this.karaokeTrebleFilter = ctx.createBiquadFilter();
      this.karaokeTrebleFilter.type = 'highshelf';
      this.karaokeTrebleFilter.frequency.value = 4200;

      this.karaokeDryGain = ctx.createGain();
      this.karaokeDelay = ctx.createDelay(1.0);
      this.karaokeDelay.delayTime.value = 0.24;

      const echoDamp = ctx.createBiquadFilter();
      echoDamp.type = 'lowpass';
      echoDamp.frequency.value = 2600;

      this.karaokeFeedback = ctx.createGain();
      this.karaokeWetGain = ctx.createGain();

      this.karaokeAnalyser = ctx.createAnalyser();
      this.karaokeAnalyser.fftSize = 256;
      this.karaokeTimeData = new Uint8Array(this.karaokeAnalyser.fftSize);

      this.karaokeSource.connect(this.karaokeHpFilter);
      this.karaokeHpFilter.connect(this.karaokeBassFilter);
      this.karaokeBassFilter.connect(this.karaokeTrebleFilter);
      this.karaokeTrebleFilter.connect(this.karaokeAnalyser);

      this.karaokeTrebleFilter.connect(this.karaokeDryGain);
      this.karaokeDryGain.connect(this.masterGain!);

      this.karaokeTrebleFilter.connect(this.karaokeDelay);
      this.karaokeDelay.connect(echoDamp);
      echoDamp.connect(this.karaokeFeedback);
      this.karaokeFeedback.connect(this.karaokeDelay);
      echoDamp.connect(this.karaokeWetGain);
      this.karaokeWetGain.connect(this.masterGain!);

      this.karaokeActive = true;
      this.updateLiveKaraokeParams(params);
      return true;
    } catch (err) {
      faultLogger.record({
        severity: 'warning',
        category: 'permissions',
        title: 'גישה למיקרופון קריוקי חי נדחתה',
        details: err instanceof Error ? err.message : 'Microphone unavailable',
        suggestionHe: 'אשר הרשאת מיקרופון בחלון החיבור העליון.',
      });
      this.stopLiveKaraoke();
      return false;
    }
  }

  public updateLiveKaraokeParams(params: {
    volume: number;
    bassDb: number;
    trebleDb: number;
    echoPercent: number;
    vocalDucking: boolean;
  }): void {
    this.karaokeVocalDucking = params.vocalDucking;
    if (!this.ctx || !this.karaokeActive) return;

    const now = this.ctx.currentTime;
    const micGain = (params.volume / 100) * 1.15;
    this.karaokeDryGain?.gain.setTargetAtTime(micGain, now, 0.03);
    this.karaokeBassFilter?.gain.setTargetAtTime(params.bassDb, now, 0.03);
    this.karaokeTrebleFilter?.gain.setTargetAtTime(params.trebleDb, now, 0.03);

    const echoNorm = params.echoPercent / 100;
    this.karaokeFeedback?.gain.setTargetAtTime(echoNorm * 0.52, now, 0.04);
    this.karaokeWetGain?.gain.setTargetAtTime(
      micGain * echoNorm * 0.65,
      now,
      0.04
    );
  }

  public stopLiveKaraoke(): void {
    this.karaokeActive = false;
    this.currentVoiceRms = 0;
    if (this.karaokeSource) {
      try {
        this.karaokeSource.disconnect();
      } catch {
        // ignore
      }
      this.karaokeSource = null;
    }
    if (this.karaokeStream) {
      this.karaokeStream.getTracks().forEach((t) => t.stop());
      this.karaokeStream = null;
    }
    if (this.ctx && this.musicDuckGain) {
      this.musicDuckGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.12);
    }
  }

  // --- 5-Second Smart Acoustic Room Calibration ---

  public async runAcousticRoomCalibration(
    onProgress: (percent: number, stageLabel: string) => void
  ): Promise<RoomCalibrationResult> {
    const ctx = this.ensureContext();
    onProgress(8, 'מאתחל אות בדיקה אקוסטי ומאזין לחלל...');

    let calibStream: MediaStream | null = null;
    let calibAnalyser: AnalyserNode | null = null;
    let calibSource: MediaStreamAudioSourceNode | null = null;
    let usedLiveMic = false;

    try {
      calibStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      calibSource = ctx.createMediaStreamSource(calibStream);
      calibAnalyser = ctx.createAnalyser();
      calibAnalyser.fftSize = 1024;
      calibAnalyser.smoothingTimeConstant = 0.55;
      calibSource.connect(calibAnalyser);
      usedLiveMic = true;
    } catch {
      usedLiveMic = false;
    }

    const now = ctx.currentTime;
    const sweepOsc = ctx.createOscillator();
    const sweepGain = ctx.createGain();
    sweepOsc.type = 'sine';
    sweepOsc.frequency.setValueAtTime(52, now);
    sweepOsc.frequency.exponentialRampToValueAtTime(11500, now + 4.2);

    sweepGain.gain.setValueAtTime(0.001, now);
    sweepGain.gain.linearRampToValueAtTime(0.16, now + 0.25);
    sweepGain.gain.setValueAtTime(0.16, now + 3.8);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 4.35);

    sweepOsc.connect(sweepGain);
    sweepGain.connect(this.masterGain!);
    sweepOsc.start(now);
    sweepOsc.stop(now + 4.4);

    const bandAccum = new Array(EQ_BANDS.length).fill(0);
    const bandSamples = new Array(EQ_BANDS.length).fill(0);
    const totalSteps = 22;
    const fftBuf = calibAnalyser
      ? new Uint8Array(calibAnalyser.frequencyBinCount)
      : null;

    for (let step = 1; step <= totalSteps; step++) {
      await new Promise((r) => window.setTimeout(r, 200));
      const pct = Math.min(96, Math.round((step / totalSteps) * 95));
      const stage =
        pct < 35
          ? 'מודד החזרי בס ותהודת פינות (63Hz–250Hz)...'
          : pct < 75
            ? 'מנתח בהירות ווקאל ואיזון מיד (500Hz–4kHz)...'
            : 'מחשב פיצוי גבוהים והתאמת סביבה (12kHz)...';
      onProgress(pct, stage);

      if (calibAnalyser && fftBuf) {
        calibAnalyser.getByteFrequencyData(fftBuf);
        const nyquist = ctx.sampleRate / 2;
        EQ_BANDS.forEach((b, idx) => {
          const bin = Math.max(
            1,
            Math.min(
              fftBuf.length - 1,
              Math.round((b.freq / nyquist) * fftBuf.length)
            )
          );
          bandAccum[idx] += fftBuf[bin];
          bandSamples[idx] += 1;
        });
      }
    }

    if (calibSource) {
      try {
        calibSource.disconnect();
      } catch {
        // ignore
      }
    }
    if (calibStream) {
      calibStream.getTracks().forEach((t) => t.stop());
    }

    let calibratedGains: number[];
    let detectedEnvironment: AcousticEnvironment;

    if (usedLiveMic && bandSamples[0] > 0) {
      const avgs = bandAccum.map((sum, i) => sum / Math.max(1, bandSamples[i]));
      const overallMean =
        avgs.reduce((acc, v) => acc + v, 0) / Math.max(1, avgs.length);

      calibratedGains = avgs.map((val, idx) => {
        const diffNormalized = (overallMean - val) / 28;
        const jblTargetBias = [3.5, 2.5, 0.0, 0.5, 1.5, 2.5, 3.0][idx];
        const raw = jblTargetBias + diffNormalized * 2.2;
        return Math.round(Math.max(-8, Math.min(8, raw)) * 2) / 2;
      });

      const lowRatio = (avgs[0] + avgs[1]) / (2 * Math.max(1, overallMean));
      detectedEnvironment =
        lowRatio < 0.88
          ? AcousticEnvironment.Outdoor
          : AcousticEnvironment.Indoor;
    } else {
      detectedEnvironment = this.currentEnvironment;
      calibratedGains =
        detectedEnvironment === AcousticEnvironment.Outdoor
          ? [6.5, 5.0, 1.5, 0.5, 2.0, 4.0, 4.5]
          : [4.0, 2.5, -1.0, 0.5, 2.0, 3.0, 3.5];
    }

    onProgress(100, 'הכיול האקוסטי הושלם והוחל על הרמקול!');
    faultLogger.record({
      severity: 'success',
      category: 'audio_sync',
      title: 'כיול אקוסטי חכם הושלם',
      details: `סביבה מזוהה: ${detectedEnvironment === AcousticEnvironment.Outdoor ? 'שטח פתוח' : 'חלל פנים'} · מיקרופון חי: ${usedLiveMic ? 'כן' : 'פרופיל מותאם'}`,
    });

    return {
      calibratedGains,
      detectedEnvironment,
      usedLiveMic,
      summaryHe: usedLiveMic
        ? detectedEnvironment === AcousticEnvironment.Outdoor
          ? 'זוהתה התפשטות אקוסטית פתוחה — הוגברו תדרי הסאב והגבוהים לפיצוי מרחבי מדויק.'
          : 'זוהה חלל פנים עם החזרי קירות — רוסנו תדרי הבום ב-125Hz–250Hz וחודדה נוכחות השירה.'
        : 'הוחל פרופיל כיול אופטימלי מאוזן עבור זוג הוופרים והטוויטרים של ה-Stage 320.',
    };
  }

  // --- Custom 4-Slot Voice / Sound Sampler Recorder ---

  public async startSampleRecording(maxSeconds = 4): Promise<{
    stopEarly: () => void;
    result: Promise<{ dataUrl: string; durationSec: number }>;
  }> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    this.activeRecorder = recorder;

    const chunks: BlobPart[] = [];
    const startedAt = performance.now();

    const result = new Promise<{ dataUrl: string; durationSec: number }>(
      (resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => {
          stream.getTracks().forEach((t) => t.stop());
          reject(new Error('שגיאה בהקלטת הסמפל'));
        };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const durationSec = Math.max(
            0.4,
            Math.round(((performance.now() - startedAt) / 1000) * 10) / 10
          );
          const blob = new Blob(chunks, {
            type: recorder.mimeType || 'audio/webm',
          });
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              resolve({ dataUrl: reader.result, durationSec });
            } else {
              reject(new Error('שגיאה בקידוד ההקלטה'));
            }
          };
          reader.readAsDataURL(blob);
        };
      }
    );

    recorder.start();
    const autoStopTimer = window.setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, maxSeconds * 1000);

    return {
      stopEarly: () => {
        window.clearTimeout(autoStopTimer);
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      },
      result,
    };
  }

  public async playCustomSampleDataUrl(dataUrl: string): Promise<void> {
    const ctx = this.ensureContext();
    this.djFlareValue = 1.0;
    try {
      const res = await fetch(dataUrl);
      const arr = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arr);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = audioBuf;
      gain.gain.value = 0.95;
      src.connect(gain);
      gain.connect(this.getChainInput());
      src.start(ctx.currentTime);
    } catch {
      const el = new Audio(dataUrl);
      el.play().catch(() => {});
    }
  }

  // --- Synthesized Studio Test Groove Engine (Optional test signal) ---

  private triggerGrooveStep(ctx: AudioContext, step: number): void {
    const now = ctx.currentTime;
    const dest = this.getChainInput();

    if (this.currentGroove === 'bass_sweep') {
      if (step % 4 === 0) {
        this.synthKick(ctx, dest, now, 95, 38, 0.42);
      }
      if (step === 0 || step === 8) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(step === 0 ? 42 : 68, now);
        osc.frequency.exponentialRampToValueAtTime(
          step === 0 ? 85 : 44,
          now + 0.75
        );
        gain.gain.setValueAtTime(0.45, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + 0.82);
      }
      if (step % 2 === 0) {
        this.synthHat(ctx, dest, now, step % 4 === 2 ? 0.12 : 0.05);
      }
      return;
    }

    if (this.currentGroove === 'mediterranean_112') {
      if (step === 0 || step === 6 || step === 8) {
        this.synthKick(ctx, dest, now, 130, 48, 0.34);
      }
      if (step === 4 || step === 12) {
        this.synthClap(ctx, dest, now, 0.22);
      }
      if (step === 2 || step === 7 || step === 10 || step === 14 || step === 15) {
        this.synthHat(ctx, dest, now, 0.14);
      }
      const scaleFreqs = [110, 116.54, 138.59, 146.83, 164.81, 174.61, 207.65];
      if (step % 2 === 0) {
        const note = scaleFreqs[(step / 2) % scaleFreqs.length];
        this.synthPluck(ctx, dest, now, note * 2, 0.16);
      }
      if (step === 0 || step === 6 || step === 12) {
        this.synthBassNote(
          ctx,
          dest,
          now,
          step === 6 ? 116.54 / 2 : 55,
          0.24
        );
      }
      return;
    }

    if (this.currentGroove === 'sub_tech_128') {
      if (step % 4 === 0) {
        this.synthKick(ctx, dest, now, 155, 42, 0.38);
      }
      if (step % 4 === 2) {
        this.synthHat(ctx, dest, now, 0.18);
        this.synthBassNote(ctx, dest, now, 51.91, 0.22);
      } else if (step % 2 === 1) {
        this.synthHat(ctx, dest, now, 0.06);
      }
      if (step === 4 || step === 12) {
        this.synthClap(ctx, dest, now, 0.24);
      }
      if (step === 0 || step === 3 || step === 6 || step === 11) {
        const stabFreq = step === 6 ? 311.13 : 207.65;
        this.synthPluck(ctx, dest, now, stabFreq, 0.15);
      }
      return;
    }

    if (step % 4 === 0) {
      this.synthKick(ctx, dest, now, 145, 45, 0.36);
    }
    if (step === 4 || step === 12) {
      this.synthClap(ctx, dest, now, 0.22);
    }
    if (step % 4 === 2) {
      this.synthHat(ctx, dest, now, 0.16);
    } else if (step % 2 === 1) {
      this.synthHat(ctx, dest, now, 0.05);
    }

    const bassPattern: Record<number, number> = {
      2: 55,
      3: 55,
      6: 65.41,
      10: 73.42,
      14: 61.74,
    };
    if (bassPattern[step]) {
      this.synthBassNote(ctx, dest, now, bassPattern[step], 0.2);
    }

    if (step === 0 || step === 6 || step === 12) {
      const chordRoot = step === 6 ? 261.63 : 220;
      this.synthChordStab(
        ctx,
        dest,
        now,
        [chordRoot, chordRoot * 1.189, chordRoot * 1.498],
        0.12
      );
    }
  }

  private synthKick(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    startFreq: number,
    endFreq: number,
    duration: number
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.065);
    osc.frequency.exponentialRampToValueAtTime(endFreq * 0.82, time + duration);

    gain.gain.setValueAtTime(0.68, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private synthBassNote(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    freq: number,
    duration: number
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, time);
    filter.frequency.exponentialRampToValueAtTime(110, time + duration);
    filter.Q.value = 3.2;

    gain.gain.setValueAtTime(0.34, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private synthHat(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    level: number
  ): void {
    const bufferSize = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);

    noise.connect(hp);
    hp.connect(gain);
    gain.connect(dest);
    noise.start(time);
  }

  private synthClap(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    level: number
  ): void {
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] =
        (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.035));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1350;
    bp.Q.value = 1.1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.13);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(dest);
    noise.start(time);
  }

  private synthPluck(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    freq: number,
    level: number
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, time);
    filter.frequency.exponentialRampToValueAtTime(480, time + 0.18);

    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.19);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private synthChordStab(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    freqs: number[],
    level: number
  ): void {
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + 0.22);

    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.24);
    filter.connect(gain);
    gain.connect(dest);

    freqs.forEach((f) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, time);
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + 0.25);
    });
  }

  // --- PartyPad™ DJ Effects ---

  public triggerDjEffect(effect: DjPadEffectId): void {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const dest = this.getChainInput();
    this.djFlareValue = 1.0;

    if (effect === 'airhorn') {
      const freqs = [392, 466.16, 587.33];
      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f * 0.92, now);
        osc.frequency.linearRampToValueAtTime(f, now + 0.04);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.setValueAtTime(0.16, now + 0.35);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + 0.58);
      });
    } else if (effect === 'bassdrop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.85);
      gain.gain.setValueAtTime(0.75, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.92);
    } else if (effect === 'laser') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1900, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.24);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.26);
    } else if (effect === 'scratch') {
      const osc = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(720, now + 0.11);
      osc.frequency.linearRampToValueAtTime(120, now + 0.22);
      osc.frequency.linearRampToValueAtTime(640, now + 0.32);

      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 2.4;

      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      osc.connect(bp);
      bp.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.38);
    } else if (effect === 'applause') {
      const len = Math.floor(ctx.sampleRate * 0.75);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((i / len) * Math.PI);
        const burst = Math.sin(i * 0.045) > 0.2 ? 1 : 0.35;
        data[i] = (Math.random() * 2 - 1) * env * burst;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1600;
      bp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0.28;
      src.connect(bp);
      bp.connect(gain);
      gain.connect(dest);
      src.start(now);
    } else if (effect === 'siren') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.28);
      osc.frequency.linearRampToValueAtTime(480, now + 0.56);
      osc.frequency.linearRampToValueAtTime(960, now + 0.82);
      gain.gain.setValueAtTime(0.26, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.86);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.88);
    }
  }

  private recordBeatAndEstimateBpm(nowMs: number, energy: number): void {
    if (this.lastBeatTime > 0) {
      const interval = nowMs - this.lastBeatTime;
      if (interval >= 290 && interval <= 920) {
        this.beatIntervalsMs.push(interval);
        if (this.beatIntervalsMs.length > 8) {
          this.beatIntervalsMs.shift();
        }
        if (this.beatIntervalsMs.length >= 3) {
          const avgMs =
            this.beatIntervalsMs.reduce((a, b) => a + b, 0) /
            this.beatIntervalsMs.length;
          this.detectedBpm = Math.round(60000 / avgMs);
        }
      } else if (interval > 2200) {
        this.beatIntervalsMs = [];
        this.detectedBpm = 0;
      }
    }
    this.lastBeatTime = nowMs;
    this.beatListeners.forEach((cb) => cb(energy));
  }

  // --- Real-Time Analysis Frame (Native External Player Visualizer + Web Stream + Studio DSP) ---

  public getAnalysisFrame(): AudioAnalysisFrame {
    this.djFlareValue = Math.max(0, this.djFlareValue * 0.9);

    // Measure live karaoke vocal level & drive automatic MC Ducking
    if (
      this.karaokeActive &&
      this.karaokeAnalyser &&
      this.karaokeTimeData &&
      this.ctx
    ) {
      this.karaokeAnalyser.getByteTimeDomainData(this.karaokeTimeData);
      let sumSq = 0;
      for (let i = 0; i < this.karaokeTimeData.length; i++) {
        const centered = (this.karaokeTimeData[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / this.karaokeTimeData.length);
      this.currentVoiceRms = Math.min(1, rms * 4.5);

      const nowMs = performance.now();
      if (this.currentVoiceRms > 0.14) {
        this.lastVoiceDetectedMs = nowMs;
      }
      if (this.musicDuckGain) {
        const shouldDuck =
          this.karaokeVocalDucking && nowMs - this.lastVoiceDetectedMs < 520;
        this.musicDuckGain.gain.setTargetAtTime(
          shouldDuck ? 0.3 : 1.0,
          this.ctx.currentTime,
          shouldDuck ? 0.04 : 0.22
        );
      }
    }

    // 1. Check Native Android Master Mix Visualizer (Session 0 — Spotify / YouTube / System Music Player!)
    if (
      this.sourceMode === 'player_sync' &&
      bluetoothBridge.isAndroidNativeBridgeAvailable()
    ) {
      const nativeBins = bluetoothBridge.getNativeSystemAudioBins();
      const extState = bluetoothBridge.getNativeExternalPlayerState();
      const musicActive = Boolean(extState?.isMusicActive);

      if (nativeBins && nativeBins.length >= 28 && musicActive) {
        let bassSum = 0;
        for (let i = 0; i < 6; i++) bassSum += nativeBins[i];
        const subBassEnergy = Math.min(1, bassSum / 5.2);

        let midSum = 0;
        for (let i = 6; i < 18; i++) midSum += nativeBins[i];
        const midEnergy = Math.min(1, midSum / 11);

        let highSum = 0;
        for (let i = 18; i < 28; i++) highSum += nativeBins[i];
        const highEnergy = Math.min(1, highSum / 9.5);

        for (let b = 0; b < 28; b++) {
          this.reusableSpectrum[b] = Math.max(0.03, nativeBins[b]);
        }

        const nowMs = performance.now();
        const delta = subBassEnergy - this.prevBassAvg;
        const isBeat =
          (delta > 0.1 && subBassEnergy > 0.36 && nowMs - this.lastBeatTime > 210) ||
          this.djFlareValue > 0.75;
        if (isBeat && nowMs - this.lastBeatTime > 210) {
          this.recordBeatAndEstimateBpm(nowMs, subBassEnergy);
        }
        this.prevBassAvg = this.prevBassAvg * 0.8 + subBassEnergy * 0.2;

        return {
          spectrum: this.reusableSpectrum,
          subBassEnergy: Math.max(subBassEnergy, this.djFlareValue * 0.75),
          midEnergy: Math.max(midEnergy, this.currentVoiceRms * 0.65),
          highEnergy,
          isBeat,
          detectedBpm: this.detectedBpm,
          djFlare: this.djFlareValue,
          karaokeVoiceLevel: this.currentVoiceRms,
          externalMusicActive: true,
        };
      }
    }

    // 2. Choose active Web Audio analyser (External Player Stream vs Internal DSP Groove/FX)
    const activeAnalyser =
      (this.sourceMode === 'player_sync' || this.sourceMode === 'system_audio') &&
      this.syncAnalyser &&
      this.syncFreqData &&
      this.djFlareValue < 0.05
        ? this.syncAnalyser
        : this.analyser;

    const activeData =
      activeAnalyser === this.syncAnalyser ? this.syncFreqData : this.freqData;

    if (
      !activeAnalyser ||
      !activeData ||
      (!this.isPlaying && !this.karaokeActive && this.djFlareValue < 0.02)
    ) {
      for (let i = 0; i < 28; i++) {
        this.reusableSpectrum[i] = 0.03;
      }
      return {
        spectrum: this.reusableSpectrum,
        subBassEnergy: this.djFlareValue * 0.8,
        midEnergy: this.djFlareValue * 0.5,
        highEnergy: this.djFlareValue * 0.6,
        isBeat: this.djFlareValue > 0.7,
        detectedBpm: 0,
        djFlare: this.djFlareValue,
        karaokeVoiceLevel: this.currentVoiceRms,
        externalMusicActive: false,
      };
    }

    activeAnalyser.getByteFrequencyData(activeData);
    const binCount = activeData.length;

    let bassSum = 0;
    for (let i = 1; i <= 7; i++) {
      bassSum += activeData[i];
    }
    const subBassEnergy = Math.min(1, bassSum / (7 * 220));

    let midSum = 0;
    for (let i = 8; i <= 36; i++) {
      midSum += activeData[i];
    }
    const midEnergy = Math.min(1, midSum / (29 * 200));

    let highSum = 0;
    for (let i = 37; i <= 95; i++) {
      highSum += activeData[i];
    }
    const highEnergy = Math.min(1, highSum / (59 * 175));

    const nowMs = performance.now();
    const delta = subBassEnergy - this.prevBassAvg;
    const isBeat =
      (delta > 0.095 && subBassEnergy > 0.34 && nowMs - this.lastBeatTime > 210) ||
      this.djFlareValue > 0.75;
    if (isBeat && nowMs - this.lastBeatTime > 210) {
      if (this.sourceMode !== 'groove') {
        this.recordBeatAndEstimateBpm(nowMs, subBassEnergy);
      } else {
        this.lastBeatTime = nowMs;
        this.beatListeners.forEach((cb) => cb(subBassEnergy));
      }
    }
    this.prevBassAvg = this.prevBassAvg * 0.82 + subBassEnergy * 0.18;

    for (let b = 0; b < 28; b++) {
      const t0 = Math.pow(b / 28, 1.75);
      const t1 = Math.pow((b + 1) / 28, 1.75);
      const startBin = Math.max(1, Math.floor(t0 * (binCount * 0.82)));
      const endBin = Math.max(startBin + 1, Math.floor(t1 * (binCount * 0.82)));
      let sum = 0;
      for (let k = startBin; k < endBin && k < binCount; k++) {
        sum += activeData[k];
      }
      const avg = sum / Math.max(1, endBin - startBin) / 255;
      this.reusableSpectrum[b] = Math.max(0.03, Math.min(1, avg));
    }

    const signalActive = subBassEnergy > 0.06 || midEnergy > 0.06;

    return {
      spectrum: this.reusableSpectrum,
      subBassEnergy: Math.max(subBassEnergy, this.djFlareValue * 0.75),
      midEnergy: Math.max(midEnergy, this.currentVoiceRms * 0.65),
      highEnergy,
      isBeat,
      detectedBpm: signalActive || this.sourceMode === 'groove' ? this.detectedBpm : 0,
      djFlare: this.djFlareValue,
      karaokeVoiceLevel: this.currentVoiceRms,
      externalMusicActive:
        this.sourceMode !== 'groove' && this.isPlaying && signalActive,
    };
  }
}

export const audioEngine = new PartyBoxAudioEngine();
