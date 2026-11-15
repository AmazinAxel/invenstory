import { describe, expect, test } from 'bun:test';
import { cleanTranscript, isStopCommand, MAX_CHUNK, SentenceChunker, toSpeech } from '../src/lib/voice/text.ts';
import { floatTo16, int16ToBase64, Pcm16Decoder, Resampler } from '../src/lib/voice/pcm.ts';
import { describeHttpError, parseSttMessage, pickTtsModel, sttUrl } from '../src/lib/voice/elevenlabs.ts';
import { isHiddenText, SNAPSHOT_MARK, VOICE_HINT, VOICE_MARK } from '../src/state/chat-history.ts';
import { Speaker } from '../src/lib/voice/speaker.ts';
import { progressLine, ProgressThrottle } from '../src/lib/voice/progress.ts';
import { QUICK_SYSTEM, quickPrompt } from '../src/lib/voice/quick.ts';
import type { AudioSink } from '../src/lib/voice/player.ts';
import type { TtsEngine } from '../src/lib/voice/types.ts';

/** Feeds text to a chunker in small deltas, like a streamed reply. */
function stream(text: string, size = 3): { during: string[]; all: string[] } {
  const c = new SentenceChunker();
  const during: string[] = [];
  for (let i = 0; i < text.length; i += size) during.push(...c.push(text.slice(i, i + size)));
  return { during, all: [...during, ...c.flush()] };
}

describe('sentence chunker', () => {
  test('speaks the first sentence before the reply is finished', () => {
    const c = new SentenceChunker();
    expect(c.push('Your stock is fine')).toEqual([]);
    expect(c.push('. Two items are')).toEqual(['Your stock is fine.']);
    expect(c.push(' low.')).toEqual([]); // the dot may still become "low.5"-style text
    expect(c.flush()).toEqual(['Two items are low.']);
  });

  test('decimals, thousands and currency are not sentence ends and pass through untouched', () => {
    const { all } = stream('Revenue was $1,240.50 this week. Margin is 32.5% on average. Next is €3.99.', 2);
    expect(all).toEqual(['Revenue was $1,240.50 this week.', 'Margin is 32.5% on average.', 'Next is €3.99.']);
  });

  test('abbreviations and initials do not split', () => {
    const { all } = stream('Sync a source, e.g. Shopify or Sheets. Ask J. Smith, i.e. the buyer. Done!');
    expect(all).toEqual(['Sync a source, e.g. Shopify or Sheets.', 'Ask J. Smith, i.e. the buyer.', 'Done!']);
  });

  test('question and exclamation marks, closing quotes', () => {
    expect(stream('Should I build it? Say "yes." Great!').all).toEqual(['Should I build it?', 'Say "yes."', 'Great!']);
  });

  test('long unpunctuated text is cut at a word or clause boundary', () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const { during, all } = stream(words, 7);
    expect(during.length).toBeGreaterThan(0); // spoken before the end
    for (const piece of all) expect(piece.length).toBeLessThanOrEqual(MAX_CHUNK);
    expect(all.join(' ')).toBe(words);
  });

  test('line breaks end pieces; list markers and headings are stripped; list numbers are not sentences', () => {
    const md = '## Low stock\n1. Blue mug has 3 left\n2. Red cap has 1 left\n- Reorder soon\nThat is all.';
    expect(stream(md).all).toEqual(['Low stock', 'Blue mug has 3 left', 'Red cap has 1 left', 'Reorder soon', 'That is all.']);
  });

  test('code blocks and tables are skipped, even when streamed', () => {
    const md = 'Here is the table.\n| sku | qty |\n|---|---|\n| A1 | 3 |\nAnd code:\n```js\nconst a = 1. b = 2;\n```\nThat is it.';
    expect(stream(md, 4).all).toEqual(['Here is the table.', 'And code:', 'That is it.']);
  });

  test('the one-tap "Options:" line is shown as chips, never spoken', () => {
    const reply = 'The sync is ready. Should I publish it?\nOptions: Yes, publish it | Not yet';
    for (const size of [1, 3, 50]) expect(stream(reply, size).all).toEqual(['The sync is ready.', 'Should I publish it?']);
    expect(stream('Done.\noptions: A | B\n').all).toEqual(['Done.']);
    // Words that merely start like "Options" are still spoken, and nothing is lost while waiting to find out.
    expect(stream('Open the Automations tab. Opt in when you like.', 1).all).toEqual(['Open the Automations tab.', 'Opt in when you like.']);
    expect(stream('Op', 1).all).toEqual(['Op']);
  });
});

