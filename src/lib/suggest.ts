// One LLM call that turns the user's connected credential types into a few automation ideas.

import { createLlm } from './llm/index.ts';
import { textOf, type LlmConfig } from './llm/types.ts';

export function humanType(type: string): string {
  return type
    .replace(/(OAuth2|OAuth|Api)+$/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export function parseIdeas(text: string): string[] {
  const m = /\[[\s\S]*\]/.exec(text);
  if (m) {
    try {
      const arr = JSON.parse(m[0]) as unknown;
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 90)).slice(0, 4);
    } catch {
      /* fall through */
    }
  }
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 8 && l.length < 90)
    .slice(0, 4);
}

export async function suggestIdeas(cfg: LlmConfig, credentialTypes: string[]): Promise<string[]> {
  const services = [...new Set(credentialTypes.map(humanType))].join(', ') || 'none yet';
  const res = await createLlm(cfg).turn({
    system:
      'You suggest stock and sales automations for a small business that uses n8n. Each idea is one short imperative sentence the owner could send to an assistant, under 70 characters. Ideas may read and write business systems but never send messages or emails to anyone. Reply with a JSON array of exactly 4 strings and nothing else.',
    messages: [{ role: 'user', parts: [{ type: 'text', text: `Connected services: ${services}.` }] }],
    maxTokens: 4000,
    effort: cfg.protocol === 'anthropic' ? 'low' : undefined,
  });
  return parseIdeas(textOf(res.parts));
}
