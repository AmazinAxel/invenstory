import { describe, expect, test } from 'bun:test';
import { hostMatches, mcpProxy, parseTarget } from '../src/server/mcp-proxy.ts';

describe('hostMatches', () => {
  test('wildcard matches exactly one label', () => {
    expect(hostMatches('shop.app.n8n.cloud', '*.app.n8n.cloud')).toBe(true);
    expect(hostMatches('a.b.app.n8n.cloud', '*.app.n8n.cloud')).toBe(false);
    expect(hostMatches('app.n8n.cloud', '*.app.n8n.cloud')).toBe(false);
    expect(hostMatches('evilapp.n8n.cloud', '*.app.n8n.cloud')).toBe(false);
  });
  test('exact patterns', () => {
    expect(hostMatches('n8n.example.com', 'n8n.example.com')).toBe(true);
    expect(hostMatches('x.n8n.example.com', 'n8n.example.com')).toBe(false);
  });
});

describe('parseTarget', () => {
  const allowed = '*.app.n8n.cloud, n8n.example.com';
  test('accepts bare https origins', () => {
    expect(parseTarget('https://shop.app.n8n.cloud', allowed)).toBe('https://shop.app.n8n.cloud');
    expect(parseTarget('https://n8n.example.com/', allowed)).toBe('https://n8n.example.com');
  });
  test('rejects http, paths, credentials, queries and other hosts', () => {
    for (const v of [
      'http://shop.app.n8n.cloud',
      'https://shop.app.n8n.cloud/x',
      'https://u:p@shop.app.n8n.cloud',
      'https://shop.app.n8n.cloud?a=1',
      'https://evil.com',
      'not a url',
      null,
    ]) {
      expect(parseTarget(v, allowed)).toBeNull();
    }
  });
});

describe('mcpProxy', () => {
  test('refuses requests without an allowed target before any fetch', async () => {
    const r = await mcpProxy(new Request('http://localhost/mcp', { method: 'POST', headers: { 'x-n8n-instance': 'https://evil.com' } }));
    expect(r.status).toBe(400);
  });
  test('refuses other methods', async () => {
    const r = await mcpProxy(new Request('http://localhost/mcp', { method: 'PUT' }));
    expect(r.status).toBe(405);
  });
  test('forwards only allowed headers to the fixed MCP path', async () => {
    const orig = globalThis.fetch;
    let seen: { url: string; headers: Headers } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers) };
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1', 'mcp-session-id': 's1' } });
    }) as typeof fetch;
    try {
      const r = await mcpProxy(
        new Request('http://localhost/mcp', {
          method: 'POST',
          headers: { 'x-n8n-instance': 'https://shop.app.n8n.cloud', authorization: 'Bearer t', cookie: 'c=1', 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(seen!.url).toBe('https://shop.app.n8n.cloud/mcp-server/http');
      expect(seen!.headers.get('authorization')).toBe('Bearer t');
      expect(seen!.headers.get('cookie')).toBeNull();
      expect(seen!.headers.get('x-n8n-instance')).toBeNull();
      expect(r.headers.get('mcp-session-id')).toBe('s1');
      expect(r.headers.get('set-cookie')).toBeNull();
    } finally {
      globalThis.fetch = orig;
    }
  });
});
