/**
 * Web-Audio synthesized sound effects for the game. Uses oscillators only
 * (no asset files required) so it adds zero bytes to bundle.
 *
 * Volume is muted until the first user gesture so browsers don't block
 * audio playback.
 */

type EnvOptions = {
  freq: number;
  endFreq?: number;
  type?: OscillatorType;
  duration: number;
  volume?: number;
  attack?: number;
  release?: number;
};

export class SoundFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  /** Lazily create the AudioContext on first use. Must be triggered by a
   *  user gesture (click/key) or browsers will refuse to start it. */
  private ensure(): boolean {
    if (this.muted) return false;
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.3;
        this.master.connect(this.ctx.destination);
      } catch {
        this.muted = true;
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  private envelope(opts: EnvOptions) {
    if (!this.ensure() || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.endFreq && opts.endFreq !== opts.freq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.endFreq),
        now + opts.duration,
      );
    }
    const peak = opts.volume ?? 0.5;
    const attack = opts.attack ?? 0.005;
    const release = opts.release ?? opts.duration * 0.8;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration + release);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + opts.duration + release + 0.05);
  }

  /** Bright high ding when collecting a coin. */
  coinPickup() {
    this.envelope({ freq: 880, endFreq: 1320, type: 'sine', duration: 0.08, volume: 0.4 });
    this.envelope({ freq: 1760, type: 'sine', duration: 0.05, volume: 0.18, attack: 0.002 });
  }

  /** Softer pop for food pellets. */
  foodPickup() {
    this.envelope({ freq: 520, endFreq: 720, type: 'sine', duration: 0.06, volume: 0.28 });
  }

  /** Rising swoosh when starting a boost. */
  boostStart() {
    this.envelope({ freq: 280, endFreq: 640, type: 'sawtooth', duration: 0.18, volume: 0.22 });
  }

  /** Descending wail when player dies. */
  death() {
    this.envelope({ freq: 320, endFreq: 60, type: 'sawtooth', duration: 0.6, volume: 0.45, release: 0.1 });
  }

  /** Triumphant chord when eliminating an opponent. */
  kill() {
    this.envelope({ freq: 523, type: 'sine', duration: 0.12, volume: 0.35 }); // C
    this.envelope({ freq: 659, type: 'sine', duration: 0.16, volume: 0.3 });  // E
    this.envelope({ freq: 784, type: 'sine', duration: 0.22, volume: 0.3 });  // G
  }

  /** Sharp blip when planting / hitting a trap. */
  trap() {
    this.envelope({ freq: 180, endFreq: 80, type: 'square', duration: 0.1, volume: 0.3 });
  }
}
