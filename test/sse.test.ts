import { describe, expect, test } from 'bun:test';
import { parseEventBlock, readSse } from '../src/lib/sse.ts';

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out = [];
  for await (const e of readSse(stream(chunks))) out.push(e);
  return out;
}

describe('parseEventBlock', () => {
  test('event and multi-line data', () => {
    expect(parseEventBlock('event: x\ndata: a\ndata: b')).toEqual({ event: 'x', data: 'a\nb' });
  });
  test('comments and empty blocks yield null', () => {
    expect(parseEventBlock(': ping')).toBeNull();
    expect(parseEventBlock('')).toBeNull();
  });
  test('only one leading space is stripped', () => {
    expect(parseEventBlock('data:  two')?.data).toBe(' two');
  });
});

describe('readSse', () => {
  test('events split across chunk boundaries', async () => {
    const evs = await collect(['event: message_start\nda', 'ta: {"a":1}\n', '\nevent: ping\ndata: {}\n\n']);
    expect(evs).toEqual([
      { event: 'message_start', data: '{"a":1}' },
      { event: 'ping', data: '{}' },
    ]);
  });
  test('CRLF separators', async () => {
    expect(await collect(['data: 1\r\n\r\ndata: 2\r\n\r\n'])).toEqual([
      { event: 'message', data: '1' },
      { event: 'message', data: '2' },
    ]);
  });
  test('trailing event without blank line', async () => {
    expect(await collect(['data: [DONE]'])).toEqual([{ event: 'message', data: '[DONE]' }]);
  });
});
