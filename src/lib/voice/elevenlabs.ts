// ElevenLabs engines (the only voice provider for now), called straight from the browser:
// REST with the `xi-api-key` header (CORS allows it), realtime transcription over a WebSocket
// opened with a fresh single-use token. Plain fetch/WebSocket, no SDK. Never log the key.

import { int16ToBase64, Pcm16Decoder } from './pcm.ts';
import { VoiceError, type SttEngine, type SttHandlers, type SttOpenOptions, type SttSession, type TtsEngine, type VoiceConfig } from './types.ts';

export const ELEVEN_BASE = 'https://api.elevenlabs.io';
export const ELEVEN_WS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
export const TTS_RATE = 24000;
export const DEFAULT_TTS_MODEL = 'eleven_flash_v2_5';
export const STT_MODELS = [
  { id: 'scribe_v2_realtime', name: 'Scribe v2 Realtime' },
  { id: 'scribe_v3_live', name: 'Scribe v3 Live' },
] as const;
export const DEFAULT_STT_MODEL = STT_MODELS[0].id;

const MSG = {
  auth: 'ElevenLabs did not accept the voice key. Check it in the Voice card on the Automations tab.',
  quota: 'Your ElevenLabs credits are used up.',
  rate: 'ElevenLabs is busy right now. Try again in a moment.',
  network: 'Could not reach ElevenLabs. Check the internet connection.',
};

