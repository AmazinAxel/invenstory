// Voice mode: a wrapper around the existing chat agent. Speech becomes an ordinary chat.send()
// (with the hidden voice hint), and the streamed reply is spoken sentence by sentence. The agent,
// tools, safety gate and persistence are untouched. Invisible unless a voice key is saved here.
//
// Push-to-talk: one transcription session per press, committed by hand on release.
// Hands-free: one long session with VAD commits; half-duplex (mic audio is replaced by silence
// while the reply plays, so it never transcribes itself), listening resumes shortly after.

import { kv, K } from '../lib/kv.ts';
import { createLlm } from '../lib/llm/index.ts';
import { textOf, type LlmConfig } from '../lib/llm/types.ts';
import { QUICK_SYSTEM, quickPrompt } from '../lib/voice/quick.ts';
import { createEngines } from '../lib/voice/index.ts';
import { createCaptureContext, startMic, STT_RATE, type Mic } from '../lib/voice/capture.ts';
import { WebAudioSink } from '../lib/voice/player.ts';
import { Speaker } from '../lib/voice/speaker.ts';
import { ProgressThrottle } from '../lib/voice/progress.ts';
import { cleanTranscript, isStopCommand, SentenceChunker } from '../lib/voice/text.ts';
import { VoiceError, type SttHandlers, type SttSession, type VoiceConfig } from '../lib/voice/types.ts';
import { app } from './app.svelte.ts';
import { chat, snapshot } from './chat.svelte.ts';
import { isHiddenText } from './chat-history.ts';
import { dashboard } from './dashboard.svelte.ts';

export type VoicePhase = 'off' | 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

/** A press shorter than this is a tap (click-to-start / click-to-stop) rather than hold-to-talk. */
const HOLD_MS = 350;
/** How long to wait for the final transcript after releasing the mic. */
const COMMIT_WAIT_MS = 4000;
/** Hands-free: pause after the reply's audio ends before mic audio flows again (echo tail). */
const RESUME_MS = 450;
/** Hands-free: reconnects in a row after a session ends by itself (time limit, silence, drop). */
const MAX_RECONNECTS = 3;
/** Audio kept while the socket is (re)connecting: 5 s of 100 ms chunks. */
const MAX_PRE = 50;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SETUP_FLAG = 'invenstory.voice';

/**
 * Ordinary users are never asked for an ElevenLabs key: the Settings card that takes one only
 * shows on a device that opened the app once with `?voice` in the address (remembered here).
 */
function setupRevealed(): boolean {
  try {
    if (new URLSearchParams(location.search).has('voice')) localStorage.setItem(SETUP_FLAG, '1');
    return localStorage.getItem(SETUP_FLAG) === '1';
  } catch {
    return false; // no window, or storage unavailable
  }
}

class Voice {
  /** This device may set up voice (see setupRevealed). */
  readonly setup = setupRevealed();
  config = $state<VoiceConfig | null>(null);
  /** Hands-free mode is on (mic stays open; ElevenLabs VAD decides when a turn ends). */
  handsFree = $state(false);
  /** Mic open and audio flowing to transcription (or about to). */
  listening = $state(false);
  connecting = $state(false);
  speaking = $state(false);
  /** Live transcript of the current utterance. */
  partial = $state('');
  error = $state<string | null>(null);
  /** A spoken turn's agent run is in progress. */
  waiting = $state(false);
  /** Ephemeral answer to a question spoken during a run (never saved, never in the history). */
  quick = $state<{ question: string; answer: string; pending: boolean; error?: string } | null>(null);

  readonly enabled = $derived(!!(this.config?.apiKey && this.config.voiceId));
  readonly phase: VoicePhase = $derived(
    !this.enabled
      ? 'off'
      : this.speaking
        ? 'speaking'
        : this.connecting
          ? 'connecting'
          : this.listening && !(this.handsFree && this.waiting)
            ? 'listening'
            : this.waiting
              ? 'thinking'
              : 'idle',
  );

  private sink: WebAudioSink | null = null;
  private speaker: Speaker | null = null;
  private speakerFor: VoiceConfig | null = null;
  private mic: Mic | null = null;
  private stt: SttSession | null = null;
  private pre: Int16Array[] = [];
  private session = 0; // generation of the current listening session
  private starting: Promise<boolean> | null = null;
  private committed: string[] = [];
  private onCommit: (() => void) | null = null;
  private reconnects = 0;

