// Streamable-HTTP MCP client for n8n. Calls go through the same-origin /mcp proxy
// (n8n Cloud has no CORS on the MCP endpoint) unless the connection is "direct".

import { readSse } from '../sse.ts';
import { accessToken, refresh, type Connection } from './oauth.ts';

const PROTOCOL = '2025-06-18';
const RATE_RETRIES = [2000, 5000, 10000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ToolContent {
  type: string;
  text?: string;
}

export interface ToolResult {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export class McpError extends Error {
  override name = 'McpError';
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** Text of a tool result, joined. */
export const resultText = (r: ToolResult) => r.content.map((c) => c.text ?? '').join('');

/** structuredContent, or the text parsed as JSON when possible. */
export function resultData<T = unknown>(r: ToolResult): T {
  if (r.structuredContent !== undefined) return r.structuredContent as T;
  const t = resultText(r);
  try {
    return JSON.parse(t) as T;
  } catch {
    return t as T;
  }
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class Mcp {
  private session: string | null = null;
  private protocol: string | null = null;
  private initialised: Promise<void> | null = null;
  private nextId = 1;
  serverInfo: { name?: string; version?: string } = {};
  instructions = '';

  /**
   * @param token Optional fixed bearer token (an n8n MCP access token, used by scripts/n8n.ts);
   *              without it the browser's OAuth tokens are used and refreshed.
   */
  constructor(
    readonly conn: Connection,
    private readonly mode: 'proxy' | 'direct' = 'proxy',
    private readonly token?: () => Promise<string>,
  ) {}

  private async post(msg: { id?: number; method: string; params?: object }, retried = false): Promise<RpcResponse | null> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token ? await this.token() : await accessToken(this.conn)}`,
    };
    if (this.session) headers['mcp-session-id'] = this.session;
    if (this.protocol) headers['mcp-protocol-version'] = this.protocol;
    let url = this.conn.mcpUrl;
    if (this.mode === 'proxy') {
      url = '/mcp';
      headers['x-n8n-instance'] = new URL(this.conn.base).origin;
    }
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg });
    let r = await fetch(url, { method: 'POST', headers, body });
    // n8n Cloud rate-limits MCP; back off and retry a few times before giving up.
    for (let attempt = 0; r.status === 429 && attempt < RATE_RETRIES.length; attempt++) {
      const after = Number(r.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : RATE_RETRIES[attempt]!);
      r = await fetch(url, { method: 'POST', headers, body });
    }
    if (r.status === 429) throw new McpError('n8n is rate-limiting requests right now. Wait a minute and try again.', 429);
    if (r.status === 401 && this.token) throw new McpError('n8n rejected the MCP access token (401).', 401);
    if (r.status === 401 && !retried) {
      await refresh(this.conn);
      return this.post(msg, true);
    }
    if (r.status === 404 && this.session && !retried && msg.method !== 'initialize') {
      this.reset();
      await this.init();
      return this.post(msg, true);
    }
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.session = sid;
    if (msg.id === undefined) {
      if (!r.ok && r.status !== 202) throw new McpError(`MCP ${msg.method} failed (${r.status})`);
      return null;
    }
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream') && r.body) {
      for await (const ev of readSse(r.body)) {
        const m = JSON.parse(ev.data) as RpcResponse;
        if (m.id === msg.id) return m;
      }
      throw new McpError('MCP stream ended without a response');
    }
    if (ct.includes('json')) {
      const j = (await r.json()) as RpcResponse & { jsonrpc?: string; message?: string };
      if (!j.jsonrpc) throw new McpError(`n8n: ${j.message ?? `HTTP ${r.status}`}`, r.status);
      return j;
    }
    throw new McpError(`MCP HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }

  private reset() {
    this.session = null;
    this.protocol = null;
    this.initialised = null;
  }

  init(): Promise<void> {
    this.initialised ??= (async () => {
      const res = await this.post({
        id: this.nextId++,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'invenstory', version: '0.1.0' } },
      });
      if (!res || res.error) {
        this.initialised = null;
        throw new McpError(res?.error?.message ?? 'MCP initialize failed', res?.error?.code);
      }
      const result = res.result as { protocolVersion: string; serverInfo?: { name?: string; version?: string }; instructions?: string };
      this.protocol = result.protocolVersion;
      this.serverInfo = result.serverInfo ?? {};
      this.instructions = result.instructions ?? '';
      await this.post({ method: 'notifications/initialized' });
    })();
    return this.initialised;
  }

  async request<T>(method: string, params: object = {}): Promise<T> {
    await this.init();
    const res = await this.post({ id: this.nextId++, method, params });
    if (!res) throw new McpError(`No response to ${method}`);
    if (res.error) throw new McpError(res.error.message, res.error.code, res.error.data);
    if (res.result === undefined) throw new McpError(`Empty response to ${method}`);
    return res.result as T;
  }

  async listTools(): Promise<ToolInfo[]> {
    const tools: ToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request<{ tools: ToolInfo[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  /** Calls a tool; tool-level failures come back with isError, not as exceptions. */
  callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    return this.request<ToolResult>('tools/call', { name, arguments: args });
  }

  /** Calls a tool and throws on isError; returns structured data. */
  async call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.callTool(name, args);
    if (r.isError) throw new McpError(`${name}: ${resultText(r).slice(0, 2000)}`);
    return resultData<T>(r);
  }
}
