// OpenAI-compatible Chat Completions adapter (OpenAI, Gemini, OpenRouter, Grok, Groq, …).

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

export const OPENAI_PRESETS = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Grok', baseUrl: 'https://api.x.ai/v1' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
] as const;

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toChatMessages(system: string | undefined, messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') {
      const text = m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
      const calls = m.parts.flatMap((p) =>
        p.type === 'tool_call' ? [{ id: p.id, type: 'function' as const, function: { name: p.name, arguments: JSON.stringify(p.input) } }] : [],
      );
      if (!text && !calls.length) continue;
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      // Tool results must directly follow the assistant message that requested them.
      for (const p of m.parts) {
        if (p.type === 'tool_result') out.push({ role: 'tool', tool_call_id: p.id, content: (p.isError ? 'ERROR: ' : '') + (p.content || '(empty)') });
      }
      const text = m.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
      if (text.trim()) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

function mapStop(s: string | undefined): StopReason {
  if (s === 'stop') return 'end';
  if (s === 'tool_calls' || s === 'function_call') return 'tool_use';
  if (s === 'length') return 'max_tokens';
  if (s === 'content_filter') return 'refusal';
  return s ? 'other' : 'end';
}

export function openai(cfg: LlmConfig): Llm {
  if (!cfg.baseUrl) throw new LlmError('Base URL is required for OpenAI-compatible providers.');
  if (!cfg.model) throw new LlmError('Model is required.');
  const base = cfg.baseUrl.replace(/\/+$/, '');

  return {
    async turn(req: TurnRequest, onEvent?: (e: StreamEvent) => void): Promise<TurnResult> {
      const body: Record<string, unknown> = { model: cfg.model, stream: true, messages: toChatMessages(req.system, req.messages) };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
      }
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!r.ok || !r.body) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | { error?: { message?: string } }[] | null;
        const e = Array.isArray(j) ? j[0]?.error : j?.error;
        throw new LlmError(e?.message ?? `Provider error ${r.status}`, r.status);
      }

      let text = '';
      const calls: { id: string; name: string; args: string }[] = [];
      let finish: string | undefined;
      const usage: TurnResult['usage'] = {};
      let model: string | undefined;
      for await (const ev of readSse(r.body, req.signal)) {
        if (ev.data === '[DONE]') break;
        const d = JSON.parse(ev.data) as Record<string, any>;
        if (d.error) throw new LlmError(d.error.message ?? 'Provider stream error');
        model ??= d.model;
        if (d.usage) {
          usage.input = d.usage.prompt_tokens;
          usage.output = d.usage.completion_tokens;
        }
        const choice = d.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          onEvent?.({ type: 'text', text: delta.content });
        }
        for (const [pos, tc] of ((delta.tool_calls ?? []) as any[]).entries()) {
          const i = typeof tc.index === 'number' ? tc.index : pos;
          if (!calls[i]) {
            calls[i] = { id: tc.id || `call_${crypto.randomUUID().slice(0, 8)}`, name: '', args: '' };
          }
          const c = calls[i]!;
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) {
            if (!c.name) onEvent?.({ type: 'tool_start', name: tc.function.name });
            c.name += tc.function.name;
          }
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }

      const parts: Part[] = [];
      if (text) parts.push({ type: 'text', text });
      for (const c of calls.filter(Boolean)) {
        const { input, invalid } = parseToolInput(c.args);
        parts.push({ type: 'tool_call', id: c.id, name: c.name, input, ...(invalid !== undefined ? { invalid } : {}) });
      }
      // Some providers report "stop" even when they emitted tool calls.
      const stop = calls.length && finish !== 'length' ? 'tool_use' : mapStop(finish);
      return { parts, stop, rawStop: finish, model, usage };
    },
  };
}
