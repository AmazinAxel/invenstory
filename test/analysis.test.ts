import { describe, expect, test } from 'bun:test';
import { ANALYSIS_RECORDS, ANALYSIS_REPLY, ANALYSIS_REQUEST } from '../src/lib/n8n/core/code.ts';
import { ANALYSIS_SCHEMA, ANALYSIS_SYSTEM, MODEL_CHOICES, OPENROUTER_ANALYSIS_MODEL, analyzeDirectWorkflow, analyzeWorkflow, directModel } from '../src/lib/n8n/core/analyze.ts';
import { adoptAnalysis, setupDirectAnalysis, type InstallInfo, type McpLike } from '../src/lib/n8n/install.ts';
import { TABLE_NAMES, type TableIds } from '../src/lib/n8n/core/schema.ts';
import { runTool, type AgentContext } from '../src/lib/agent/tools.ts';
import type { LlmConfig } from '../src/lib/llm/types.ts';
import type { Mcp, ToolResult } from '../src/lib/n8n/mcp.ts';

// Runs a Code-node source exactly as n8n would see it (minus the $-helpers).
const load = (src: string) => new Function(`${src}\nreturn run;`)() as (input: unknown) => any;

const KEY = 'not-a-real-key-0123456789abcdef';
const tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, `id_${n}`])) as TableIds;
const openrouter: LlmConfig = { protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: KEY, model: 'openrouter/auto', label: 'OpenRouter' };
const direct = directModel(openrouter)!;

describe('which model connection n8n may use for analysis', () => {
  test('an OpenRouter connection, on a small fixed model', () => {
    expect(direct).toEqual({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: KEY, model: OPENROUTER_ANALYSIS_MODEL, label: 'OpenRouter' });
    expect(directModel({ ...openrouter, baseUrl: 'https://openrouter.ai/api/v1/' })?.baseUrl).toBe('https://openrouter.ai/api/v1');
  });

  test('nothing else: other keys stay on the device and n8n cannot reach a local model', () => {
    expect(directModel(null)).toBeNull();
    expect(directModel({ ...openrouter, apiKey: ' ' })).toBeNull();
    expect(directModel({ protocol: 'anthropic', baseUrl: '', apiKey: 'not-a-real-claude-key', model: 'claude-opus-5-5' })).toBeNull();
    expect(directModel({ ...openrouter, baseUrl: 'http://localhost:11434/v1', apiKey: 'x' })).toBeNull();
    expect(directModel({ ...openrouter, baseUrl: 'https://api.openai.com/v1' })).toBeNull();
    expect(directModel({ ...openrouter, baseUrl: 'http://openrouter.ai/api/v1' })).toBeNull();
    expect(directModel({ ...openrouter, baseUrl: 'https://openrouter.ai.evil.example/api/v1' })).toBeNull();
    expect(directModel({ ...openrouter, baseUrl: 'not a url' })).toBeNull();
  });
});

describe('ANALYSIS_REQUEST', () => {
  const run = load(ANALYSIS_REQUEST);
  const now = '2026-11-15T12:00:00.000Z';
  const row = (r: Record<string, unknown>, id: number) => ({ id, createdAt: now, ...r });
  const out = run({
    products: [row({ sku: 'MUG', name: 'Blue mug', quantity: 3, reorder_point: 10, unit_cost: 4, currency: 'USD' }, 1)],
    sales: [row({ sku: 'MUG', quantity: 2, revenue: 30, currency: 'USD', sold_at: '2026-11-14T10:00:00Z' }, 2)],
    items: [],
    sessions: [],
    messages: [],
    config: [row({ key: 'base_currency', value: 'USD' }, 3)],
    registry: [row({ workflow_id: 'w1', name: 'Reorder', description: 'Orders stock', input_schema: '{"type":"object"}' }, 4)],
    period: '30d',
    now,
    model: 'some/model',
    system: ANALYSIS_SYSTEM,
    schema: ANALYSIS_SCHEMA,
  });

  test('keeps the facts and registry the later nodes read', () => {
    expect(JSON.parse(out.facts).low_or_out_of_stock).toEqual([{ sku: 'MUG', name: 'Blue mug', quantity: 3, reorder_point: 10 }]);
    expect(out.registry).toEqual([{ workflow_id: 'w1', name: 'Reorder', description: 'Orders stock', input_schema: { type: 'object' } }]);
  });

  test('builds a chat-completions body with the same prompt and a JSON-only instruction', () => {
    expect(out.body.model).toBe('some/model');
    expect(out.body.response_format).toEqual({ type: 'json_object' });
    const [system, user] = out.body.messages;
    expect(system.role).toBe('system');
    expect(system.content.startsWith(ANALYSIS_SYSTEM)).toBe(true);
    expect(system.content).toContain('JSON');
    expect(system.content).toContain(JSON.stringify(ANALYSIS_SCHEMA));
    expect(user).toEqual({ role: 'user', content: `Facts:\n${out.facts}\n\nRegistered actions:\n${out.registry_json}` });
  });
});

