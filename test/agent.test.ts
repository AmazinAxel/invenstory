import { describe, expect, test } from 'bun:test';
import { runAgent } from '../src/lib/agent/loop.ts';
import { runTool, toolDefs, validateInput, NAME_PREFIX, type AgentContext } from '../src/lib/agent/tools.ts';
import { fromStored } from '../src/state/chat-history.ts';
import type { Llm, Message, TurnResult } from '../src/lib/llm/types.ts';
import type { Mcp, ToolResult } from '../src/lib/n8n/mcp.ts';
import type { InstallInfo } from '../src/lib/n8n/install.ts';

const install = {
  base: 'https://x.app.n8n.cloud',
  projectId: 'p1',
  version: 1,
  apiUrl: 'https://x.app.n8n.cloud/webhook/inv-1',
  tables: { inv_actions: 'tA', inv_messages: 'tM' },
  workflows: { api: 'core-api', notify: 'core-notify', error: 'core-error', analyze: 'core-analyze' },
  origins: [],
  vapidPublicKey: 'k',
} as unknown as InstallInfo;

type Wf = { id: string; name: string; active?: boolean; nodes: { name: string; type: string; parameters?: Record<string, unknown> }[] };

function fakeMcp(workflows: Record<string, Wf>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  const handle = (name: string, args: Record<string, unknown>): ToolResult => {
    calls.push({ name, args });
    switch (name) {
      case 'get_workflow_details': {
        const w = workflows[String(args.workflowId)];
        if (!w) return { content: [{ type: 'text', text: 'not found' }], isError: true };
        return ok({ workflow: w });
      }
      case 'validate_workflow':
        return ok({ valid: true });
      case 'create_workflow_from_code': {
        const id = `w${Object.keys(workflows).length}`;
        const bad = String(args.code).includes('gmail');
        workflows[id] = {
          id,
          name: String(args.name),
          nodes: bad ? [{ name: 'Mail', type: 'n8n-nodes-base.gmail', parameters: { operation: 'send' } }] : [{ name: 'Set', type: 'n8n-nodes-base.set' }],
        };
        return ok({ workflowId: id });
      }
      default:
        return ok({ ok: true });
    }
  };
  const mcp = {
    callTool: async (name: string, args: Record<string, unknown>) => handle(name, args),
    call: async (name: string, args: Record<string, unknown>) => {
      const r = handle(name, args);
      if (r.isError) throw new Error(r.content[0]!.text);
      return r.structuredContent;
    },
  } as unknown as Mcp;
  return { mcp, calls };
}

describe('tool wrapper', () => {
  test('create adds the prefix, wires the error workflow and runs the gate', async () => {
    const { mcp, calls } = fakeMcp({});
    const ctx: AgentContext = { mcp, install };
    const good = await runTool('n8n_create_workflow', { code: 'set', name: 'Sheets sync', description: 'd' }, ctx);
    expect(good.isError).toBeFalsy();
    expect(JSON.parse(good.content).name).toBe(`${NAME_PREFIX}Sheets sync`);
    expect(calls.some((c) => c.name === 'update_workflow' && JSON.stringify(c.args).includes('core-error'))).toBe(true);
    const bad = await runTool('n8n_create_workflow', { code: 'gmail', name: 'Mailer', description: 'd' }, ctx);
    expect(bad.refused).toBe(true);
    expect(bad.content).toContain('safety gate');
  });

  test('publish is gated and refuses core or foreign workflows', async () => {
    const { mcp, calls } = fakeMcp({
      ok: { id: 'ok', name: `${NAME_PREFIX}A`, nodes: [{ name: 'S', type: 'n8n-nodes-base.set' }] },
      bad: { id: 'bad', name: `${NAME_PREFIX}B`, nodes: [{ name: 'H', type: 'n8n-nodes-base.httpRequest', parameters: { method: 'POST' } }] },
      mine: { id: 'mine', name: 'Someone else', nodes: [] },
    });
    const ctx: AgentContext = { mcp, install };
    expect((await runTool('n8n_publish_workflow', { workflowId: 'ok' }, ctx)).isError).toBeFalsy();
    const refused = await runTool('n8n_publish_workflow', { workflowId: 'bad' }, ctx);
    expect(refused.refused).toBe(true);
    expect((await runTool('n8n_publish_workflow', { workflowId: 'core-api' }, ctx)).content).toMatch(/Core/);
    expect((await runTool('n8n_publish_workflow', { workflowId: 'mine' }, ctx)).content).toMatch(/Only workflows created by Invenstory/);
    expect(calls.filter((c) => c.name === 'publish_workflow').map((c) => c.args.workflowId)).toEqual(['ok']);
  });

  test('register requires a published workflow with an Execute Workflow Trigger', async () => {
    const { mcp, calls } = fakeMcp({
      a: { id: 'a', name: `${NAME_PREFIX}Act`, active: true, nodes: [{ name: 'T', type: 'n8n-nodes-base.executeWorkflowTrigger' }] },
      draft: { id: 'draft', name: `${NAME_PREFIX}D`, active: false, nodes: [{ name: 'T', type: 'n8n-nodes-base.executeWorkflowTrigger' }] },
    });
    const ctx: AgentContext = { mcp, install };
    expect((await runTool('invenstory_register_action', { workflowId: 'draft', name: 'n', description: 'd', inputSchema: {} }, ctx)).content).toMatch(/Publish/);
    expect((await runTool('invenstory_register_action', { workflowId: 'a', name: 'n', description: 'd', inputSchema: {} }, ctx)).isError).toBeFalsy();
    expect(calls.find((c) => c.name === 'add_data_table_rows')?.args.dataTableId).toBe('tA');
  });

  test('input validation', () => {
    const def = toolDefs.find((d) => d.name === 'invenstory_read_table')!;
    expect(validateInput(def, {})).toMatch(/missing/);
    expect(validateInput(def, { table: 'inv_sales', limit: 1.5 })).toMatch(/integer/);
    expect(validateInput(def, { table: 'inv_sales', extra: 1 })).toMatch(/unknown/);
    expect(validateInput(def, { table: 'inv_sales', limit: 5 })).toBeNull();
  });
});

