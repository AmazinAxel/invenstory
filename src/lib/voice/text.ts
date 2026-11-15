// Pure text helpers for voice mode: turn a streamed markdown reply into speakable sentences.

/** Longest piece spoken in one request when the model writes without punctuation. */
export const MAX_CHUNK = 220;

// Lower-cased words whose trailing dot does not end a sentence.
const ABBREV = new Set(['e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'approx', 'incl', 'est', 'jr', 'sr', 'inc', 'ltd', 'co', 'cf', 'fig', 'qty', 'avg', 'min', 'max', 'pcs', 'ea']);

const TERMINATORS = '.!?…';
const CLOSERS = '"\')]”’';

/** Markdown → plain words for speech. Numbers and currency pass through untouched. */
export function toSpeech(md: string): string {
  let s = md;
  s = s.replace(/```[\s\S]*?(```|$)/g, ' '); // fenced code (closed, or cut off at the end)
  s = s
    .split('\n')
    .filter((l) => !/^\s*\|/.test(l) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) // tables, horizontal rules
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '') // headings
        .replace(/^\s*>\s?/, '') // block quotes
        .replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, ''), // list markers
    )
    .join('\n');
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images → alt text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links → their text
  s = s.replace(/<?https?:\/\/[^\s>)]*[^\s>).,;:!?'"]>?/g, 'the link');
  s = s.replace(/`([^`]*)`/g, '$1'); // inline code keeps its text
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'); // strong
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2'); // *em*
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2'); // _em_ (not snake_case)
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');
  s = s.replace(/[*_~`#]{2,}/g, ' '); // stray markup runs
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const hasWord = (s: string) => /[\p{L}\p{N}]/u.test(toSpeech(s)) && /\p{L}/u.test(s);

/** A reply may end with "Options: A | B" (one-tap answer chips, src/lib/agent/options.ts): shown, never spoken. */
const isOptionsLine = (line: string) => /^\s*options:/i.test(line);
/** The unfinished last line might still turn into an options line ("Opt…"): wait for more text. */
function mayBecomeOptionsLine(tail: string): boolean {
  const s = tail.trimStart().toLowerCase();
  return s.length > 0 && s.length < 8 && 'options:'.startsWith(s);
}

/** Index just past a sentence end in `line` at or after `from`, or -1 when none is certain yet. */
function sentenceEnd(line: string, from: number): number {
  for (let i = from; i < line.length; i++) {
    if (!TERMINATORS.includes(line[i]!)) continue;
    let j = i + 1;
    while (j < line.length && (TERMINATORS.includes(line[j]!) || CLOSERS.includes(line[j]!))) j++;
    if (j >= line.length) return -1; // can't tell yet ("$1." might become "$1.50")
    if (!/\s/.test(line[j]!)) continue; // 1,240.50 / e.g.x / file.txt
    if (line[i] === '.') {
      const word = /(\S+)$/.exec(line.slice(0, i))?.[1] ?? '';
      const w = word.toLowerCase().replace(/^[("'“‘]+/, '');
      if (ABBREV.has(w) || /^\p{L}$/u.test(w) || /^(\p{L}\.)+\p{L}$/u.test(w)) continue; // e.g. / J. / U.S.
    }
    if (!hasWord(line.slice(from, j))) continue; // "1." alone is a list number, not a sentence
    return j;
  }
  return -1;
}

/** Cuts an over-long unpunctuated piece at a clause or word boundary. */
function softCut(s: string): number {
  const window = s.slice(0, MAX_CHUNK);
  for (const sep of [/[;:,—–]\s(?!.*[;:,—–]\s)/s, /\s(?!.*\s)/s]) {
    const m = sep.exec(window);
    if (m && m.index > MAX_CHUNK / 3) return m.index + m[0].length;
  }
  return MAX_CHUNK;
}

/**
 * Incremental sentence splitter for a streamed markdown reply. push() returns the speakable
 * sentences completed by this delta (already passed through toSpeech); flush() returns the rest.
 * Code blocks and tables are skipped; a line break always ends a piece.
 */
export class SentenceChunker {
  private buf = '';
  private fence = false;

  push(delta: string): string[] {
    this.buf += delta;
    return this.drain(false);
  }

  flush(): string[] {
    const out = this.drain(true);
    this.buf = '';
    this.fence = false;
    return out;
  }

  reset() {
    this.buf = '';
    this.fence = false;
  }

  private drain(final: boolean): string[] {
    const out: string[] = [];
    const emit = (raw: string) => {
      const t = toSpeech(raw);
      if (/[\p{L}\p{N}]/u.test(t)) out.push(t);
    };
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) break;
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (/^\s*(```|~~~)/.test(line)) {
        this.fence = !this.fence;
        continue;
      }
      if (this.fence || /^\s*\|/.test(line) || isOptionsLine(line)) continue;
      for (const piece of this.split(line, true)) emit(piece);
    }
    // The unfinished last line: speak complete sentences now, keep the rest.
    const tail = this.buf;
    // Wait for the line end when it may be a table row or a code fence; an options line is dropped.
    if (this.fence || /^\s*(\||```|~~~|`{1,2}$|~{1,2}$)/.test(tail) || isOptionsLine(tail) || (!final && mayBecomeOptionsLine(tail))) {
      if (final) this.buf = '';
      return out;
    }
    const pieces = this.split(tail, final);
    const keep = final ? '' : tail.slice(pieces.reduce((n, p) => n + p.length, 0));
    for (const p of pieces) emit(p);
    this.buf = keep;
    return out;
  }

  /** Splits text into finished pieces; with `all`, the unfinished remainder is included too. */
  private split(text: string, all: boolean): string[] {
    const pieces: string[] = [];
    let rest = text;
    for (;;) {
      const end = sentenceEnd(rest, 0);
      if (end > 0 && end <= MAX_CHUNK) {
        pieces.push(rest.slice(0, end));
        rest = rest.slice(end);
        continue;
      }
      if (rest.length > MAX_CHUNK) {
        const cut = softCut(rest);
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut);
        continue;
      }
      break;
    }
    if (all && rest) pieces.push(rest);
    return pieces;
  }
}

/** Short spoken commands that end the current run locally instead of going to the model. */
export function isStopCommand(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:(?:ok|okay|hey|please|no)\s)*(?:stop|cancel|abort|halt|quiet|be quiet|shush|shut up|never ?mind|nevermind|forget it|that's enough|enough)(?:\s(?:it|that|now|please|talking|everything|the task|this))*$/.test(t);
}

/** Drops transcription tags like "(background noise)" or "[music]" and surrounding space. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
