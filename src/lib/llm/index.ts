import { anthropic } from './anthropic.ts';
import { openai } from './openai.ts';
import { textOf, type Llm, type LlmConfig } from './types.ts';

export function createLlm(cfg: LlmConfig): Llm {
  return cfg.protocol === 'anthropic' ? anthropic(cfg) : openai(cfg);
}

/** One short round trip to prove the key, model and CORS work. */
export async function testLlm(cfg: LlmConfig): Promise<string> {
  const res = await createLlm(cfg).turn({
    system: 'You are a connection check. Reply with the single word OK.',
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Connection check.' }] }],
    maxTokens: 2000,
    effort: cfg.protocol === 'anthropic' ? 'low' : undefined,
  });
  if (res.stop === 'refusal') throw new Error('The model declined the test request.');
  return textOf(res.parts).trim() || '(empty reply)';
}
