// OAuth 2.1 for n8n's instance-level MCP server, entirely in the browser: protected-resource
// and authorization-server discovery, dynamic client registration, PKCE (S256), token
// exchange and refresh. Verified against n8n Cloud 2.47.7 in Phase 0.

import { kv, K } from '../kv.ts';

export interface AuthServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

export interface Connection {
  base: string; // https://name.app.n8n.cloud
  mcpUrl: string;
  resource: string;
  scope?: string;
  as: AuthServer;
}

interface Client {
  client_id: string;
  client_secret?: string;
  issuer: string;
  redirect: string;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number | null;
  scope?: string;
}

interface Pending {
  verifier: string;
  state: string;
  conn: Connection;
}

export class AuthError extends Error {
  override name = 'AuthError';
}

const MCP_PATH = '/mcp-server/http';

export function normaliseBase(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  const path = u.pathname.replace(/\/+$/, '').replace(new RegExp(MCP_PATH + '$'), '');
  return u.origin + path;
}

const redirectUri = () => location.origin + '/';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function discover(base: string): Promise<Connection> {
  const mcpUrl = base + MCP_PATH;
  const origin = new URL(base).origin;
  const path = new URL(mcpUrl).pathname;
  let prm: Record<string, unknown> | null = null;
  for (const u of [`${origin}/.well-known/oauth-protected-resource${path}`, `${origin}/.well-known/oauth-protected-resource`]) {
    prm = await getJson(u);
    if (prm) break;
  }
  if (!prm) throw new AuthError(`No MCP server found at ${base}. Is instance-level MCP enabled?`);

  const servers = prm.authorization_servers as string[] | undefined;
  const issuer = new URL(servers?.[0] ?? origin);
  const p = issuer.pathname.replace(/\/$/, '');
  const candidates = [
    `${issuer.origin}/.well-known/oauth-authorization-server${p}`,
    p && `${issuer.origin}${p}/.well-known/oauth-authorization-server`,
    `${issuer.origin}/.well-known/openid-configuration${p}`,
  ].filter(Boolean) as string[];
  let as: AuthServer | null = null;
  for (const u of candidates) {
    const j = await getJson(u);
    if (j?.authorization_endpoint && j.token_endpoint) {
      as = j as unknown as AuthServer;
      break;
    }
  }
  if (!as) throw new AuthError('The n8n instance publishes no OAuth authorization server.');
  const scopes = prm.scopes_supported as string[] | undefined;
  return { base, mcpUrl, resource: (prm.resource as string) || mcpUrl, scope: scopes?.join(' '), as };
}

async function ensureClient(as: AuthServer): Promise<Client> {
  const existing = await kv.get<Client>(K.n8nClient);
  if (existing && existing.issuer === as.issuer && existing.redirect === redirectUri()) return existing;
  if (!as.registration_endpoint) throw new AuthError('The n8n instance does not allow client registration.');
  const r = await fetch(as.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Invenstory',
      redirect_uris: [redirectUri()],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const j = (await r.json().catch(() => ({}))) as Partial<Client>;
  if (!r.ok || !j.client_id) throw new AuthError(`Client registration failed (${r.status}).`);
  const client: Client = { client_id: j.client_id, client_secret: j.client_secret, issuer: as.issuer, redirect: redirectUri() };
  await kv.set(K.n8nClient, client);
  return client;
}

/** Starts the login: navigates away to n8n's consent page. */
export async function beginLogin(baseInput: string): Promise<never> {
  const conn = await discover(normaliseBase(baseInput));
  const client = await ensureClient(conn.as);
  const verifier = random(32);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random(16);
  await kv.set(K.n8nPending, { verifier, state, conn } satisfies Pending);
  const u = new URL(conn.as.authorization_endpoint);
  const q: Record<string, string> = {
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    resource: conn.resource,
  };
  if (conn.scope) q.scope = conn.scope;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  location.assign(u.toString());
  return new Promise<never>(() => {});
}

async function tokenRequest(as: AuthServer, params: Record<string, string>): Promise<Tokens> {
  const client = await kv.get<Client>(K.n8nClient);
  if (!client) throw new AuthError('No registered client; log in again.');
  const body = new URLSearchParams({ client_id: client.client_id, ...params });
  if (client.client_secret) body.set('client_secret', client.client_secret);
  const r = await fetch(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || typeof j.access_token !== 'string') {
    throw new AuthError(`Token request failed (${r.status}${j.error ? `: ${String(j.error)}` : ''}).`);
  }
  return {
    access_token: j.access_token,
    refresh_token: typeof j.refresh_token === 'string' ? j.refresh_token : undefined,
    expires_at: typeof j.expires_in === 'number' ? Date.now() + j.expires_in * 1000 : null,
    scope: typeof j.scope === 'string' ? j.scope : undefined,
  };
}

/**
 * Completes a login if the current URL carries an OAuth response.
 * Returns the connection on success, null when there was nothing to handle.
 */
export async function completeLogin(): Promise<Connection | null> {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  history.replaceState(null, '', location.pathname);
  const pending = await kv.get<Pending>(K.n8nPending);
  await kv.del(K.n8nPending);
  if (q.has('error')) throw new AuthError(`n8n declined the login: ${q.get('error_description') || q.get('error')}`);
  if (!pending || q.get('state') !== pending.state) throw new AuthError('Login response did not match; try again.');
  const tokens = await tokenRequest(pending.conn.as, {
    grant_type: 'authorization_code',
    code: q.get('code') ?? '',
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
    resource: pending.conn.resource,
  });
  await kv.set(K.n8nTokens, tokens);
  await kv.set(K.n8nConn, pending.conn);
  return pending.conn;
}

let refreshing: Promise<Tokens> | null = null;

export function refresh(conn: Connection): Promise<Tokens> {
  refreshing ??= (async () => {
    try {
      const old = await kv.get<Tokens>(K.n8nTokens);
      if (!old?.refresh_token) throw new AuthError('Session expired; log in to n8n again.');
      const t = await tokenRequest(conn.as, { grant_type: 'refresh_token', refresh_token: old.refresh_token, resource: conn.resource });
      const merged = { ...t, refresh_token: t.refresh_token ?? old.refresh_token };
      await kv.set(K.n8nTokens, merged);
      return merged;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A valid access token, refreshed when it expires within 60 s. */
export async function accessToken(conn: Connection): Promise<string> {
  const t = await kv.get<Tokens>(K.n8nTokens);
  if (!t) throw new AuthError('Not logged in to n8n.');
  if (t.expires_at && t.expires_at - Date.now() < 60_000) return (await refresh(conn)).access_token;
  return t.access_token;
}

export async function logout(): Promise<void> {
  const conn = await kv.get<Connection>(K.n8nConn);
  const t = await kv.get<Tokens>(K.n8nTokens);
  const client = await kv.get<Client>(K.n8nClient);
  if (conn?.as.revocation_endpoint && t?.refresh_token && client) {
    await fetch(conn.as.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: t.refresh_token, token_type_hint: 'refresh_token', client_id: client.client_id }),
    }).catch(() => {});
  }
  await Promise.all([kv.del(K.n8nTokens), kv.del(K.n8nConn), kv.del(K.n8nPending)]);
}
