// Engine seam for voice mode. The orchestration (src/state/voice.svelte.ts) only sees these two
// interfaces, so other providers (OpenRouter, browser speech) can be added next to elevenlabs.ts.

export type VoiceProvider = 'elevenlabs';

/** Stored under K.voice on this device only. */
export interface VoiceConfig {
  provider: VoiceProvider;
  apiKey: string;
  voiceId: string;
  voiceName: string;
  ttsModel: string;
  sttModel: string;
}

export type VoiceErrorKind = 'auth' | 'quota' | 'rate' | 'mic' | 'closed' | 'input' | 'network' | 'other';

/** Voice failures carry a plain-words message meant for the inline voice status line. */
export class VoiceError extends Error {
  override name = 'VoiceError';
  constructor(
    message: string,
    readonly kind: VoiceErrorKind = 'other',
  ) {
    super(message);
  }
}

export interface SttHandlers {
  /** Interim text for the current utterance (replaces the previous partial). */
  onPartial(text: string): void;
  /** Final text for one utterance (after a manual commit or when VAD decides the user stopped). */
  onCommitted(text: string): void;
  /** Fatal for this session; the session is closed afterwards. */
  onError(e: VoiceError): void;
  /** The session ended (always called once, after onError too). */
  onClose(): void;
}

export interface SttOpenOptions {
  /** Sample rate of the 16-bit mono PCM passed to send(). */
  sampleRate: number;
  /** true: the engine decides when an utterance ends; false: the caller commits. */
  vad: boolean;
  language?: string;
}

/** One live speech-to-text session (one WebSocket for ElevenLabs). */
export interface SttSession {
  /** Queues 16-bit mono PCM at the session's sample rate; sent as soon as the session is ready. */
  send(pcm: Int16Array): void;
  /** Ends the current utterance (manual mode). The final chunk, if any, goes with the commit. */
  commit(last?: Int16Array): void;
  close(): void;
}

export interface SttEngine {
  open(o: SttOpenOptions, h: SttHandlers): Promise<SttSession>;
}

export interface TtsEngine {
  /** Sample rate of the Float32 samples yielded by synth(). */
  readonly sampleRate: number;
  /** Streams mono samples for one piece of text; abort the signal to cancel. */
  synth(text: string, signal: AbortSignal): AsyncIterable<Float32Array>;
}
