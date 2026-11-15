// Pure PCM helpers: 16-bit little-endian mono <-> Float32, base64 and a streaming resampler.

/** Decodes a 16-bit LE PCM byte stream; a sample split across two chunks is carried over. */
export class Pcm16Decoder {
  private carry: number | null = null;

  push(bytes: Uint8Array): Float32Array {
    const total = bytes.length + (this.carry === null ? 0 : 1);
    const out = new Float32Array(total >> 1);
    let i = 0;
    let o = 0;
    if (this.carry !== null && bytes.length) {
      out[o++] = s16(this.carry, bytes[0]!);
      i = 1;
      this.carry = null;
    }
    for (; i + 1 < bytes.length; i += 2) out[o++] = s16(bytes[i]!, bytes[i + 1]!);
    if (i < bytes.length) this.carry = bytes[i]!;
    return out;
  }

  /** True when an odd byte is waiting for its partner. */
  get pending(): boolean {
    return this.carry !== null;
  }
}

function s16(lo: number, hi: number): number {
  const v = (hi << 8) | lo;
  return (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
}

/** Float samples in [-1, 1] → signed 16-bit (clamped). */
export function floatTo16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]!));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

/** Base64 of the samples as little-endian bytes (independent of platform byte order). */
export function int16ToBase64(pcm: Int16Array): string {
  let bin = '';
  const STEP = 0x2000;
  for (let i = 0; i < pcm.length; i += STEP) {
    const end = Math.min(pcm.length, i + STEP);
    const bytes = new Array<number>((end - i) * 2);
    for (let k = i, b = 0; k < end; k++) {
      const v = pcm[k]! & 0xffff;
      bytes[b++] = v & 0xff;
      bytes[b++] = v >> 8;
    }
    bin += String.fromCharCode(...bytes);
  }
  return btoa(bin);
}

/**
 * Streaming downsampler (box average over each output period, fractional position carried
 * between chunks). Used when the capture context does not run at the transcription rate.
 * Upsampling falls back to linear interpolation.
 */
export class Resampler {
  private ratio: number;
  private pos = 0; // position of the next output sample, in input samples relative to `held`
  private held = new Float32Array(0);

  constructor(
    readonly from: number,
    readonly to: number,
  ) {
    this.ratio = from / to;
  }

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const buf = new Float32Array(this.held.length + input.length);
    buf.set(this.held);
    buf.set(input, this.held.length);
    const out: number[] = [];
    if (this.ratio >= 1) {
      while (this.pos + this.ratio <= buf.length) {
        const a = Math.floor(this.pos);
        const b = Math.max(a + 1, Math.floor(this.pos + this.ratio));
        let sum = 0;
        for (let k = a; k < b; k++) sum += buf[k]!;
        out.push(sum / (b - a));
        this.pos += this.ratio;
      }
    } else {
      while (this.pos + 1 < buf.length) {
        const a = Math.floor(this.pos);
        const t = this.pos - a;
        out.push(buf[a]! * (1 - t) + buf[a + 1]! * t);
        this.pos += this.ratio;
      }
    }
    const drop = Math.floor(this.pos);
    this.held = buf.slice(drop);
    this.pos -= drop;
    return Float32Array.from(out);
  }
}