describe('agent loop', () => {
  const script = (turns: TurnResult[]): Llm => {
    let i = 0;
    return { turn: async () => turns[i++] ?? { parts: [{ type: 'text', text: 'end' }], stop: 'end' } };
  };

  test('runs tools, feeds results back, persists every message', async () => {
    const { mcp } = fakeMcp({});
    const saved: Message[] = [];
    const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
    const end = await runAgent({
      llm: script([
        { parts: [{ type: 'tool_call', id: 't1', name: 'invenstory_tables', input: {} }], stop: 'tool_use' },
        { parts: [{ type: 'text', text: 'done' }], stop: 'end' },
      ]),
      system: 's',
      history,
      ctx: { mcp, install },
      events: { onMessage: (m) => void saved.push(m) },
    });
    expect(end).toBe('done');
    expect(saved.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(saved[1]!.parts[0]).toMatchObject({ type: 'tool_result', id: 't1' });
  });

  test('invalid JSON is returned as an error; refusal stops without running tools', async () => {
    const { mcp, calls } = fakeMcp({});
    const saved: Message[] = [];
    await runAgent({
      llm: script([{ parts: [{ type: 'tool_call', id: 'x', name: 'n8n_list_credentials', input: {}, invalid: '{"a' }], stop: 'tool_use' }]),
      system: 's',
      history: [],
      ctx: { mcp, install },
      events: { onMessage: (m) => void saved.push(m) },
    });
    expect(saved[1]!.parts[0]).toMatchObject({ type: 'tool_result', isError: true });
    expect(calls).toHaveLength(0);
    const end = await runAgent({
      llm: script([{ parts: [{ type: 'tool_call', id: 'y', name: 'n8n_list_credentials', input: {} }], stop: 'refusal' }]),
      system: 's',
      history: [],
      ctx: { mcp, install },
      events: { onMessage: () => {} },
    });
    expect(end).toBe('refusal');
    expect(calls).toHaveLength(0);
  });
});

describe('stored history', () => {
  test('analysis sessions start with a synthetic user turn; parts round-trip', () => {
    const parts = [{ type: 'text' as const, text: 'q' }];
    const h = fromStored('analysis', [
      { role: 'assistant', created_at: '', content: { type: 'insight', text: 'Sales up' } },
      { role: 'user', created_at: '', content: { type: 'parts', parts } },
      { role: 'tool', created_at: '', content: { type: 'action_result', item_id: 'i1', output: [{ a: 1 }] } },
    ]);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(h[2]!.parts).toEqual(parts);
  });
});

import { repairHistory } from '../src/state/chat-history.ts';
describe('repairHistory', () => {
  const call = (id: string) => ({ type: 'tool_call' as const, id, name: 'n', input: {} });
  const res = (id: string) => ({ type: 'tool_result' as const, id, content: 'ok' });
  test('adds results for unanswered calls before the next user text, deterministically', () => {
    const h: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', parts: [call('a'), call('b')] },
      { role: 'user', parts: [{ type: 'text', text: 'hello?' }] },
    ];
    const r = repairHistory(h);
    expect(r).toHaveLength(3);
    expect(r[2]!.parts.map((p) => (p.type === 'tool_result' ? `r:${p.id}` : p.type))).toEqual(['r:a', 'r:b', 'text']);
    expect(repairHistory(h)).toEqual(r);
  });
  test('partial answers are completed; a trailing call gets its own message; complete history is untouched', () => {
    const r = repairHistory([
      { role: 'assistant', parts: [call('a'), call('b')] },
      { role: 'user', parts: [res('a')] },
      { role: 'assistant', parts: [call('c')] },
    ]);
    expect(r[1]!.parts.map((p) => (p.type === 'tool_result' ? p.id : ''))).toEqual(['a', 'b']);
    expect(r[3]).toMatchObject({ role: 'user', parts: [{ type: 'tool_result', id: 'c', isError: true }] });
    const ok: Message[] = [{ role: 'assistant', parts: [call('x')] }, { role: 'user', parts: [res('x')] }];
    expect(repairHistory(ok)).toEqual(ok);
  });
});

