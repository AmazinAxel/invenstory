// Browser-side agent loop: model turn → gated tool calls → results → repeat.

import { toolCalls, type Llm, type Message, type Part, type StreamEvent } from '../llm/types.ts';
import { runTool, toolDefs, type AgentContext, type ToolOutcome } from './tools.ts';

export interface LoopEvents {
  onText?: (delta: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDone?: (id: string, outcome: ToolOutcome) => void;
  /** Called for each message appended to the history (persist it). */
  onMessage: (m: Message) => Promise<void> | void;
}

export interface LoopOptions {
  llm: Llm;
  system: string;
  history: Message[];
  ctx: AgentContext;
  events: LoopEvents;
  signal?: AbortSignal;
  maxSteps?: number;
}

export type LoopEnd = 'done' | 'refusal' | 'max_tokens' | 'step_limit' | 'aborted';

export async function runAgent(o: LoopOptions): Promise<LoopEnd> {
  const maxSteps = o.maxSteps ?? 30;
  for (let step = 0; step < maxSteps; step++) {
    if (o.signal?.aborted) return 'aborted';
    const onEvent = (e: StreamEvent) => {
      if (e.type === 'text') o.events.onText?.(e.text);
    };
    const res = await o.llm.turn({ system: o.system, messages: o.history, tools: toolDefs, signal: o.signal }, onEvent);
    const assistant: Message = { role: 'assistant', parts: res.parts };
    if (res.parts.length) {
      o.history.push(assistant);
      await o.events.onMessage(assistant);
    }
    // A refusal can cut a tool call off mid-input: never run that turn's tools.
    if (res.stop === 'refusal') return 'refusal';
    const calls = toolCalls(res.parts);
    if (!calls.length) return res.stop === 'max_tokens' ? 'max_tokens' : 'done';

    const results: Part[] = [];
    for (const call of calls) {
      if (o.signal?.aborted) {
        results.push({ type: 'tool_result', id: call.id, content: 'Stopped by the user.', isError: true });
        continue;
      }
      let outcome: ToolOutcome;
      if (res.stop === 'max_tokens') {
        outcome = { content: 'Your tool input was cut off (output limit). Send a shorter call.', isError: true };
      } else if (call.invalid !== undefined) {
        outcome = { content: `Your tool input was not valid JSON:\n${call.invalid.slice(0, 2000)}`, isError: true };
      } else {
        o.events.onToolStart?.(call.id, call.name, call.input);
        outcome = await runTool(call.name, call.input, o.ctx);
      }
      o.events.onToolDone?.(call.id, outcome);
      results.push({ type: 'tool_result', id: call.id, content: outcome.content, isError: outcome.isError });
    }
    const user: Message = { role: 'user', parts: results };
    o.history.push(user);
    await o.events.onMessage(user);
  }
  return 'step_limit';
}