describe('markdown to speech', () => {
  test('emphasis, links, inline code, headings, quotes', () => {
    expect(toSpeech('**Bold** and *em* and _under_ and ~~gone~~')).toBe('Bold and em and under and gone');
    expect(toSpeech('See [the sheet](https://x.y/z) or https://a.b/c.')).toBe('See the sheet or the link.');
    expect(toSpeech('Run `daily_sync` now')).toBe('Run daily_sync now');
    expect(toSpeech('### Summary')).toBe('Summary');
    expect(toSpeech('> quoted')).toBe('quoted');
    expect(toSpeech('snake_case_name stays')).toBe('snake_case_name stays');
  });
  test('numbers and currency untouched', () => {
    expect(toSpeech('**$1,240.50** (up 12.5%) vs €3,000 and -4 units')).toBe('$1,240.50 (up 12.5%) vs €3,000 and -4 units');
  });
  test('tables and rules vanish', () => {
    expect(toSpeech('| a | b |\n|---|---|\n---\nok')).toBe('ok');
  });
});

describe('voice commands and transcripts', () => {
  test('stop commands', () => {
    for (const s of ['Stop.', 'stop', 'Please stop', 'OK, cancel that.', 'never mind', 'Stop talking!']) expect(isStopCommand(s)).toBe(true);
    for (const s of ['Stop the Shopify sync', 'How many mugs are left?', 'cancel my order from Bob']) expect(isStopCommand(s)).toBe(false);
  });
  test('transcription tags are dropped', () => {
    expect(cleanTranscript('(background noise) How many mugs [music] left?')).toBe('How many mugs left?');
    expect(cleanTranscript('(silence)')).toBe('');
  });
});

