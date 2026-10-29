import {
  AcousticEnvironment,
  BassBoostMode,
  DemoGrooveId,
  DjPadEffectId,
  EQ_BANDS,
} from '../types/speaker';
import { bluetoothBridge } from './bluetoothBridge';

export interface AudioAnalysisFrame {
  spectrum: number[]; // 28 normalized bars 0..1
  subBassEnergy: number; // 0..1 (40Hz - 110Hz)
  midEnergy: number; // 0..1
  highEnergy: number; // 0..1
  isBeat: boolean;
  djFlare: number; // 0..1 decaying flare triggered by DJ pads
}

class PartyBoxAudioEngine {
  private ctx: AudioContext | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassBoostFilter: BiquadFilterNode | null = null;
  private environmentLowFilter: BiquadFilterNode | null = null;
  private environmentHighFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;

  // Sources
  private sourceMode: 'groove' | 'file' | 'mic' = 'groove';
  private isPlaying = false;
  private currentGroove: DemoGrooveId = 'house_124';
  private grooveTimer: number | null = null;
  private stepIndex = 0;

  private audioElement: HTMLAudioElement | null = null;
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private uploadedFileName: string | null = null;

  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  // Beat & DJ flare tracking
  private prevBassAvg = 0;
  private lastBeatTime = 0;
  private djFlareValue = 0;

  // Stored DSP settings for pre-init sync
  private currentGains: number[] = [4.5, 3.0, -0.5, 0.0, 1.5, 3.0, 4.0];
  private currentBassBoost: BassBoostMode = BassBoostMode.Deep;
  private currentEnvironment: AcousticEnvironment = AcousticEnvironment.Indoor;
  private currentAiBoost = true;
  private currentPlaytimeBoost = false;
  private currentVolume = 72;
  private currentMuted = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

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

      // BassBoost stage
      this.bassBoostFilter = this.ctx.createBiquadFilter();
      this.bassBoostFilter.type = 'peaking';

      // Environment boundary compensation filters
      this.environmentLowFilter = this.ctx.createBiquadFilter();
      this.environmentLowFilter.type = 'lowshelf';
      this.environmentLowFilter.frequency.value = 95;

      this.environmentHighFilter = this.ctx.createBiquadFilter();
      this.environmentHighFilter.type = 'highshelf';
      this.environmentHighFilter.frequency.value = 6500;

      // AI Sound Boost Dynamics Processor
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.14;

      // Master Gain & Analyser
      this.masterGain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.76;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

