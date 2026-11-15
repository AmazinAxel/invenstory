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
  return out;
}