import { chatTurns, SNAPSHOT_MARK } from '../src/state/chat-history.ts';
describe('chatTurns', () => {
  const call = (id: string) => ({ type: 'tool_call' as const, id, name: 'n', input: {} });
  const res = (id: string, content = 'ok', isError = false) => ({ type: 'tool_result' as const, id, content, isError });
  const text = (t: string) => ({ type: 'text' as const, text: t });

  test('one assistant turn spans tool rounds; last text wins, narration hidden', () => {
    const h: Message[] = [
      { role: 'user', parts: [text('Sync my sheet')] },
      { role: 'assistant', parts: [text('Let me look.'), call('a')] },
      { role: 'user', parts: [res('a')] },
      { role: 'assistant', parts: [call('b')] },
      { role: 'user', parts: [res('b', 'Refused by the safety gate', true)] },
      { role: 'assistant', parts: [text('Ready to publish?\nOptions: Yes | Not yet')] },
      { role: 'user', parts: [text('Yes')] },
    ];
    expect(chatTurns(h)).toEqual([
      { user: 'Sync my sheet' },
      { calls: [call('a'), call('b')], text: 'Ready to publish?\nOptions: Yes | Not yet' },
      { user: 'Yes' },
    ]);
  });

  test('a turn without final text keeps earlier text; snapshot text never shows', () => {
    const h: Message[] = [
      { role: 'user', parts: [text(`${SNAPSHOT_MARK} at x]\n{}`), text('How are sales?')] },
      { role: 'assistant', parts: [text('Checking.'), call('a')] },
      { role: 'user', parts: [res('a')] },
      { role: 'assistant', parts: [call('b')] },
    ];
    expect(chatTurns(h)).toEqual([{ user: 'How are sales?' }, { calls: [call('a'), call('b')], text: 'Checking.' }]);
  });

  test('a snapshot-only user message does not split turns or show', () => {
    const h: Message[] = [
      { role: 'assistant', parts: [text('Hi')] },
      { role: 'user', parts: [text(`${SNAPSHOT_MARK}]`)] },
      { role: 'assistant', parts: [text('Again')] },
    ];
    expect(chatTurns(h)).toEqual([{ calls: [], text: 'Again' }]);
  });
});

import { shouldAdopt } from '../src/state/chat-history.ts';
describe('shouldAdopt (summary session vs. current chat)', () => {
  const sess = (id: string, at: string, n: number) => ({ session_id: id, created_at: at, messageCount: n });
  const cur = { sessionId: 'c-1', storedCount: 2 };
  const none = { sessionId: null, storedCount: 0 };
  const reset = Date.parse('2026-11-15T10:00:00Z');

  test('without a reset: adopts a different session or more messages, ignores an unchanged one', () => {
    expect(shouldAdopt(cur, sess('a-9', '2026-11-15T09:00:00Z', 1), null)).toBe(true);
    expect(shouldAdopt(cur, sess('c-1', '2026-11-15T09:00:00Z', 3), null)).toBe(true);
    expect(shouldAdopt(cur, sess('c-1', '2026-11-15T09:00:00Z', 2), null)).toBe(false);
  });

  test('after a reset: the old session stays hidden', () => {
    expect(shouldAdopt(none, sess('c-1', '2026-11-15T09:00:00Z', 4), reset)).toBe(false);
  });

  test('after a reset: a session created later (analysis or the new chat) is adopted', () => {
    expect(shouldAdopt(none, sess('a-2', '2026-11-15T11:00:00Z', 1), reset)).toBe(true);
    expect(shouldAdopt({ sessionId: 'c-2', storedCount: 1 }, sess('c-2', '2026-11-15T10:05:00Z', 2), reset)).toBe(true);
    expect(shouldAdopt({ sessionId: 'c-2', storedCount: 2 }, sess('c-2', '2026-11-15T10:05:00Z', 2), reset)).toBe(false);
  });

  test('after a reset: equal or unparseable timestamps are not adopted', () => {
    expect(shouldAdopt(none, sess('c-1', '2026-11-15T10:00:00Z', 4), reset)).toBe(false);
    expect(shouldAdopt(none, sess('c-1', 'garbage', 4), reset)).toBe(false);
  });
});