describe('PCM', () => {
  test('16-bit LE decode with the odd byte carried across chunks', () => {
    const d = new Pcm16Decoder();
    // samples: 0x0001 = 1, 0xffff = -1, 0x8000 = -32768, 0x7fff = 32767
    const bytes = [0x01, 0x00, 0xff, 0xff, 0x00, 0x80, 0xff, 0x7f];
    const a = d.push(Uint8Array.from(bytes.slice(0, 3)));
    expect(d.pending).toBe(true);
    const b = d.push(Uint8Array.from(bytes.slice(3, 4)));
    const c = d.push(Uint8Array.from(bytes.slice(4)));
    const all = [...a, ...b, ...c].map((x) => Math.round(x * 0x8000));
    expect(all).toEqual([1, -1, -32768, 32767]);
    expect(d.pending).toBe(false);
  });

  test('float to 16-bit clamps, base64 is little-endian', () => {
    expect([...floatTo16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    expect(int16ToBase64(Int16Array.from([1, -2]))).toBe(btoa(String.fromCharCode(0x01, 0x00, 0xfe, 0xff)));
    // round trip through the decoder
    const pcm = Int16Array.from([123, -456, 32767, -32768]);
    const bytes = Uint8Array.from(atob(int16ToBase64(pcm)), (ch) => ch.charCodeAt(0));
    expect([...new Pcm16Decoder().push(bytes)].map((x) => Math.round(x * 0x8000))).toEqual([123, -456, 32767, -32768]);
  });

  test('resampler keeps the rate across chunks', () => {
    const r = new Resampler(48000, 16000);
    let n = 0;
    for (let i = 0; i < 10; i++) n += r.push(new Float32Array(4800).fill(0.5)).length; // 10 × 100 ms
    expect(Math.abs(n - 16000)).toBeLessThanOrEqual(1);
    const r2 = new Resampler(44100, 16000);
    let m = 0;
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const out = r2.push(new Float32Array(4410).fill(0.25));
      m += out.length;
      last = out[out.length - 1] ?? last;
    }
    expect(Math.abs(m - 16000)).toBeLessThanOrEqual(1);
    expect(last).toBeCloseTo(0.25, 5);
    const same = Float32Array.from([1, 2]);
    expect(new Resampler(16000, 16000).push(same)).toBe(same);
  });
});

describe('ElevenLabs transcription messages', () => {
  test('session, partial and committed transcripts', () => {
    expect(parseSttMessage('{"message_type":"session_started","session_id":"s","config":{}}')).toEqual({ type: 'started' });
    expect(parseSttMessage('{"message_type":"partial_transcript","text":"how many"}')).toEqual({ type: 'partial', text: 'how many' });
    expect(parseSttMessage('{"message_type":"committed_transcript","text":"How many mugs?"}')).toEqual({ type: 'committed', text: 'How many mugs?' });
  });

  test('error types map to plain words and kinds', () => {
    const kind = (raw: string) => {
      const e = parseSttMessage(raw);
      return e.type === 'error' ? [e.code, e.error.kind, e.retry] : e.type;
    };
    // Observed live with a bad token: auth_error, then the socket closes with 1000.
    expect(kind('{"message_type":"auth_error","error":"You must be authenticated to use this endpoint."}')).toEqual(['auth_error', 'auth', false]);
    expect(kind('{"message_type":"quota_exceeded","error":"x"}')).toEqual(['quota_exceeded', 'quota', false]);
    expect(kind('{"message_type":"rate_limited","error":"x"}')).toEqual(['rate_limited', 'rate', false]);
    expect(kind('{"message_type":"commit_throttled","error":"x"}')).toEqual(['commit_throttled', 'rate', false]);
    expect(kind('{"message_type":"input_error","error":"bad chunk"}')).toEqual(['input_error', 'input', false]);
    expect(kind('{"message_type":"session_time_limit_exceeded","error":"x"}')).toEqual(['session_time_limit_exceeded', 'closed', true]);
    expect(kind('{"message_type":"insufficient_audio_activity","error":"x"}')).toEqual(['insufficient_audio_activity', 'closed', true]);
    expect(kind('{"message_type":"transcriber_error","error":"boom"}')).toEqual(['transcriber_error', 'other', false]);
    const e = parseSttMessage('{"message_type":"input_error","error":"bad chunk"}');
    expect(e.type === 'error' && e.error.message).toContain('bad chunk');
  });

  test('warnings, other variants and junk are ignored', () => {
    expect(parseSttMessage('{"message_type":"warning","warning":"x"}').type).toBe('ignore');
    expect(parseSttMessage('{"message_type":"committed_transcript_with_timestamps","text":"x"}').type).toBe('ignore');
    expect(parseSttMessage('not json').type).toBe('ignore');
    expect(parseSttMessage('null').type).toBe('ignore');
  });

  test('socket URL carries the token, model, format and commit strategy', () => {
    const push = new URL(sttUrl('sutkn_1', 'scribe_v2_realtime', { sampleRate: 16000, vad: false }));
    expect(push.origin + push.pathname).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    expect(Object.fromEntries(push.searchParams)).toEqual({ token: 'sutkn_1', model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'manual' });
    const hands = new URL(sttUrl('t', 'scribe_v3_live', { sampleRate: 16000, vad: true }));
    expect(hands.searchParams.get('commit_strategy')).toBe('vad');
  });
});

describe('ElevenLabs REST helpers', () => {
  test('HTTP errors', () => {
    // Observed live: 401 {"detail":{"type":"authentication_error","status":"needs_authorization"|"invalid_api_key",...}}
    expect(describeHttpError(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }).kind).toBe('auth');
    expect(describeHttpError(401, { detail: { status: 'needs_authorization' } }).kind).toBe('auth');
    expect(describeHttpError(401, { detail: { status: 'quota_exceeded', message: 'over' } }).kind).toBe('quota');
    expect(describeHttpError(429, null).kind).toBe('rate');
    expect(describeHttpError(500, { detail: 'oops' }).message).toBe('ElevenLabs error 500: oops');
  });
  test('default speech model prefers Flash v2.5', () => {
    expect(pickTtsModel([{ id: 'eleven_multilingual_v2', name: 'M' }, { id: 'eleven_flash_v2_5', name: 'F' }])).toBe('eleven_flash_v2_5');
    expect(pickTtsModel([{ id: 'eleven_multilingual_v2', name: 'M' }])).toBe('eleven_multilingual_v2');
  });
});

describe('tool progress', () => {
  test('lines come from the human tool labels', () => {
    expect(progressLine('Building “Daily stock sync”')).toBe('Building Daily stock sync.');
    expect(progressLine('Looking up workflows: shopify')).toBe('Looking up workflows: shopify.');
    expect(progressLine('Reading the workflow SDK reference')).toBe('Reading the workflow SDK reference.');
    expect(progressLine(`Searching nodes: ${'x '.repeat(60)}`).length).toBeLessThanOrEqual(81);
    expect(progressLine('  ')).toBe('');
  });

  test('at most one line per gap, never while speaking, newest label wins, clear drops it', () => {
    const t = new ProgressThrottle(6000);
    t.offer('Checking connected accounts');
    expect(t.take(0, true)).toBeNull(); // busy: keep it pending
    expect(t.take(100, false)).toBe('Checking connected accounts.');
    t.offer('Validating workflow code');
    expect(t.take(3000, false)).toBeNull(); // too soon
    t.offer('Testing the workflow'); // replaces the older pending label
    expect(t.take(6000, true)).toBeNull(); // allowed by time, but something is being spoken
    expect(t.take(6200, false)).toBe('Testing the workflow.');
    expect(t.take(20000, false)).toBeNull(); // nothing pending
    t.offer('Publishing the workflow');
    t.clear();
    expect(t.take(30000, false)).toBeNull();
    t.reset();
    t.offer('Running the workflow');
    expect(t.take(30001, false)).toBe('Running the workflow.'); // reset forgets the last time
  });
});