describe('ANALYSIS_REPLY', () => {
  const run = load(ANALYSIS_REPLY);
  const reply = (content: unknown, finish = 'stop') => ({ response: { choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] } });
  const answer = { insight: 'Mugs are low.', items: [{ title: 'Reorder mugs', detail: '3 left', kind: 'draft' }] };

  test('reads plain, fenced and prose-wrapped JSON', () => {
    expect(run(reply(JSON.stringify(answer)))).toEqual({ output: answer });
    expect(run(reply('```json\n' + JSON.stringify(answer, null, 2) + '\n```'))).toEqual({ output: answer });
    expect(run(reply(`Here you go:\n${JSON.stringify(answer)}\nAnything else?`))).toEqual({ output: answer });
    expect(run(reply([{ type: 'text', text: JSON.stringify(answer) }]))).toEqual({ output: answer });
    expect(run({ response: JSON.stringify(reply(JSON.stringify(answer)).response) })).toEqual({ output: answer });
  });

  test('fails loudly instead of saving an empty insight', () => {
    expect(() => run({ response: { error: { message: 'Insufficient credits', code: 402 } } })).toThrow(/Insufficient credits/);
    expect(() => run(reply('Sorry, I cannot help with that.'))).toThrow(/did not answer with JSON/);
    expect(() => run(reply('[1, 2]'))).toThrow(/did not answer with JSON/);
    expect(() => run(reply('{"insight": "cut o', 'length'))).toThrow(/ran out of room/);
    expect(() => run({})).toThrow(/did not answer with JSON/);
  });

  test('its output is what Build Records expects', () => {
    const records = load(ANALYSIS_RECORDS)({ ...run(reply(JSON.stringify(answer))), registry: [], now: '2026-11-15T12:00:00.000Z', uuid: 'u1', execution_id: '7' });
    expect(records.session).toEqual({ session_id: 'a-u1', created_at: '2026-11-15T12:00:00.000Z', origin: 'analysis', execution_id: '7' });
    expect(JSON.parse(records.message.content)).toEqual({ type: 'insight', text: 'Mugs are low.', item_ids: ['a-u1-1'], invest: [] });
    expect(records.items[0]).toMatchObject({ title: 'Reorder mugs', kind: 'draft', draft_channel: 'email', status: 'open' });
  });
});

describe('analysis workflow templates', () => {
  const code = analyzeDirectWorkflow({ tables, notifyId: 'notify1', direct });

  test('the direct variant calls the provider over HTTP and needs no n8n credential', () => {
    expect(code).toContain('"https://openrouter.ai/api/v1/chat/completions"');
    expect(code).toContain('"n8n-nodes-base.httpRequest"');
    expect(code).toContain('.to(facts)\n  .to(analyst)\n  .to(reply)\n  .to(records)');
    expect(code).toContain(JSON.stringify(OPENROUTER_ANALYSIS_MODEL));
    expect(code).toContain('"id_inv_action_items"');
    expect(code).not.toContain('langchain');
    expect(code).not.toContain('credentials:');
    expect(code).not.toContain('"undefined"');
  });

  test('the key appears exactly once, in the request header', () => {
    expect(code.split(KEY)).toHaveLength(2);
    expect(code).toContain(`{ name: "Authorization", value: "Bearer ${KEY}" }`);
  });

  test('the credential variant is still an LLM chain bound to an n8n credential', () => {
    const chain = analyzeWorkflow({ tables, notifyId: 'notify1', choice: MODEL_CHOICES[0]!, credential: { id: 'c1', name: 'Mine' }, model: '' });
    expect(chain).toContain('@n8n/n8n-nodes-langchain.chainLlm');
    expect(chain).toContain('credentials: { anthropicApi: { id: "c1", name: "Mine" } }');
    expect(chain).not.toContain('httpRequest');
    expect(chain).toContain('.to(facts)\n  .to(analyst)\n  .to(records)');
  });
});

