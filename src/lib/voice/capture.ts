// Microphone capture: getUserMedia (echo cancellation, noise suppression, auto gain, mono) →
// AudioWorklet (public/voice-capture.js, same-origin for the CSP) → 16 kHz 16-bit PCM blocks
// of about 100 ms. Browser only.

import { floatTo16, Resampler } from './pcm.ts';
import { VoiceError } from './types.ts';

/** Rate sent to speech-to-text (pcm_16000). Other capture rates are resampled to it. */
export const STT_RATE = 16000;
const WORKLET_URL = '/voice-capture.js';

export interface Mic {
  /** Stops capture and returns the last, partial block (send it with the commit). */
  stop(): Promise<Int16Array>;
}

/**
 * Creates the capture context. Call it synchronously inside the user's tap (autoplay policy, iOS).
 * Prefers 16 kHz so no resampling is needed; falls back to the device rate.
 */
export function createCaptureContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: STT_RATE, latencyHint: 'interactive' });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

export function micError(e: unknown): VoiceError {
  const name = e instanceof DOMException ? e.name : e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new VoiceError('Microphone access is blocked. Allow the microphone for this site in the browser settings.', 'mic');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new VoiceError('No microphone was found on this device.', 'mic');
  if (name === 'NotReadableError' || name === 'AbortError') return new VoiceError('The microphone is busy (another app may be using it).', 'mic');
  return new VoiceError(`Could not start the microphone${e instanceof Error && e.message ? `: ${e.message}` : '.'}`, 'mic');
}

async function attach(ctx: AudioContext, stream: MediaStream): Promise<MediaStreamAudioSourceNode> {
  await ctx.audioWorklet.addModule(WORKLET_URL);
  if (ctx.state !== 'running') await ctx.resume().catch(() => {});
  return ctx.createMediaStreamSource(stream);
}

/**
 * Starts the mic on `ctx` and calls onChunk with 16 kHz PCM. onEnded fires if the device stops
 * (unplugged, permission revoked).
 */
export async function startMic(ctx: AudioContext, onChunk: (pcm: Int16Array) => void, onEnded: () => void): Promise<Mic> {
  if (!navigator.mediaDevices?.getUserMedia) throw new VoiceError('Voice needs a secure (https) page in a browser with microphone support.', 'mic');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (e) {
    void ctx.close().catch(() => {});
    throw micError(e);
  }
  let src: MediaStreamAudioSourceNode;
  try {
    try {
      src = await attach(ctx, stream);
    } catch (e) {
      // Firefox cannot connect a mic to a context running at another rate: use the device rate.
      if (ctx.sampleRate === STT_RATE && !(e instanceof DOMException && e.name === 'AbortError')) {
        void ctx.close().catch(() => {});
        ctx = new AudioContext({ latencyHint: 'interactive' });
        src = await attach(ctx, stream);
      } else throw e;
    }
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().catch(() => {});
    throw e instanceof VoiceError ? e : new VoiceError(`Could not start audio capture${e instanceof Error && e.message ? `: ${e.message}` : '.'}`, 'mic');
  }

  const resampler = new Resampler(ctx.sampleRate, STT_RATE);
  const node = new AudioWorkletNode(ctx, 'voice-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { blockSize: Math.round(ctx.sampleRate / 10) },
  });
  let last: ((pcm: Int16Array) => void) | null = null;
  // Full blocks arrive as Float32Array; the answer to 'flush' as { last } (the partial block).
  node.port.onmessage = (e: MessageEvent<Float32Array | { last: Float32Array }>) => {
    if (e.data instanceof Float32Array) {
      const pcm = floatTo16(resampler.push(e.data));
      if (pcm.length) onChunk(pcm);
    } else if (last) {
      const done = last;
      last = null;
      done(floatTo16(resampler.push(e.data.last)));
    }
  };
  src.connect(node);
  node.connect(ctx.destination); // outputs silence; keeps the node pulled in every browser
  const track = stream.getAudioTracks()[0];
  let stopped = false;
  track?.addEventListener('ended', () => {
    if (!stopped) onEnded();
  });

  const release = () => {
    stopped = true;
    node.port.onmessage = null;
    for (const t of stream.getTracks()) t.stop();
    try {
      src.disconnect();
      node.disconnect();
    } catch {
      /* already disconnected */
    }
    void ctx.close().catch(() => {});
  };

  return {
    stop: () =>
      new Promise<Int16Array>((resolve) => {
        if (stopped) return resolve(new Int16Array(0));
        const timer = setTimeout(() => {
          last = null;
          release();
          resolve(new Int16Array(0));
        }, 250);
        last = (pcm) => {
          clearTimeout(timer);
          release();
          resolve(pcm);
        };
        node.port.postMessage('flush');
      }),
  };
}