  // Half-duplex gate (hands-free): while true, silence is sent instead of mic audio.
  private gated = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  private chunker = new SentenceChunker();
  private progress = new ProgressThrottle();
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private voiceRun = false; // the running chat turn was spoken
  private muted = false; // the user stopped the audio of this run
  private quickCtl: AbortController | null = null;

  // Press state for the mic button.
  private pressAt = 0;
  private pressOpened = false;
  private latched = false;

  constructor() {
    void kv
      .get<VoiceConfig>(K.voice)
      .then((c) => (this.config = c ?? null))
      .catch(() => {});
    // Never keep the mic open in the background.
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && this.listening) {
          this.handsFree = false;
          this.closeListening();
        }
      });
    chat.listen({
      onStart: ({ voice }) => {
        this.voiceRun = voice;
        this.muted = false;
        this.chunker.reset();
        this.progress.reset();
        this.waiting = voice;
        this.dismissQuick();
        if (voice) this.progressTimer ??= setInterval(() => this.tickProgress(), 1000);
      },
      onText: (d) => {
        if (!this.voiceRun || this.muted) return;
        this.progress.clear(); // the model is talking again: its words beat a stale tool label
        for (const s of this.chunker.push(d)) this.say(s);
      },
      onToolStart: (label) => {
        if (!this.voiceRun || this.muted) return;
        for (const s of this.chunker.flush()) this.say(s);
        this.progress.offer(label);
        this.tickProgress();
      },
      onEnd: (end) => {
        if (this.progressTimer) clearInterval(this.progressTimer);
        this.progressTimer = null;
        this.progress.clear();
        if (!this.voiceRun) return;
        this.voiceRun = false;
        this.waiting = false;
        if (end === 'aborted') return this.stopAudio();
        if (this.muted) return;
        for (const s of this.chunker.flush()) this.say(s);
        if (end === 'error') this.say('Something went wrong. The details are on screen.');
      },
    });
  }

  // ---- settings ----

  async save(cfg: VoiceConfig) {
    await kv.set(K.voice, cfg);
    this.config = cfg;
  }

  async remove() {
    this.off();
    await kv.del(K.voice);
    this.config = null;
  }

  /** Stops everything voice does. */
  off() {
    this.handsFree = false;
    this.closeListening();
    this.stopAudio();
    this.error = null;
  }

  // ---- audio out ----

  /** Creates/resumes the output context. Must run synchronously inside a user gesture. */
  private prime() {
    const cfg = this.config ? ($state.snapshot(this.config) as VoiceConfig) : null;
    if (!cfg) return;
    if (!this.sink || this.sink.ctx.state === 'closed') this.sink = new WebAudioSink();
    else this.sink.unlock();
    if (!this.speaker || this.speakerFor !== this.config) {
      this.speaker?.stop();
      this.speakerFor = this.config;
      this.speaker = new Speaker(createEngines(cfg).tts, this.sink, {
        onBusy: (b) => this.busyChanged(b),
        onError: (e) => (this.error = message(e)),
      });
    }
  }

  private busyChanged(busy: boolean) {
    this.speaking = busy;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (busy) {
      this.gated = true;
      this.partial = '';
    } else {
      this.tickProgress();
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        this.gated = false;
      }, RESUME_MS);
    }
  }

  /** Says the latest tool progress line if the throttle allows and nobody is talking. */
  private tickProgress() {
    if (!this.voiceRun || this.muted || !this.speaker) return;
    const line = this.progress.take(Date.now(), this.speaker.busy || !!this.partial);
    if (line) this.say(line);
  }

  private say(text: string) {
    this.speaker?.say(text);
  }

  /** The visible Stop control: silence now, and stay quiet for the rest of this reply. */
  stopAudio() {
    this.speaker?.stop();
    if (this.voiceRun) this.muted = true;
  }

  /** Stop audio and the agent run (hands-free tap, spoken "stop"). */
  interrupt() {
    this.stopAudio();
    this.dismissQuick();
    if (chat.running) chat.stop();
  }

  /** Speaks a sample with the saved voice (Settings → Test voice). Call from a click. */
  test(text = 'Hi! This is the voice Invenstory will use to answer you.') {
    this.error = null;
    this.prime();
    this.speaker?.stop();
    this.say(text);
  }

  // ---- audio in ----

  private onAudio(gen: number, pcm: Int16Array) {
    if (gen !== this.session) return;
    // Half-duplex: keep the socket fed (so it does not time out) but never with the reply's audio.
    const data = this.handsFree && this.gated ? new Int16Array(pcm.length) : pcm;
    if (this.stt) this.stt.send(data);
    else if (this.pre.push(data) > MAX_PRE) this.pre.shift();
  }

  private sttHandlers(gen: number, vad: boolean, self: () => SttSession | null): SttHandlers {
    const live = () => gen === this.session;
    return {
      onPartial: (t) => {
        if (live() && !(vad && this.gated)) this.partial = t;
      },
      onCommitted: (t) => {
        if (!live()) return;
        this.partial = '';
        this.reconnects = 0;
        if (vad) {
          if (!this.gated) this.utter(t);
          return;
        }
        if (t.trim()) this.committed.push(t.trim());
        this.onCommit?.();
      },
      onError: (e) => {
        if (!live()) return;
        if (vad && e.kind === 'closed' && this.reconnects < MAX_RECONNECTS) {
          this.reconnects++;
          this.stt = null;
          this.connect(gen, vad).catch((err: unknown) => live() && this.fail(err));
        } else this.fail(e);
      },
      onClose: () => {
        if (live() && this.stt === self()) this.stt = null;
      },
    };
  }

  /** Opens a transcription session for listening session `gen` and flushes buffered audio. */
  private async connect(gen: number, vad: boolean): Promise<SttSession> {
    const cfg = $state.snapshot(this.config) as VoiceConfig;
    let me: SttSession | null = null;
    me = await createEngines(cfg).stt.open({ sampleRate: STT_RATE, vad }, this.sttHandlers(gen, vad, () => me));
    if (gen !== this.session) {
      me.close();
      return me;
    }
    this.stt = me;
    for (const p of this.pre) me.send(p);
    this.pre = [];
    return me;
  }

  /** Opens mic + transcription. Synchronous part first (contexts must be created in the tap). */
  private openListening(vad: boolean): Promise<boolean> {
    if (!this.config) return Promise.resolve(false);
    this.prime();
    const gen = ++this.session;
    const ctx = createCaptureContext();
    this.error = null;
    this.partial = '';
    this.committed = [];
    this.pre = [];
    this.reconnects = 0;
    this.listening = true;
    this.connecting = true;
    const live = () => gen === this.session;

    const micP = startMic(
      ctx,
      (pcm) => this.onAudio(gen, pcm),
      () => live() && this.fail(new VoiceError('The microphone stopped.', 'mic')),
    );
    const sttP = this.connect(gen, vad);

    this.starting = Promise.allSettled([micP, sttP]).then(([m, s]) => {
      if (m.status === 'fulfilled' && (!live() || s.status === 'rejected')) void m.value.stop();
      if (s.status === 'fulfilled' && m.status === 'rejected') s.value.close();
      if (!live()) return false;
      if (m.status === 'rejected' || s.status === 'rejected') {
        this.fail(m.status === 'rejected' ? m.reason : (s as PromiseRejectedResult).reason);
        return false;
      }
      this.mic = m.value;
      this.connecting = false;
      return true;
    });
    return this.starting;
  }

  /** Push-to-talk: ends the utterance (manual commit), waits for the final text, closes. */
  private async finishListening(): Promise<string> {
    const ok = await this.starting;
    const gen = this.session;
    if (!ok) return '';
    if (!this.stt) {
      // The socket closed early (its error is already shown): keep what was heard.
      const heard = [...this.committed, this.partial].join(' ');
      this.closeListening();
      return heard;
    }
    const last = this.mic ? await this.mic.stop() : undefined;
    this.mic = null;
    const before = this.committed.length;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, COMMIT_WAIT_MS);
      this.onCommit = () => {
        clearTimeout(timer);
        resolve();
      };
      this.stt?.commit(last);
    });
    this.onCommit = null;
    if (gen !== this.session) return '';
    const text = [...this.committed, ...(this.committed.length === before && this.partial ? [this.partial] : [])].join(' ');
    this.closeListening();
    return text;
  }

  /** Closes mic and socket without sending anything. */
  private closeListening() {
    this.session++;
    this.onCommit = null;
    void this.mic?.stop();
    this.mic = null;
    this.stt?.close();
    this.stt = null;
    this.pre = [];
    this.listening = false;
    this.connecting = false;
    this.partial = '';
    this.latched = false;
  }

  private fail(e: unknown) {
    this.error = message(e);
    this.handsFree = false;
    this.closeListening();
  }

  /** A finished utterance: an ordinary chat message (or a local stop command). */
  private utter(raw: string) {
    const text = cleanTranscript(raw);
    if (!text) return;
    if (isStopCommand(text)) return this.interrupt();
    if (chat.running) return void this.quickAnswer(text); // chat.send would return early
    this.error = null;
    void chat.send(text, { voice: true });
  }

  private async release() {
    const text = await this.finishListening();
    this.utter(text);
  }

  // ---- side lane ----

  /**
   * One tool-less LLM call about a question asked while the agent runs. Spoken and shown as an
   * ephemeral "quick answer"; not persisted to n8n and not added to chat.messages.
   */
  private async quickAnswer(question: string) {
    const cfg = app.llm ? ($state.snapshot(app.llm) as LlmConfig) : null;
    if (!cfg) return;
    this.quickCtl?.abort();
    const ctl = new AbortController();
    this.quickCtl = ctl;
    this.quick = { question, answer: '', pending: true };
    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && !isHiddenText(p.text)));
    const prompt = quickPrompt({
      question,
      lastRequest: lastUser ? textOf(lastUser.parts.filter((p) => p.type !== 'text' || !isHiddenText(p.text))) : undefined,
      tools: Object.values(chat.tools).map((t) => ({ label: t.label, status: t.status })),
      snapshot: snapshot(dashboard.data),
    });
    const chunker = new SentenceChunker();
    let streamed = '';
    try {
      const res = await createLlm(cfg).turn(
        {
          system: QUICK_SYSTEM,
          messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
          maxTokens: 2000,
          effort: cfg.protocol === 'anthropic' ? 'low' : undefined,
          signal: ctl.signal,
        },
        (e) => {
          if (e.type !== 'text' || ctl.signal.aborted) return;
          streamed += e.text;
          this.quick = { question, answer: streamed, pending: true };
          for (const s of chunker.push(e.text)) this.say(s);
        },
      );
      if (ctl.signal.aborted) return;
      const answer = textOf(res.parts).trim() || streamed.trim();
      if (!streamed) for (const s of chunker.push(answer)) this.say(s);
      for (const s of chunker.flush()) this.say(s);
      this.quick = { question, answer: answer || 'No answer.', pending: false };
    } catch (e) {
      if (!ctl.signal.aborted) this.quick = { question, answer: '', pending: false, error: `Quick answer failed: ${message(e)}` };
    } finally {
      if (this.quickCtl === ctl) this.quickCtl = null;
    }
  }

  dismissQuick() {
    this.quickCtl?.abort();
    this.quickCtl = null;
    this.quick = null;
  }

  // ---- hands-free ----

  /** The hands-free toggle (a click, so the audio contexts can start). */
  setHandsFree(on: boolean) {
    if (on === this.handsFree) return;
    this.closeListening();
    this.handsFree = on;
    if (on) {
      this.gated = this.speaking;
      void this.openListening(true);
    }
  }

  /** Mic tap in hands-free: interrupt the reply/run, or turn hands-free off when just listening. */
  private handsTap() {
    if (this.speaking || this.waiting || (this.voiceRun && chat.running)) this.interrupt();
    else this.setHandsFree(false);
  }

  // ---- mic button ----

  /** pointerdown. Hold to talk; a short tap latches the mic open until the next tap. */
  press() {
    this.pressAt = Date.now();
    this.pressOpened = false;
    if (this.handsFree) return this.handsTap();
    if (this.speaking) return this.stopAudio();
    if (this.listening) {
      if (this.latched) void this.release();
      return;
    }
    this.pressOpened = true;
    this.latched = false;
    void this.openListening(false);
  }

  /** pointerup. */
  unpress() {
    if (!this.pressOpened) return;
    this.pressOpened = false;
    if (Date.now() - this.pressAt < HOLD_MS) this.latched = true;
    else void this.release();
  }

  /** pointercancel (the page scrolled, the finger left): drop the utterance unless latched. */
  cancelPress() {
    if (this.pressOpened && !this.latched) this.closeListening();
    this.pressOpened = false;
  }

  /** Keyboard / assistive click: start, stop-and-send, or stop the audio. */
  toggle() {
    if (this.handsFree) return this.handsTap();
    if (this.speaking) return this.stopAudio();
    if (this.listening) return void this.release();
    this.latched = true;
    void this.openListening(false);
  }
}

export const voice = new Voice();
