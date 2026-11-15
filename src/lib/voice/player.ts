// Gapless PCM playback through one AudioContext. WebAudio (not an <audio> element with blob: URLs)
// so the CSP needs no media-src change. Browser only.

/** Where the speaker sends audio; a fake implements it in tests. */
export interface AudioSink {
  /** Schedules samples right after what is already queued; returns the end time in seconds. */
  play(samples: Float32Array, rate: number): number;
  /** Current clock in the same seconds as play()'s return value. */
  now(): number;
  /** Something is scheduled or playing. */
  readonly active: boolean;
  /** Silences immediately and forgets everything scheduled. */
  stop(): void;
  /** Called whenever one scheduled piece finishes. */
  onEnded: (() => void) | null;
}

export class WebAudioSink implements AudioSink {
  readonly ctx: AudioContext;
  onEnded: (() => void) | null = null;
  private next = 0;
  private live = new Set<AudioBufferSourceNode>();

  /** Create inside the user's tap (autoplay policy, iOS). */
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.unlock();
  }

  /** Resumes the context; on iOS a silent one-sample buffer played in a tap unlocks output. */
  unlock() {
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    try {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start();
    } catch {
      /* closed */
    }
  }

  get active() {
    return this.live.size > 0;
  }

  now() {
    return this.ctx.currentTime;
  }

  play(samples: Float32Array, rate: number): number {
    if (!samples.length) return this.next;
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    const buf = this.ctx.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const at = Math.max(this.next, this.ctx.currentTime + 0.03);
    src.start(at);
    this.next = at + buf.duration;
    this.live.add(src);
    src.onended = () => {
      this.live.delete(src);
      this.onEnded?.();
    };
    return this.next;
  }

  stop() {
    for (const s of this.live) {
      s.onended = null;
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* not started */
      }
    }
    this.live.clear();
    this.next = 0;
  }

  close() {
    this.stop();
    void this.ctx.close().catch(() => {});
  }
}
