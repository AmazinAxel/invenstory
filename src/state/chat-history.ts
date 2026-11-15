// Pure helpers for chat history (no runes, so tests can import them).

import { toolCalls, type Message, type Part } from '../lib/llm/types.ts';
import type { StoredMessage } from '../lib/n8n/api.ts';

export const SNAPSHOT_MARK = '[Dashboard snapshot';
export const VOICE_MARK = '[Voice mode';
/**
 * Hidden text part on spoken user messages, so the model answers for the ear. Typed messages carry
 * none. Stored like any other part and replayed unchanged (never edit this text in place for old
 * sessions: history replays byte-identically; a new wording only affects new messages).
 */
export const VOICE_HINT = `${VOICE_MARK}; the owner is speaking and will hear this reply read aloud. Answer in one to three short spoken sentences, plain words, no markdown, lists or tables.]`;

/** Context parts the app adds to user messages (dashboard snapshot, voice hint): not shown in the chat. */
export function isHiddenText(text: string): boolean {
  return text.startsWith(SNAPSHOT_MARK) || text.startsWith(VOICE_MARK);
}

/** Text the owner may see: text parts minus the dashboard snapshot the app attaches for the model. */
export function visibleText(m: Message): string {
  return m.parts
    .filter((p) => p.type === 'text' && !isHiddenText(p.text))
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('\n\n');
}

export type ToolCall = Extract<Part, { type: 'tool_call' }>;
export type Turn = { user: string } | { calls: ToolCall[]; text: string };

/**
 * Groups history for display: one turn per owner message, and one per run of assistant messages between them
 * (tool-result-only user messages do not split a turn). An assistant turn keeps all its tool calls and only its
 * last non-empty text; earlier text is narration between tool calls and stays hidden.
 */
export function chatTurns(messages: Message[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = visibleText(m);
      if (text) out.push({ user: text });
      continue;
    }
    let t = out.at(-1);
    if (!t || 'user' in t) out.push((t = { calls: [], text: '' }));
    t.calls.push(...toolCalls(m.parts));
    const text = visibleText(m);
    if (text.trim()) t.text = text;
  }
  return out;
}

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

/**
 * Whether the dashboard summary's newest session should replace the chat on screen.
 * `resetAt` (ms) is set by "New chat": until a session created after it exists, the old one stays hidden.
 */
export function shouldAdopt(
  cur: { sessionId: string | null; storedCount: number },
  sess: { session_id: string; created_at: string; messageCount: number },
  resetAt: number | null,
): boolean {
  if (resetAt !== null && !(Date.parse(sess.created_at) > resetAt)) return false;
  return sess.session_id !== cur.sessionId || sess.messageCount > cur.storedCount;
}
