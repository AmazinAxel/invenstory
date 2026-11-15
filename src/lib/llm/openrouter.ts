// "Log in with OpenRouter": OpenRouter's OAuth PKCE flow returns a user-controlled API key, so
// people without a key can onboard by signing in. Docs: https://openrouter.ai/docs/use-cases/oauth-pkce

import { kv, K } from '../kv.ts';
import type { LlmConfig } from './types.ts';

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/auto';

interface Pending {
  verifier: string;
  model: string;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function beginOpenRouterLogin(model: string): Promise<never> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await kv.set(K.orPending, { verifier, model: model.trim() || OPENROUTER_DEFAULT_MODEL } satisfies Pending);
  const u = new URL('https://openrouter.ai/auth');
  u.searchParams.set('callback_url', location.origin + '/');
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  location.assign(u.toString());
  return new Promise<never>(() => {});
}

/**
 * Finishes an OpenRouter login if the URL carries its `code`. OpenRouter sends no `state`, which
 * is how this is told apart from the n8n OAuth callback (that one always has `state`).
 */
export async function completeOpenRouterLogin(): Promise<LlmConfig | null> {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') || q.has('state')) return null;
  const pending = await kv.get<Pending>(K.orPending);
  if (!pending) return null;
  history.replaceState(null, '', location.pathname);
  await kv.del(K.orPending);
  const r = await fetch(`${OPENROUTER_BASE}/auth/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: q.get('code'), code_verifier: pending.verifier, code_challenge_method: 'S256' }),
  });
  const j = (await r.json().catch(() => ({}))) as { key?: string };
  if (!r.ok || !j.key) throw new Error(`OpenRouter login failed (${r.status}).`);
  return { protocol: 'openai', baseUrl: OPENROUTER_BASE, apiKey: j.key, model: pending.model, label: 'OpenRouter' };
}