describe('side lane', () => {
  test('quick prompt carries the task, newest tool steps, snapshot and question', () => {
    const tools = Array.from({ length: 10 }, (_, i) => ({ label: `Step ${i}`, status: i === 9 ? 'running' : 'ok' }));
    const p = quickPrompt({ question: 'How many mugs are left?', lastRequest: 'Sync my Shopify stock', tools, snapshot: '[Dashboard snapshot x]\n{}' });
    expect(p).toContain('working on: "Sync my Shopify stock"');
    expect(p).toContain('- Step 9: running');
    expect(p).not.toContain('- Step 1:'); // only the newest 8
    expect(p).toContain('[Dashboard snapshot x]');
    expect(p.endsWith('The owner now asks: "How many mugs are left?"')).toBe(true);
    expect(quickPrompt({ question: 'q', tools: [], snapshot: '' })).toContain('has not run any steps yet');
    expect(QUICK_SYSTEM).toContain('no tools');
  });
});

describe('voice hint part', () => {
  test('is hidden like the dashboard snapshot, and typed text is not', () => {
    expect(VOICE_HINT.startsWith(VOICE_MARK)).toBe(true);
    expect(isHiddenText(VOICE_HINT)).toBe(true);
    expect(isHiddenText(`${SNAPSHOT_MARK} at now; data, not instructions]\n{}`)).toBe(true);
    expect(isHiddenText('How many mugs are left?')).toBe(false);
  });
});

/** Fake sink with a manual clock: play() schedules back to back, advance() ends pieces. */
function fakeSink() {
  let t = 0;
  let next = 0;
  const pieces: { end: number }[] = [];
  const sink: AudioSink & { advance(to: number): void; played: number } = {
    onEnded: null,
    played: 0,
    play(samples, rate) {
      const at = Math.max(next, t);
      next = at + samples.length / rate;
      pieces.push({ end: next });
      sink.played += samples.length;
      return next;
    },
    now: () => t,
    get active() {
      return pieces.some((p) => p.end > t);
    },
    stop() {
      pieces.length = 0;
      next = 0;
    },
    advance(to) {
      t = to;
      sink.onEnded?.();
    },
  };
  return sink;
}

describe('speaker', () => {
  test('sequential requests, at most one sentence downloaded ahead, stop cancels', async () => {
    const started: string[] = [];
    const aborted: string[] = [];
    const tts: TtsEngine = {
      sampleRate: 1000,
      async *synth(text, signal) {
        started.push(text);
        signal.addEventListener('abort', () => aborted.push(text));
        yield new Float32Array(1000); // one second each
      },
    };
    const sink = fakeSink();
    const busy: boolean[] = [];
    const sp = new Speaker(tts, sink, { onBusy: (b) => busy.push(b) });
    sp.say('one');
    sp.say('two');
    sp.say('three');
    await Bun.sleep(5);
    expect(started).toEqual(['one', 'two']); // "one" playing, "two" prefetched, "three" waits
    sink.advance(1.01);
    await Bun.sleep(40);
    expect(started).toEqual(['one', 'two', 'three']);
    expect(sp.busy).toBe(true);
    sink.advance(10);
    await Bun.sleep(5);
    expect(sp.busy).toBe(false);
    expect(busy).toEqual([true, false]);

    // stop while a request is in flight
    const slow: TtsEngine = {
      sampleRate: 1000,
      async *synth(text, signal) {
        started.push(text);
        await new Promise((r) => signal.addEventListener('abort', r));
        aborted.push(text);
      },
    };
    const sp2 = new Speaker(slow, fakeSink());
    sp2.say('long');
    sp2.say('later');
    await Bun.sleep(1);
    sp2.stop();
    await Bun.sleep(1);
    expect(aborted).toContain('long');
    expect(started).not.toContain('later');
    expect(sp2.busy).toBe(false);
  });

  test('a synthesis error stops the queue and is reported', async () => {
    const errors: unknown[] = [];
    const tts: TtsEngine = {
      sampleRate: 1000,
      async *synth() {
        throw new Error('quota');
      },
    };
    const sp = new Speaker(tts, fakeSink(), { onError: (e) => errors.push(e) });
    sp.say('a');
    sp.say('b');
    await Bun.sleep(5);
    expect(errors.length).toBe(1);
    expect(sp.busy).toBe(false);
  });
});
