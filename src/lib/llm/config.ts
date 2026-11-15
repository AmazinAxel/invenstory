// Pure builder for an LlmConfig from form input; shared by Onboarding and the Automations provider card.

import { ANTHROPIC_DEFAULT_MODEL } from './anthropic.ts';
import { OPENAI_PRESETS } from './openai.ts';
import type { Effort, LlmConfig, Protocol } from './types.ts';

export interface LlmInput {
  protocol: Protocol;
  apiKey: string;
  baseUrl: string;
  model: string;
  effort?: Effort | '';
}

const isLocal = (url: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/** Trims and validates form input. Throws an owner-readable Error when something is missing. */
export function buildLlmConfig(i: LlmInput): LlmConfig {
  const apiKey = i.apiKey.trim();
  const model = i.model.trim();
  if (i.protocol === 'anthropic') {
    if (!apiKey) throw new Error('Enter your Claude API key.');
    return { protocol: 'anthropic', baseUrl: '', apiKey, model: model || ANTHROPIC_DEFAULT_MODEL, effort: i.effort, label: 'Claude' };
  }
  const baseUrl = i.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Enter the provider base URL.');
  if (!apiKey && !isLocal(baseUrl)) throw new Error('Enter the API key.');
  if (!model) throw new Error('Enter a model name.');
  const label = OPENAI_PRESETS.find((p) => p.baseUrl === baseUrl)?.label ?? 'Custom';
  return { protocol: 'openai', baseUrl, apiKey, model, label };
}