// ---------- installer ----------

const info = {
  base: 'https://x.app.n8n.cloud',
  projectId: 'p1',
  version: 2,
  apiUrl: 'https://x.app.n8n.cloud/webhook/inv-1',
  tables,
  workflows: { api: 'core-api', notify: 'core-notify', error: 'core-error' },
  origins: [],
  vapidPublicKey: 'k',
} as InstallInfo;

function fakeN8n(o: { validate?: unknown; workflows?: { id: string; name: string; isArchived?: boolean }[]; config?: Record<string, string> } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const mcp: McpLike = {
    call: async <T>(name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === 'validate_workflow') return (o.validate ?? { valid: true }) as T;
      if (name === 'create_workflow_from_code') return { workflowId: 'new-analyze' } as T;
      if (name === 'search_workflows') return { data: o.workflows ?? [] } as T;
      if (name === 'get_data_table_rows') {
        const rows = Object.entries(o.config ?? {}).map(([key, value], i) => ({ id: i + 1, key, value }));
        return { rows, count: rows.length } as T;
      }
      return { ok: true } as T;
    },
  };
  return { mcp, calls, names: () => calls.map((c) => c.name) };
}

describe('setupDirectAnalysis', () => {
  test('validates, creates, publishes, wires failures, retires the old one and records it', async () => {
    const n8n = fakeN8n();
    const steps: string[] = [];
    const out = await setupDirectAnalysis(n8n.mcp, { ...info, workflows: { ...info.workflows, analyze: 'old-analyze' } }, direct, (m) => steps.push(m));
    expect(n8n.names()).toEqual(['validate_workflow', 'create_workflow_from_code', 'publish_workflow', 'update_workflow', 'archive_workflow', 'add_data_table_rows']);
    expect(n8n.calls[3]!.args).toEqual({ workflowId: 'new-analyze', operations: [{ type: 'setWorkflowSettings', settings: { errorWorkflow: 'core-error' } }] });
    expect(n8n.calls[4]!.args).toEqual({ workflowId: 'old-analyze' });
    expect(out.workflows.analyze).toBe('new-analyze');
    expect(out.analysisModel).toBe(`OpenRouter: ${OPENROUTER_ANALYSIS_MODEL}`);
    expect(steps).toEqual(['Installing analysis…', 'Analysis ready.']);
  });

  test('the key goes into the workflow code and nowhere else', async () => {
    const n8n = fakeN8n();
    await setupDirectAnalysis(n8n.mcp, info, direct);
    for (const c of n8n.calls) {
      const carriesKey = JSON.stringify(c.args).includes(KEY);
      expect(carriesKey).toBe(c.name === 'validate_workflow' || c.name === 'create_workflow_from_code');
    }
    const config = n8n.calls.find((c) => c.name === 'add_data_table_rows')!.args;
    expect(config.dataTableId).toBe('id_inv_config');
    expect(config.rows).toEqual([
      { key: 'analyze_workflow_id', value: 'new-analyze' },
      { key: 'analysis_model', value: `OpenRouter: ${OPENROUTER_ANALYSIS_MODEL}` },
    ]);
  });

  test('an error that quotes the workflow code never shows the key', async () => {
    const n8n = fakeN8n({ validate: { valid: false, errors: [`bad header value "Bearer ${KEY}"`] } });
    const err = await setupDirectAnalysis(n8n.mcp, info, direct).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).toContain('failed validation');
    expect(err?.message).not.toContain(KEY);
    expect(n8n.names()).toEqual(['validate_workflow']);
  });

  test('needs the core install', async () => {
    await expect(setupDirectAnalysis(fakeN8n().mcp, { ...info, workflows: {} }, direct)).rejects.toThrow(/Install Invenstory first/);
  });
});

