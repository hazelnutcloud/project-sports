import type { CalloutType } from '../types/game';
import type { TennisCalloutType, TennisShotType } from '../types/tennis';

/**
 * Procedural Web Audio synthesizer for Spocco Square Bowling:
 * - Rolling wood rumble (continuous, speed-modulated)
 * - Woody pin collisions scaled by impulse
 * - Gutter hollow thud
 * - Upbeat Switch-Sports-inspired strike / spare / UI jingles
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollNoiseNode: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastPinSoundAt = 0;

  public unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.noiseBuffer = this.createNoiseBuffer(this.ctx, 2.0);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopRollLoop();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public playUiPop(freq = 580): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.45, now + 0.065);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  public playBallLanding(speed: number): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.35, speed / 12));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.14);
    gain.gain.setValueAtTime(0.28 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public updateRollLoop(speed: number, onLane: boolean): void {
    if (this.muted || !this.ctx || !this.noiseBuffer) return;

    if (!onLane || speed < 0.4) {
      this.stopRollLoop();
      return;
    }

    if (!this.rollNoiseNode) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 140;
      filter.Q.value = 1.6;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.001;

      src.connect(filter).connect(gain).connect(this.ctx.destination);
      src.start();

      this.rollNoiseNode = src;
      this.rollFilter = filter;
      this.rollGain = gain;
    }

    const norm = Math.min(1, speed / 13);
    const now = this.ctx.currentTime;
    this.rollFilter?.frequency.setTargetAtTime(95 + norm * 160, now, 0.05);
    this.rollGain?.gain.setTargetAtTime(0.03 + norm * 0.11, now, 0.05);
  }

  public stopRollLoop(): void {
    if (this.rollGain && this.ctx) {
      this.rollGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
    }
    if (this.rollNoiseNode) {
      const node = this.rollNoiseNode;
      this.rollNoiseNode = null;
      this.rollGain = null;
      this.rollFilter = null;
      window.setTimeout(() => {
        try {
          node.stop();
          node.disconnect();
        } catch {
          // ignore
        }
      }, 120);
    }
  }

  public playPinHit(impulse: number): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;

    const nowMs = performance.now();
    if (nowMs - this.lastPinSoundAt < 28) return;
    this.lastPinSoundAt = nowMs;

    const now = this.ctx.currentTime;
    const strength = Math.min(1, Math.max(0.15, impulse / 14));

    // Crisp woody crack (bandpassed noise burst)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100 + Math.random() * 650, now);
    bp.Q.value = 3.2;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.32 * strength, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    src.connect(bp).connect(noiseGain).connect(this.ctx.destination);
    src.start(now, Math.random() * 0.8, 0.11);

    // Resonant maple knock tone
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const baseFreq = 420 + Math.random() * 240;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.58, now + 0.07);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.22 * strength, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(oscGain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playGutterThud(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.22);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playPinsetterCycle(durationSec = 0.34): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(112, now);
    osc.frequency.linearRampToValueAtTime(142, now + durationSec * 0.5);
    osc.frequency.linearRampToValueAtTime(98, now + durationSec);

    filter.type = 'lowpass';
    filter.frequency.value = 340;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.045, now + 0.04);
    gain.gain.setValueAtTime(0.04, now + Math.max(0.05, durationSec - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(filter).connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  public playSweeperSweep(durationSec = 0.55): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(260, now);
    bp.frequency.linearRampToValueAtTime(420, now + durationSec * 0.5);
    bp.frequency.linearRampToValueAtTime(220, now + durationSec);
    bp.Q.value = 1.4;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.075, now + 0.06);
    gain.gain.setValueAtTime(0.065, now + Math.max(0.08, durationSec - 0.1));
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    src.connect(bp).connect(gain).connect(this.ctx.destination);
    src.start(now, Math.random() * 0.6, durationSec + 0.04);
  }

  public playCalloutJingle(callout: CalloutType | null): void {
    if (this.muted || !callout) return;
    this.unlock();
    if (!this.ctx) return;

    if (callout === 'GUTTER') {
      this.playNotes([330, 277, 233], 0.14, 'triangle', 0.11);
      return;
    }
    if (callout === 'SPLIT') {
      this.playNotes([440, 392], 0.11, 'sine', 0.1);
      return;
    }
    if (callout === 'SPARE' || callout === 'NICE_PICKUP') {
      this.playNotes([523.25, 659.25, 783.99, 1046.5], 0.09, 'triangle', 0.13);
      return;
    }
    // Strike / Double / Turkey / Perfect Game celebratory bright fanfare
    this.playNotes(
      [523.25, 659.25, 783.99, 1046.5, 1318.5],
      0.085,
      'triangle',
      0.16
    );
  }

  public playRacketHit(power: number, shotType: TennisShotType, isPowerShot = false): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const strength = Math.min(1, Math.max(0.28, power));

    // Crisp strung-racket thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = isPowerShot || shotType === 'smash' ? 'sawtooth' : 'triangle';

    const baseFreq =
      shotType === 'lob'
        ? 235
        : shotType === 'slice'
          ? 340
          : isPowerShot || shotType === 'smash'
            ? 205
            : 270;
    osc.frequency.setValueAtTime(baseFreq + strength * 65, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.44, now + 0.095);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = isPowerShot ? 1600 : 1200;

    gain.gain.setValueAtTime((isPowerShot ? 0.34 : 0.24) * strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(filter).connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);

    // Taut string snap transient (bandpassed noise burst)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(shotType === 'slice' ? 2400 : 1650 + strength * 500, now);
    bp.Q.value = 2.6;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime((isPowerShot ? 0.32 : 0.2) * strength, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    src.connect(bp).connect(noiseGain).connect(this.ctx.destination);
    src.start(now, Math.random() * 0.6, 0.08);
  }

  public playTennisBounce(speed: number): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const intensity = Math.min(1, Math.max(0.2, speed / 18));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360 + intensity * 120, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.065);

    gain.gain.setValueAtTime(0.18 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  public playNetHit(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520, now);
    bp.Q.value = 1.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    src.connect(bp).connect(gain).connect(this.ctx.destination);
    src.start(now, Math.random() * 0.5, 0.18);
  }

  public playServeToss(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.11);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playTennisCalloutJingle(callout: TennisCalloutType | null): void {
    if (this.muted || !callout) return;
    this.unlock();
    if (!this.ctx) return;

    if (callout === 'FAULT' || callout === 'OUT' || callout === 'NET') {
      this.playNotes([330, 262], 0.11, 'triangle', 0.1);
      return;
    }
    if (callout === 'DOUBLE_FAULT') {
      this.playNotes([330, 277, 220], 0.12, 'triangle', 0.11);
      return;
    }
    if (callout === 'LET') {
      this.playNotes([440, 523.25], 0.08, 'sine', 0.09);
      return;
    }
    if (callout === 'DEUCE' || callout === 'ADVANTAGE' || callout === 'GAME_POINT' || callout === 'MATCH_POINT') {
      this.playNotes([440, 554.37, 659.25], 0.08, 'sine', 0.11);
      return;
    }
    if (callout === 'ACE' || callout === 'POWER_SERVE' || callout === 'SMASH' || callout === 'NICE_SHOT') {
      this.playNotes([587.33, 739.99, 880], 0.07, 'triangle', 0.13);
      return;
    }
    if (callout === 'GAME') {
      this.playNotes([523.25, 659.25, 783.99, 1046.5], 0.09, 'triangle', 0.14);
      return;
    }
    // MATCH_WIN fanfare
    this.playNotes([523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98], 0.085, 'triangle', 0.16);
  }

  private playNotes(
    freqs: number[],
    stepSec: number,
    type: OscillatorType,
    volume: number
  ): void {
    if (!this.ctx) return;
    const base = this.ctx.currentTime;
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const start = base + idx * stepSec;
      const dur = idx === freqs.length - 1 ? stepSec * 3.2 : stepSec * 1.4;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    });
  }

  private createNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}
