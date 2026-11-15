// Claude Messages API adapter (raw fetch + SSE, called straight from the browser).

import { readSse } from '../sse.ts';
import {
  LlmError,
  parseToolInput,
  type Llm,
  type LlmConfig,
  type Message,
  type Part,
  type StopReason,
  type StreamEvent,
  type TurnRequest,
  type TurnResult,
} from './types.ts';

export const ANTHROPIC_BASE = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5-2|fable-5-1|sonnet-5-5)$/;
// Models without the effort parameter.
const NO_EFFORT = /^claude-(sonnet-4-5|haiku-4-5|3)/;

type Block = Record<string, unknown> & { type: string };

export function toAnthropicMessages(messages: Message[]): { role: string; content: Block[] }[] {
  const out: { role: string; content: Block[] }[] = [];
  for (const m of messages) {
    const content: Block[] = [];
    for (const p of m.parts) {
      if (p.type === 'text') {
        if (p.text.trim()) content.push({ type: 'text', text: p.text });
      } else if (p.type === 'tool_call') {
        content.push({ type: 'tool_use', id: p.id, name: p.name, input: p.input });
      } else if (p.type === 'tool_result') {
        content.push({ type: 'tool_result', tool_use_id: p.id, content: p.content || '(empty)', ...(p.isError ? { is_error: true } : {}) });
      } else if (p.type === 'native' && p.provider === 'anthropic') {
        content.push(p.block as Block);
      }
    }
    if (content.length) out.push({ role: m.role, content });
  }
  return out;
}

/**
 * Converts received blocks to parts. After a mid-output fallback, thinking/tool_use and other
 * model-internal blocks before the last `fallback` block are omitted (and never executed);
 * text blocks and the fallback block itself stay where they appeared.
 */
export function blocksToParts(blocks: Block[], rawInputs: Map<number, string>): Part[] {
  let boundary = -1;
  blocks.forEach((b, i) => {
    if (b.type === 'fallback') boundary = i;
  });
  const parts: Part[] = [];
  blocks.forEach((b, i) => {
    if (!b) return;
    const beforeBoundary = i < boundary;
    if (b.type === 'text') {
      parts.push({ type: 'text', text: String(b.text ?? '') });
    } else if (b.type === 'tool_use') {
      if (beforeBoundary) return;
      const { input, invalid } = parseToolInput(rawInputs.get(i) ?? '');
      parts.push({ type: 'tool_call', id: String(b.id), name: String(b.name), input, ...(invalid !== undefined ? { invalid } : {}) });
    } else if (b.type === 'fallback') {
      parts.push({ type: 'native', provider: 'anthropic', block: b });
    } else {
      if (beforeBoundary) return; // thinking, redacted_thinking, unknown internal blocks
      parts.push({ type: 'native', provider: 'anthropic', block: b });
    }
  });
  return parts;
}

function mapStop(s: string | undefined): StopReason {
  if (s === 'end_turn' || s === 'stop_sequence' || s === 'pause_turn') return 'end';
  if (s === 'tool_use') return 'tool_use';
  if (s === 'max_tokens') return 'max_tokens';
  if (s === 'refusal') return 'refusal';
  return 'other';
}

export function anthropic(cfg: LlmConfig): Llm {
  const base = (cfg.baseUrl || ANTHROPIC_BASE).replace(/\/+$/, '');
  const model = cfg.model || ANTHROPIC_DEFAULT_MODEL;
  const firstParty = base === ANTHROPIC_BASE;

  return {
    async turn(req: TurnRequest, onEvent?: (e: StreamEvent) => void): Promise<TurnResult> {
      const body: Record<string, unknown> = {
        model,
        max_tokens: req.maxTokens ?? 32000,
        stream: true,
        cache_control: { type: 'ephemeral' },
        messages: toAnthropicMessages(req.messages),
      };
      if (req.system) body.system = req.system;
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true }));
      }
      const effort = req.effort ?? (cfg.effort || undefined);
      if (effort && !NO_EFFORT.test(model)) body.output_config = { effort };
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (firstParty && FALLBACK_MODELS.test(model)) {
        body.fallbacks = 'default';
        headers['anthropic-beta'] = FALLBACK_BETA;
      }

      const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new LlmError(j?.error?.message ?? `Claude API error ${r.status}`, r.status);
      }

      const blocks: Block[] = [];
      const rawInputs = new Map<number, string>();
      let stop: string | undefined;
      let usedModel: string | undefined;
      const usage: TurnResult['usage'] = {};
      for await (const ev of readSse(r.body, req.signal)) {
        if (ev.event === 'ping') continue;
        const d = JSON.parse(ev.data) as Record<string, any>;
        switch (d.type) {
          case 'message_start':
            usedModel = d.message?.model;
            usage.input = d.message?.usage?.input_tokens;
            usage.cacheRead = d.message?.usage?.cache_read_input_tokens;
            break;
          case 'content_block_start': {
            const b = structuredClone(d.content_block) as Block;
            blocks[d.index] = b;
            if (b.type === 'tool_use') {
              rawInputs.set(d.index, '');
              onEvent?.({ type: 'tool_start', name: String(b.name) });
            }
            break;
          }
          case 'content_block_delta': {
            const b = blocks[d.index];
            const delta = d.delta as Record<string, string>;
            if (!b) break;
            if (delta.type === 'text_delta') {
              b.text = String(b.text ?? '') + delta.text;
              onEvent?.({ type: 'text', text: delta.text ?? '' });
            } else if (delta.type === 'thinking_delta') b.thinking = String(b.thinking ?? '') + delta.thinking;
            else if (delta.type === 'signature_delta') b.signature = String(b.signature ?? '') + delta.signature;
            else if (delta.type === 'input_json_delta') rawInputs.set(d.index, (rawInputs.get(d.index) ?? '') + delta.partial_json);
            break;
          }
          case 'message_delta':
            stop = d.delta?.stop_reason ?? stop;
            usage.output = d.usage?.output_tokens ?? usage.output;
            break;
          case 'error':
            throw new LlmError(d.error?.message ?? 'Claude stream error');
        }
      }
      // Tool-use blocks carry their input only as streamed JSON; fill it in for replay.
      const parts = blocksToParts(blocks, rawInputs);
      return { parts, stop: mapStop(stop), rawStop: stop, model: usedModel, usage };
    },
  };
}