/** Maps an ElevenLabs HTTP error (JSON `{detail:{status,message}}` or text) to plain words. */
export function describeHttpError(status: number, body: unknown): VoiceError {
  const detail = (body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined) as { status?: string; message?: string } | string | undefined;
  const code = typeof detail === 'object' ? (detail?.status ?? '') : '';
  const message = typeof detail === 'object' ? (detail?.message ?? '') : typeof detail === 'string' ? detail : '';
  // Quota errors have come back as 401 with status "quota_exceeded", so check the code first.
  if (status === 402 || /quota|credits|limit_reached/i.test(code)) return new VoiceError(MSG.quota, 'quota');
  if (code === 'invalid_api_key' || code === 'needs_authorization' || (status === 401 && !code)) return new VoiceError(MSG.auth, 'auth');
  if (status === 401) return new VoiceError(message ? `ElevenLabs refused the request: ${message}` : MSG.auth, 'auth');
  if (status === 429) return new VoiceError(MSG.rate, 'rate');
  if (code === 'voice_not_found' || (status === 404 && /voice/i.test(message))) return new VoiceError('The chosen ElevenLabs voice no longer exists. Pick another in the Voice card on the Automations tab.', 'input');
  if (/permission|missing_permissions/i.test(code)) return new VoiceError(`The voice key is missing a permission${message ? `: ${message}` : ''}.`, 'auth');
  return new VoiceError(`ElevenLabs error ${status}${message ? `: ${message}` : ''}`, 'other');
}

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ELEVEN_BASE}${path}`, { ...init, headers: { 'xi-api-key': key, ...(init.headers ?? {}) } });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new VoiceError(MSG.network, 'network');
  }
  if (!res.ok) throw describeHttpError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

export interface Subscription {
  tier: string;
  characterCount: number;
  characterLimit: number;
}

export async function subscription(key: string): Promise<Subscription> {
  const s = await call<{ tier?: string; character_count?: number; character_limit?: number }>(key, '/v1/user/subscription');
  return { tier: s.tier ?? '', characterCount: s.character_count ?? 0, characterLimit: s.character_limit ?? 0 };
}

export interface VoiceChoice {
  id: string;
  name: string;
}

export async function listVoices(key: string): Promise<VoiceChoice[]> {
  const r = await call<{ voices?: { voice_id: string; name?: string }[] }>(key, '/v1/voices');
  return (r.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name || v.voice_id }));
}

export async function listTtsModels(key: string): Promise<VoiceChoice[]> {
  const r = await call<{ model_id: string; name?: string; can_do_text_to_speech?: boolean }[]>(key, '/v1/models');
  return (Array.isArray(r) ? r : []).filter((m) => m.can_do_text_to_speech).map((m) => ({ id: m.model_id, name: m.name || m.model_id }));
}

/** Flash v2.5 when the account has it (low latency, half price), else the first TTS model. */
export function pickTtsModel(models: VoiceChoice[]): string {
  return models.find((m) => m.id === DEFAULT_TTS_MODEL)?.id ?? models[0]?.id ?? DEFAULT_TTS_MODEL;
}

export function elevenTts(cfg: VoiceConfig): TtsEngine {
  return {
    sampleRate: TTS_RATE,
    async *synth(text, signal) {
      let res: Response;
      try {
        res = await fetch(`${ELEVEN_BASE}/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}/stream?output_format=pcm_${TTS_RATE}`, {
          method: 'POST',
          headers: { 'xi-api-key': cfg.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({ text, model_id: cfg.ttsModel }),
          signal,
        });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new VoiceError(MSG.network, 'network');
      }
      if (!res.ok) throw describeHttpError(res.status, await res.json().catch(() => null));
      if (!res.body) return;
      const reader = res.body.getReader();
      const dec = new Pcm16Decoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const samples = dec.push(value);
          if (samples.length) yield samples;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export type SttEvent =
  | { type: 'started' }
  | { type: 'partial'; text: string }
  | { type: 'committed'; text: string }
  | { type: 'error'; code: string; error: VoiceError; retry: boolean }
  | { type: 'ignore' };

const RATE_CODES = new Set(['rate_limited', 'commit_throttled', 'queue_overflow', 'resource_exhausted']);
const INPUT_CODES = new Set(['input_error', 'invalid_request', 'chunk_size_exceeded']);

/** Parses one server message of the realtime transcription socket. */
export function parseSttMessage(raw: string): SttEvent {
  let m: { message_type?: unknown; text?: unknown; error?: unknown };
  try {
    m = JSON.parse(raw) as typeof m;
  } catch {
    return { type: 'ignore' };
  }
  if (!m || typeof m !== 'object') return { type: 'ignore' };
  const t = typeof m.message_type === 'string' ? m.message_type : '';
  const text = typeof m.text === 'string' ? m.text : '';
  const detail = typeof m.error === 'string' ? m.error : '';
  switch (t) {
    case 'session_started':
      return { type: 'started' };
    case 'partial_transcript':
      return { type: 'partial', text };
    case 'committed_transcript':
      return { type: 'committed', text };
    case 'auth_error':
      return { type: 'error', code: t, error: new VoiceError(MSG.auth, 'auth'), retry: false };
    case 'unaccepted_terms':
      return { type: 'error', code: t, error: new VoiceError('Accept the speech-to-text terms in your ElevenLabs account first.', 'auth'), retry: false };
    case 'quota_exceeded':
      return { type: 'error', code: t, error: new VoiceError(MSG.quota, 'quota'), retry: false };
    case 'session_time_limit_exceeded':
      return { type: 'error', code: t, error: new VoiceError('The listening session reached its time limit.', 'closed'), retry: true };
    case 'insufficient_audio_activity':
      return { type: 'error', code: t, error: new VoiceError('Stopped listening: no speech was heard for a while.', 'closed'), retry: true };
    case 'error':
    case 'transcriber_error':
      return { type: 'error', code: t, error: new VoiceError(`Transcription failed${detail ? `: ${detail}` : '.'}`, 'other'), retry: false };
  }
  if (RATE_CODES.has(t)) return { type: 'error', code: t, error: new VoiceError(MSG.rate, 'rate'), retry: false };
  if (INPUT_CODES.has(t)) return { type: 'error', code: t, error: new VoiceError(`ElevenLabs could not use the microphone audio${detail ? `: ${detail}` : '.'}`, 'input'), retry: false };
  return { type: 'ignore' }; // warnings, timestamps/entity variants, future message types
}

/** Builds the socket URL (the token goes in the query; browsers cannot set WebSocket headers). */
export function sttUrl(token: string, model: string, o: SttOpenOptions): string {
  const q = new URLSearchParams({ token, model_id: model, audio_format: `pcm_${o.sampleRate}`, commit_strategy: o.vad ? 'vad' : 'manual' });
  if (o.vad) {
    q.set('vad_silence_threshold_secs', '1.2');
    q.set('filter_background_audio', 'true');
  }
  if (o.language) q.set('language_code', o.language);
  return `${ELEVEN_WS}?${q}`;
}

class ElevenSttSession implements SttSession {
  private queue: string[] = [];
  private ready = false;
  private ended = false;
  private failed = false;
  private byUs = false;

  constructor(
    private ws: WebSocket,
    private rate: number,
    private h: SttHandlers,
  ) {
    ws.onmessage = (e) => this.message(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => this.end();
    ws.onerror = () => {
      /* followed by close */
    };
  }

  private message(raw: string) {
    const ev = parseSttMessage(raw);
    if (ev.type === 'started') {
      this.ready = true;
      for (const m of this.queue) this.ws.send(m);
      this.queue = [];
    } else if (ev.type === 'partial') this.h.onPartial(ev.text);
    else if (ev.type === 'committed') this.h.onCommitted(ev.text);
    else if (ev.type === 'error') {
      this.failed = true;
      this.h.onError(ev.error);
      this.close();
    }
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    if (!this.byUs && !this.failed) this.h.onError(new VoiceError('The voice connection closed.', 'closed'));
    this.h.onClose();
  }

  private chunk(pcm: Int16Array, commit: boolean) {
    if (this.ended || this.byUs) return;
    const msg = JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: int16ToBase64(pcm), commit, sample_rate: this.rate });
    if (this.ready && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
    else if (this.queue.length < 600) this.queue.push(msg); // about a minute of 100 ms chunks
  }

  send(pcm: Int16Array) {
    if (pcm.length) this.chunk(pcm, false);
  }

  commit(last?: Int16Array) {
    // A commit always rides on a chunk; 10 ms of silence when there is nothing left to send.
    this.chunk(last?.length ? last : new Int16Array(Math.round(this.rate / 100)), true);
  }

  close() {
    if (this.byUs) return;
    this.byUs = true;
    try {
      this.ws.close(1000);
    } catch {
      /* already closing */
    }
    if (this.ws.readyState === WebSocket.CLOSED) this.end();
  }
}

export function elevenStt(cfg: VoiceConfig): SttEngine {
  return {
    async open(o, h) {
      // Single-use, consumed on connect, expires after 15 minutes: one per session.
      const { token } = await call<{ token: string }>(cfg.apiKey, '/v1/single-use-token/realtime_scribe', { method: 'POST' });
      if (!token) throw new VoiceError('ElevenLabs did not return a transcription token.', 'other');
      return new ElevenSttSession(new WebSocket(sttUrl(token, cfg.sttModel || DEFAULT_STT_MODEL, o)), o.sampleRate, h);
    },
  };
}