describe('adoptAnalysis', () => {
  test('nothing to adopt', async () => {
    const n8n = fakeN8n({ workflows: [{ id: 'a', name: 'invenstory-analyze', isArchived: true }, { id: 'b', name: 'Invenstory · analyze copy' }] });
    expect(await adoptAnalysis(n8n.mcp, info)).toBeNull();
    expect(n8n.names()).toEqual(['search_workflows']);
  });

  test('uses the analysis another device set up, without writing anything', async () => {
    const n8n = fakeN8n({ workflows: [{ id: 'theirs', name: 'invenstory-analyze' }], config: { analyze_workflow_id: 'theirs' } });
    expect((await adoptAnalysis(n8n.mcp, info))?.workflows.analyze).toBe('theirs');
    expect(n8n.names()).toEqual(['search_workflows', 'get_data_table_rows']);
  });

  test('finishes an interrupted setup', async () => {
    const n8n = fakeN8n({ workflows: [{ id: 'half', name: 'invenstory-analyze' }], config: { version: '2' } });
    expect((await adoptAnalysis(n8n.mcp, info))?.workflows.analyze).toBe('half');
    expect(n8n.names()).toEqual(['search_workflows', 'get_data_table_rows', 'update_workflow', 'add_data_table_rows']);
    expect(n8n.calls[3]!.args.rows).toEqual([{ key: 'analyze_workflow_id', value: 'half' }]);
  });
});

// ---------- the chat agent must never see a core workflow ----------

describe('core workflows are private to the app', () => {
  const secretWorkflow = { id: 'x', name: 'invenstory-analyze', nodes: [{ name: 'Analyst', type: 'n8n-nodes-base.httpRequest', parameters: { headerParameters: { parameters: [{ name: 'Authorization', value: `Bearer ${KEY}` }] } } }] };
  function agent(workflows: Record<string, unknown>) {
    const calls: string[] = [];
    const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
    const handle = (name: string, args: Record<string, unknown>): ToolResult => {
      calls.push(name);
      if (name === 'get_workflow_details') return workflows[String(args.workflowId)] ? ok({ workflow: workflows[String(args.workflowId)] }) : { content: [{ type: 'text', text: 'not found' }], isError: true };
      return ok({ execution: { status: 'error' }, data: { resultData: { error: { node: secretWorkflow.nodes[0] } } } });
    };
    const mcp = { callTool: async (n: string, a: Record<string, unknown>) => handle(n, a), call: async (n: string, a: Record<string, unknown>) => handle(n, a).structuredContent } as unknown as Mcp;
    const ctx: AgentContext = { mcp, install: { ...info, workflows: { ...info.workflows, analyze: 'core-analyze' } } };
    return { ctx, calls };
  }

  test('reading a core workflow by id is refused before n8n is asked', async () => {
    const { ctx, calls } = agent({ 'core-analyze': secretWorkflow });
    for (const id of ['core-analyze', 'core-notify', 'core-api', 'core-error']) {
      const r = await runTool('n8n_get_workflow', { workflowId: id }, ctx);
      expect(r.refused).toBe(true);
      expect(r.content).not.toContain(KEY);
    }
    expect(calls).toEqual([]);
  });

  test('a core workflow this device does not know by id is recognised by name', async () => {
    const { ctx } = agent({ elsewhere: secretWorkflow, mine: { id: 'mine', name: 'Invenstory · Sheets sync', nodes: [] } });
    const refused = await runTool('n8n_get_workflow', { workflowId: 'elsewhere' }, ctx);
    expect(refused.refused).toBe(true);
    expect(refused.content).not.toContain(KEY);
    const fine = await runTool('n8n_get_workflow', { workflowId: 'mine' }, ctx);
    expect(fine.isError).toBeFalsy();
    expect(fine.content).toContain('Sheets sync');
  });

  test('run data of a core workflow is refused too (a failed run carries the node parameters)', async () => {
    const { ctx, calls } = agent({});
    const r = await runTool('n8n_get_execution', { workflowId: 'core-analyze', executionId: '9', includeData: true }, ctx);
    expect(r.refused).toBe(true);
    expect(r.content).not.toContain(KEY);
    expect(calls).toEqual([]);
  });
});
