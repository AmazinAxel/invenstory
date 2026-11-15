// Same-origin MCP proxy. n8n Cloud sends no CORS headers on /mcp-server/http, so the
// browser posts to /mcp with `x-n8n-instance: <origin>` and this forwards the call.
// Stateless: nothing is stored or logged. Runs as a Cloudflare Pages Function
// (functions/mcp.ts) and inside the Vite dev/preview server.

export interface ProxyEnv {
  /** Comma-separated host patterns; `*.example.com` matches exactly one extra label. */
  N8N_ALLOWED_HOSTS?: string;
}

const DEFAULT_HOSTS = '*.app.n8n.cloud';
const FORWARD_REQUEST = ['authorization', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id'];
const FORWARD_RESPONSE = ['content-type', 'mcp-session-id', 'www-authenticate'];
const METHODS = new Set(['GET', 'POST', 'DELETE']);
const MAX_BODY = 1024 * 1024;

export function hostMatches(host: string, pattern: string): boolean {
  host = host.toLowerCase();
  pattern = pattern.trim().toLowerCase();
  if (!pattern) return false;
  if (!pattern.startsWith('*.')) return host === pattern;
  const suffix = pattern.slice(1);
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, -suffix.length);
  return label.length > 0 && !label.includes('.');
}

/** Returns the normalised https origin, or null when the header is malformed or not allowed. */
export function parseTarget(value: string | null, allowed: string): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  if (!allowed.split(',').some((p) => hostMatches(url.hostname, p))) return null;
  return url.origin;
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function mcpProxy(request: Request, env: ProxyEnv = {}): Promise<Response> {
  if (!METHODS.has(request.method)) return error(405, 'method not allowed');
  const target = parseTarget(request.headers.get('x-n8n-instance'), env.N8N_ALLOWED_HOSTS || DEFAULT_HOSTS);
  if (!target) return error(400, 'bad or disallowed x-n8n-instance');

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  let body: ArrayBuffer | undefined;
  if (request.method === 'POST') {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY) return error(413, 'request too large');
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${target}/mcp-server/http`, { method: request.method, headers, body, redirect: 'manual' });
  } catch {
    return error(502, 'n8n instance unreachable');
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARD_RESPONSE) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
