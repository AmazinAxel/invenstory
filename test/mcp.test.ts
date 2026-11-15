import { describe, expect, test } from 'bun:test';
import { Mcp, McpError } from '../src/lib/n8n/mcp.ts';
import { kv } from '../src/lib/kv.ts';

// kv uses IndexedDB in the browser; give accessToken a token without it.
(kv as { get: unknown }).get = async () => ({ access_token: 't', expires_at: null });

const conn = { base: 'https://x.app.n8n.cloud', mcpUrl: 'https://x.app.n8n.cloud/mcp-server/http', resource: '', as: { issuer: '', authorization_endpoint: '', token_endpoint: '' } };

function server(handler: (body: { id?: number; method: string }, n: number) => Response) {
  let n = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => handler(JSON.parse(String(init.body)), n++)) as typeof fetch;
  return () => (globalThis.fetch = orig);
}
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const rpc = (b: { id?: number; method: string }) =>
  b.method === 'initialize' ? json({ jsonrpc: '2.0', id: b.id, result: { protocolVersion: '2025-06-18' } }) : b.id === undefined ? new Response(null, { status: 202 }) : json({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: 'ok' }] } });

describe('Mcp rate limiting', () => {
  test('retries after 429 with Retry-After', async () => {
    let limited = 0;
    const restore = server((b) => (b.method === 'tools/call' && limited++ < 1 ? json({ message: 'Too many requests' }, 429, { 'retry-after': '0.01' }) : rpc(b)));
    try {
      const r = await new Mcp(conn, 'direct').callTool('x');
      expect(r.content[0]!.text).toBe('ok');
      expect(limited).toBe(2);
    } finally {
      restore();
    }
  });

  test('a non-JSON-RPC body becomes a clear error instead of an empty result', async () => {
    const restore = server((b) => (b.method === 'tools/call' ? json({ message: 'Too many requests' }, 200) : rpc(b)));
    try {
      await expect(new Mcp(conn, 'direct').callTool('x')).rejects.toBeInstanceOf(McpError);
    } finally {
      restore();
    }
  });
});
