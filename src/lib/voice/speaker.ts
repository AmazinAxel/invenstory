// Speaks a queue of sentences: one text-to-speech request at a time, at most one sentence
// downloaded ahead of the one playing, everything cancellable at once. No DOM: the audio sink is
// injected, so tests drive it with fakes.

import type { AudioSink } from './player.ts';
import type { TtsEngine } from './types.ts';

/** Samples gathered before scheduling (100 ms at 24 kHz): fewer, larger buffers play cleaner. */
const MIN_BLOCK = 2400;

export interface SpeakerHooks {
  /** Busy = something queued, downloading or playing. Fired on every change. */
  onBusy?(busy: boolean): void;
  onError?(e: unknown): void;
}

export class Speaker {
  private queue: string[] = [];
  private downloading = false;
  private ends: number[] = []; // end times of fully downloaded sentences still playing
  private ctl: AbortController | null = null;
  private gen = 0;
  private wasBusy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private tts: TtsEngine,
    private sink: AudioSink,
    private hooks: SpeakerHooks = {},
  ) {
    sink.onEnded = () => this.pump();
  }

  get busy(): boolean {
    return this.queue.length > 0 || this.downloading || this.sink.active;
  }

  say(text: string) {
    const t = text.trim();
    if (!t) return;
    this.queue.push(t);
    this.pump();
  }

  /** Silences now, cancels the request in flight and drops the queue. */
  stop() {
    this.gen++;
    this.queue = [];
    this.ctl?.abort();
    this.ctl = null;
    this.downloading = false;
    this.ends = [];
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sink.stop();
    this.update();
  }

  private pump() {
    const now = this.sink.now();
    this.ends = this.ends.filter((e) => e > now);
    if (!this.downloading && this.queue.length) {
      if (this.ends.length <= 1) {
        void this.fetch(this.queue.shift()!, this.gen);
      } else if (!this.timer) {
        // Wait until the playing sentence is done, then fetch the next one.
        this.timer = setTimeout(
          () => {
            this.timer = null;
            this.pump();
          },
          Math.max(20, (this.ends[0]! - now) * 1000 + 20),
        );
      }
    }
    this.update();
  }

  private async fetch(text: string, gen: number) {
    this.downloading = true;
    const ctl = new AbortController();
    this.ctl = ctl;
    let end = 0;
    let parts: Float32Array[] = [];
    let n = 0;
    const flush = () => {
      if (!n) return;
      const all = new Float32Array(n);
      let o = 0;
      for (const p of parts) {
        all.set(p, o);
        o += p.length;
      }
      parts = [];
      n = 0;
      end = this.sink.play(all, this.tts.sampleRate);
    };
    try {
      for await (const s of this.tts.synth(text, ctl.signal)) {
        if (gen !== this.gen) return;
        parts.push(s);
        n += s.length;
        if (n >= MIN_BLOCK) flush();
      }
      if (gen === this.gen) flush();
    } catch (e) {
      if (gen === this.gen && !ctl.signal.aborted) {
        this.stop();
        this.hooks.onError?.(e);
      }
    } finally {
      if (gen === this.gen) {
        this.downloading = false;
        this.ctl = null;
        if (end) this.ends.push(end);
        this.pump();
      }
    }
  }

  private update() {
    const b = this.busy;
    if (b !== this.wasBusy) {
      this.wasBusy = b;
      this.hooks.onBusy?.(b);
    }
  }
}
