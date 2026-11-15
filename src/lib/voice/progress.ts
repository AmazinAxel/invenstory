// Spoken progress while the agent runs tools: short lines from the human tool labels,
// at most one per `gapMs`, and only when nothing else is being spoken.

export const PROGRESS_GAP_MS = 6000;

/** "Building “Daily stock sync”" → "Building Daily stock sync." (plain, short, one line). */
export function progressLine(label: string): string {
  let s = label
    .replace(/[“”"‘’`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 80) s = `${s.slice(0, 80).replace(/\s+\S*$/, '')}`;
  s = s.replace(/[\s:,;.…-]+$/, '');
  return s ? `${s}.` : '';
}

export class ProgressThrottle {
  private last = -Infinity;
  private pending: string | null = null;

  constructor(readonly gapMs = PROGRESS_GAP_MS) {}

  /** A tool started: remember its label as the latest progress worth saying. */
  offer(label: string) {
    const line = progressLine(label);
    if (line) this.pending = line;
  }

  /**
   * Returns the line to speak now, or null. `busy`: something is being spoken (never cut it off).
   * A line that cannot be said yet stays pending until the next call, replaced by newer offers.
   */
  take(now: number, busy: boolean): string | null {
    if (!this.pending || busy || now - this.last < this.gapMs) return null;
    const line = this.pending;
    this.pending = null;
    this.last = now;
    return line;
  }

  /** The model is talking again or the run ended: drop the stale label. */
  clear() {
    this.pending = null;
  }

  reset() {
    this.pending = null;
    this.last = -Infinity;
  }
}
