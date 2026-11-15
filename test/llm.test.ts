import { describe, expect, test } from 'bun:test';
import { anthropic, blocksToParts, toAnthropicMessages } from '../src/lib/llm/anthropic.ts';
import { openai, toChatMessages } from '../src/lib/llm/openai.ts';
import { parseToolInput, type Message } from '../src/lib/llm/types.ts';

const history: Message[] = [
  { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  {
    role: 'assistant',
    parts: [
      { type: 'native', provider: 'anthropic', block: { type: 'thinking', thinking: '', signature: 'sig' } },
      { type: 'text', text: 'checking' },
      { type: 'tool_call', id: 't1', name: 'list', input: { q: 1 } },
    ],
  },
  { role: 'user', parts: [{ type: 'tool_result', id: 't1', content: 'done' }, { type: 'text', text: 'and?' }] },
];

function sseResponse(events: object[]): Response {
  const body = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function withFetch<T>(impl: (url: string, init: RequestInit) => Response, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => impl(url, init)) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

describe('parseToolInput', () => {
  test('valid, empty and invalid JSON', () => {
    expect(parseToolInput('{"a":1}')).toEqual({ input: { a: 1 } });
    expect(parseToolInput('')).toEqual({ input: {} });
    expect(parseToolInput('{"a":')).toEqual({ input: {}, invalid: '{"a":' });
    expect(parseToolInput('[1]')).toEqual({ input: {}, invalid: '[1]' });
  });
});

describe('anthropic conversion', () => {
  test('replays native blocks in order and maps tool parts', () => {
    const m = toAnthropicMessages(history);
    expect(m[1]!.content.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    expect(m[2]!.content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: 'done' });
  });

  test('drops thinking/tool_use before a mid-output fallback, keeps text and the marker', () => {
    const blocks = [
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'partial ' },
      { type: 'tool_use', id: 'x', name: 'n', input: {} },
      { type: 'fallback', from: { model: 'm1' }, to: { model: 'm2' } },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'tool_use', id: 'y', name: 'n', input: {} },
    ];
    const parts = blocksToParts(blocks, new Map([[2, '{}'], [5, '{"k":2}']]));
    expect(parts.map((p) => p.type)).toEqual(['text', 'native', 'native', 'tool_call']);
    expect(parts[3]).toEqual({ type: 'tool_call', id: 'y', name: 'n', input: { k: 2 } });
  });

  test('streams a tool-use turn and sends the documented headers', async () => {
    let sent: { headers: Headers; body: Record<string, unknown> } | null = null;
    const res = await withFetch(
      (_url, init) => {
        sent = { headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
        return sseResponse([
          { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 5 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu', name: 'f', input: {} } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':1}' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
          { type: 'message_stop' },
        ]);
      },
      () =>
        anthropic({ protocol: 'anthropic', baseUrl: '', apiKey: 'k', model: 'claude-opus-5-5', effort: 'high' }).turn({
          messages: history,
          tools: [{ name: 'f', description: 'd', schema: { type: 'object' } }],
        }),
    );
    expect(res.stop).toBe('tool_use');
    expect(res.parts).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'tool_call', id: 'tu', name: 'f', input: { a: 1 } },
    ]);
    expect(sent!.headers.get('anthropic-version')).toBe('2026-10-21');
    expect(sent!.headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(sent!.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01,thinking-binding-controls-2026-08-01');
    expect(sent!.body.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    expect(sent!.body.fallbacks).toBe('default');
    expect(sent!.body.output_config).toEqual({ effort: 'high' });
    expect((sent!.body.tools as { eager_input_streaming: boolean }[])[0]!.eager_input_streaming).toBe(true);
    expect(sent!.body.temperature).toBeUndefined();
  });
});

describe('openai conversion', () => {
  test('tool results directly follow the assistant tool call, native blocks dropped', () => {
    const m = toChatMessages('sys', history);
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(m[2]).toEqual({
      role: 'assistant',
      content: 'checking',
      tool_calls: [{ id: 't1', type: 'function', function: { name: 'list', arguments: '{"q":1}' } }],
    });
  });

  test('accumulates streamed tool-call fragments', async () => {
    const chunks = [
      { model: 'm', choices: [{ delta: { content: 'ok ' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"x"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':2}' } }] }, finish_reason: 'tool_calls' }] },
    ];
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    const res = await withFetch(
      () => new Response(body, { status: 200 }),
      () => openai({ protocol: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }).turn({ messages: history }),
    );
    expect(res.stop).toBe('tool_use');
    expect(res.parts).toEqual([
      { type: 'text', text: 'ok ' },
      { type: 'tool_call', id: 'c1', name: 'f', input: { x: 2 } },
    ]);
  });
});
