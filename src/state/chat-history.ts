// Pure helpers for chat history (no runes, so tests can import them).

import type { Message, Part } from '../lib/llm/types.ts';
import type { StoredMessage } from '../lib/n8n/api.ts';

export const SNAPSHOT_MARK = '[Dashboard snapshot';

/** Converts stored rows into the neutral history the adapters replay. */
export function fromStored(origin: string, rows: StoredMessage[]): Message[] {
  const out: Message[] = [];
  if (origin === 'analysis') out.push({ role: 'user', parts: [{ type: 'text', text: '(Automatic analysis run.)' }] });
  for (const r of rows) {
    const c = r.content as { type?: string; parts?: Part[]; text?: string; output?: unknown; item_id?: string } | string;
    if (typeof c === 'object' && c?.type === 'parts' && Array.isArray(c.parts)) {
      out.push({ role: r.role === 'assistant' ? 'assistant' : 'user', parts: c.parts });
    } else if (typeof c === 'object' && c?.type === 'insight') {
      out.push({ role: 'assistant', parts: [{ type: 'text', text: c.text ?? '' }] });
    } else if (typeof c === 'object' && c?.type === 'action_result') {
      out.push({ role: 'user', parts: [{ type: 'text', text: `(The owner ran action item ${c.item_id}. Result: ${JSON.stringify(c.output).slice(0, 2000)})` }] });
    } else if (typeof c === 'string' && c) {
      out.push({ role: r.role === 'assistant' ? 'assistant' : 'user', parts: [{ type: 'text', text: c }] });
    }
  }
  return repairHistory(out);
}


const INTERRUPTED = 'Interrupted: this call did not finish (the app was reloaded or n8n was unavailable). Check the current state before retrying.';

/**
 * Every tool call must be answered in the next message. Calls left without a result (reload
 * mid-run, a lost save) get a fixed "interrupted" result, inserted deterministically so the
 * replayed history is identical on every turn.
 */
export function repairHistory(history: Message[]): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;
    out.push(m);
    if (m.role !== 'assistant') continue;
    const ids = m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.id] : []));
    if (!ids.length) continue;
    const next = history[i + 1];
    const answered = new Set(next?.role === 'user' ? next.parts.flatMap((p) => (p.type === 'tool_result' ? [p.id] : [])) : []);
    const missing: Part[] = ids.filter((id) => !answered.has(id)).map((id) => ({ type: 'tool_result', id, content: INTERRUPTED, isError: true }));
    if (!missing.length) continue;
    if (next?.role === 'user') {
      // Results first, then whatever the user wrote.
      const results = next.parts.filter((p) => p.type === 'tool_result');
      const rest = next.parts.filter((p) => p.type !== 'tool_result');
      out.push({ role: 'user', parts: [...results, ...missing, ...rest] });
      i++;
    } else {
      out.push({ role: 'user', parts: missing });
    }
  }
  return out;
}
