// Provider-neutral conversation format. Stored in n8n (inv_messages.content) and replayed
// to whichever adapter is configured. Provider-native blocks (Claude thinking, redacted
// thinking, fallback markers) are kept verbatim and only replayed to that provider.

export type Part =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>; invalid?: string }
  | { type: 'tool_result'; id: string; content: string; isError?: boolean }
  | { type: 'native'; provider: 'anthropic'; block: Record<string, unknown> };

export interface Message {
  role: 'user' | 'assistant';
  parts: Part[];
}

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export type Protocol = 'anthropic' | 'openai';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmConfig {
  protocol: Protocol;
  baseUrl: string; // empty = provider default (Anthropic only)
  apiKey: string;
  model: string;
  effort?: Effort | ''; // Anthropic only; '' = model default
  label?: string; // preset name for display
}

export interface TurnRequest {
  system?: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
  effort?: Effort;
  signal?: AbortSignal;
}

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface TurnResult {
  parts: Part[]; // assistant parts, in order, ready to append to history
  stop: StopReason;
  rawStop?: string;
  model?: string;
  usage?: { input?: number; output?: number; cacheRead?: number };
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'tool_start'; name: string };

export interface Llm {
  turn(req: TurnRequest, onEvent?: (e: StreamEvent) => void): Promise<TurnResult>;
}

export class LlmError extends Error {
  override name = 'LlmError';
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const textOf = (parts: Part[]) =>
  parts
    .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');

export const toolCalls = (parts: Part[]) => parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call');

/** Parses accumulated tool-call JSON strictly; invalid input is kept raw so it can be reported back. */
export function parseToolInput(raw: string): { input: Record<string, unknown>; invalid?: string } {
  if (!raw.trim()) return { input: {} };
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return { input: v as Record<string, unknown> };
  } catch {
    /* fall through */
  }
  return { input: {}, invalid: raw };
}