      // Connect DSP chain: eq[0]->...->eq[6]->bassBoost->envLow->envHigh->compressor->analyser->masterGain->destination
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
    return this.eqFilters[0];
  }

  public applyDspSettings(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // 7-Band EQ
    this.eqFilters.forEach((filter, idx) => {
      const targetGain = this.currentPlaytimeBoost
        ? (this.currentGains[idx] ?? 0) * 0.65 - (idx <= 1 ? 2.5 : 0)
        : (this.currentGains[idx] ?? 0);
      filter.gain.setTargetAtTime(targetGain, now, 0.025);
    });

    // JBL BassBoost (Off / Deep 48Hz / Punchy 82Hz)
    if (this.bassBoostFilter) {
      if (this.currentPlaytimeBoost || this.currentBassBoost === BassBoostMode.Off) {
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

    // Acoustic Environment (Indoor vs Outdoor open-air compensation)
    if (this.environmentLowFilter && this.environmentHighFilter) {
      if (this.currentEnvironment === AcousticEnvironment.Outdoor) {
        this.environmentLowFilter.gain.setTargetAtTime(2.5, now, 0.04);
        this.environmentHighFilter.gain.setTargetAtTime(2.0, now, 0.04);
      } else {
        this.environmentLowFilter.gain.setTargetAtTime(0, now, 0.04);
        this.environmentHighFilter.gain.setTargetAtTime(0, now, 0.04);
      }
    }

    // AI Sound Boost compressor
    if (this.compressor) {
      this.compressor.threshold.setTargetAtTime(this.currentAiBoost ? -18 : -4, now, 0.04);
      this.compressor.ratio.setTargetAtTime(this.currentAiBoost ? 4.5 : 1.5, now, 0.04);
    }

    // Master Volume
    if (this.masterGain) {
      const effectiveGain = this.currentMuted ? 0 : Math.pow(this.currentVolume / 100, 1.65);
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
      if (this.audioElement) {
        const el = this.audioElement as HTMLAudioElement & {
          setSinkId?: (id: string) => Promise<void>;
        };
        if (typeof el.setSinkId === 'function') {
          await el.setSinkId(deviceId);
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Computes exact composite dB response across 64 log-spaced frequencies (25Hz - 18kHz)
   * so the Equalizer curve reflects EQ + BassBoost + Acoustic Environment in real time.
   */
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
      freqs[i] = Math.pow(10, minLog + (i / (numPoints - 1)) * (maxLog - minLog));
    }

    // Analytical biquad magnitude approximation so the curve renders smoothly even before AudioContext starts
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
          // Low-shelf smooth transition
          const weight = 1 / (1 + Math.exp(octaveDist * 2.8));
          totalDb += g * weight;
        } else if (idx === EQ_BANDS.length - 1) {
          // High-shelf smooth transition
          const weight = 1 / (1 + Math.exp(-octaveDist * 2.8));
          totalDb += g * weight;
        } else {
          // Bell filter
          const bandwidth = 0.72;
          const weight = Math.exp(-(octaveDist * octaveDist) / (2 * bandwidth * bandwidth));
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

  // --- Playback & Sources ---

  public getSourceState() {
    return {
      sourceMode: this.sourceMode,
      isPlaying: this.isPlaying,
      currentGroove: this.currentGroove,
      uploadedFileName: this.uploadedFileName,
    };
  }

  public startGroove(grooveId?: DemoGrooveId): void {
    const ctx = this.ensureContext();
    this.stopMicCapture();
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }

    if (grooveId) {
      this.currentGroove = grooveId;
    }
    this.sourceMode = 'groove';
    this.isPlaying = true;

    if (this.grooveTimer !== null) {
      window.clearInterval(this.grooveTimer);
    }

    const bpmMap: Record<DemoGrooveId, number> = {
      house_124: 124,
      sub_tech_128: 128,
      mediterranean_112: 112,
      bass_sweep: 100,
    };
    const bpm = bpmMap[this.currentGroove];
    const sixteenthMs = (60 / bpm / 4) * 1000;

    this.stepIndex = 0;
    this.triggerGrooveStep(ctx, this.stepIndex);
    this.grooveTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.ctx) return;
      this.stepIndex = (this.stepIndex + 1) % 16;
      this.triggerGrooveStep(this.ctx, this.stepIndex);
    }, sixteenthMs);
  }

  public togglePlay(): boolean {
    if (this.isPlaying) {
      this.pause();
      return false;
    }
    if (this.sourceMode === 'file' && this.audioElement) {
      this.ensureContext();
      this.audioElement.play().catch(() => {});
      this.isPlaying = true;
      return true;
    }
    this.startGroove(this.currentGroove);
    return true;
  }

  public pause(): void {
    this.isPlaying = false;
    if (this.grooveTimer !== null) {
      window.clearInterval(this.grooveTimer);
      this.grooveTimer = null;
    }
    if (this.audioElement && !this.audioElement.paused) {
      this.audioElement.pause();
    }
    if (this.sourceMode === 'mic') {
      this.stopMicCapture();
      this.sourceMode = 'groove';
    }
  }

  public async loadAudioFile(file: File): Promise<string> {
    const ctx = this.ensureContext();
    this.pause();
    this.stopMicCapture();

    const objectUrl = URL.createObjectURL(file);
    if (!this.audioElement) {
      this.audioElement = new Audio();
      this.audioElement.crossOrigin = 'anonymous';
      this.audioElement.loop = true;
      this.mediaElementSource = ctx.createMediaElementSource(this.audioElement);
      this.mediaElementSource.connect(this.getChainInput());
    }

    this.audioElement.src = objectUrl;
    this.uploadedFileName = file.name;
    this.sourceMode = 'file';
    await this.audioElement.play();
    this.isPlaying = true;
    return file.name;
  }

  public async startMicBeatSync(): Promise<boolean> {
    try {
      const ctx = this.ensureContext();
      this.pause();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.micStream = stream;
      this.micSource = ctx.createMediaStreamSource(stream);
      // Connect ONLY to analyser (not masterGain) to prevent speaker feedback howling
      if (this.analyser) {
        this.micSource.connect(this.analyser);
      }
      this.sourceMode = 'mic';
      this.isPlaying = true;
      return true;
    } catch {
      return false;
    }
  }

  private stopMicCapture(): void {
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // ignore
      }
      this.micSource = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  // --- Synthesized Musical Groove Engine (Rich Low-End, Mid Chords & Crisp Hats) ---

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
        osc.frequency.exponentialRampToValueAtTime(step === 0 ? 85 : 44, now + 0.75);
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
      // Darbuka / Mediterranean electronic party groove (Dum-Tek-Tek-Dum-Tek)
      if (step === 0 || step === 6 || step === 8) {
        this.synthKick(ctx, dest, now, 130, 48, 0.34);
      }
      if (step === 4 || step === 12) {
        this.synthClap(ctx, dest, now, 0.22);
      }
      if (step === 2 || step === 7 || step === 10 || step === 14 || step === 15) {
        this.synthHat(ctx, dest, now, 0.14);
      }
      const scaleFreqs = [110, 116.54, 138.59, 146.83, 164.81, 174.61, 207.65]; // Hijaz A
      if (step % 2 === 0) {
        const note = scaleFreqs[(step / 2) % scaleFreqs.length];
        this.synthPluck(ctx, dest, now, note * 2, 0.16);
      }
      if (step === 0 || step === 6 || step === 12) {
        this.synthBassNote(ctx, dest, now, step === 6 ? 116.54 / 2 : 55, 0.24);
      }
      return;
    }

    if (this.currentGroove === 'sub_tech_128') {
      if (step % 4 === 0) {
        this.synthKick(ctx, dest, now, 155, 42, 0.38);
      }
      if (step % 4 === 2) {
        this.synthHat(ctx, dest, now, 0.18);
        this.synthBassNote(ctx, dest, now, 51.91, 0.22); // G#1 offbeat rolling sub
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

    // Default: house_124 (Stage 320 Signature Party House)
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
      this.synthChordStab(ctx, dest, now, [chordRoot, chordRoot * 1.189, chordRoot * 1.498], 0.12);
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

  private synthHat(ctx: AudioContext, dest: AudioNode, time: number, level: number): void {
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

  private synthClap(ctx: AudioContext, dest: AudioNode, time: number, level: number): void {
    const bufferSize = Math.floor(ctx.sampleRate * 0.14);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.035));
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

  // --- Real-Time Analysis Frame ---

  public getAnalysisFrame(): AudioAnalysisFrame {
    this.djFlareValue = Math.max(0, this.djFlareValue * 0.9);

    if (!this.analyser || !this.freqData || (!this.isPlaying && this.djFlareValue < 0.02)) {
      return {
        spectrum: new Array(28).fill(0.03),
        subBassEnergy: this.djFlareValue * 0.8,
        midEnergy: this.djFlareValue * 0.5,
        highEnergy: this.djFlareValue * 0.6,
        isBeat: this.djFlareValue > 0.7,
        djFlare: this.djFlareValue,
      };
    }

    this.analyser.getByteFrequencyData(this.freqData);
    const binCount = this.freqData.length; // 128 bins

    // Sub-bass & bass energy (bins 1..8)
    let bassSum = 0;
    for (let i = 1; i <= 7; i++) {
      bassSum += this.freqData[i];
    }
    const subBassEnergy = Math.min(1, bassSum / (7 * 235));

    // Mid energy (bins 8..36)
    let midSum = 0;
    for (let i = 8; i <= 36; i++) {
      midSum += this.freqData[i];
    }
    const midEnergy = Math.min(1, midSum / (29 * 210));

    // High energy (bins 37..95)
    let highSum = 0;
    for (let i = 37; i <= 95; i++) {
      highSum += this.freqData[i];
    }
    const highEnergy = Math.min(1, highSum / (59 * 180));

    // Beat onset detection
    const nowMs = performance.now();
    const delta = subBassEnergy - this.prevBassAvg;
    const isBeat =
      (delta > 0.11 && subBassEnergy > 0.42 && nowMs - this.lastBeatTime > 210) ||
      this.djFlareValue > 0.75;
    if (isBeat && nowMs - this.lastBeatTime > 210) {
      this.lastBeatTime = nowMs;
    }
    this.prevBassAvg = this.prevBassAvg * 0.82 + subBassEnergy * 0.18;

    // 28 logarithmically mapped spectrum bars
    const bars: number[] = [];
    for (let b = 0; b < 28; b++) {
      const t0 = Math.pow(b / 28, 1.75);
      const t1 = Math.pow((b + 1) / 28, 1.75);
      const startBin = Math.max(1, Math.floor(t0 * (binCount * 0.82)));
      const endBin = Math.max(startBin + 1, Math.floor(t1 * (binCount * 0.82)));
      let sum = 0;
      for (let k = startBin; k < endBin && k < binCount; k++) {
        sum += this.freqData[k];
      }
      const avg = sum / Math.max(1, endBin - startBin) / 255;
      bars.push(Math.max(0.04, Math.min(1, avg)));
    }

    return {
      spectrum: bars,
      subBassEnergy: Math.max(subBassEnergy, this.djFlareValue * 0.75),
      midEnergy,
      highEnergy,
      isBeat,
      djFlare: this.djFlareValue,
    };
  }
}

export const audioEngine = new PartyBoxAudioEngine();
