import { describe, expect, test } from 'bun:test';
import { generateVapid, install, type McpLike } from '../src/lib/n8n/install.ts';
import { signPushCode } from '../src/lib/n8n/core/code.ts';
import { BUILD_SUMMARY_CODE, SUMMARY_SALES_SINCE } from '../src/lib/n8n/core/templates.ts';
import { dtGet, ex } from '../src/lib/n8n/core/sdk.ts';
import { CORE_VERSION, TABLE_NAMES, WORKFLOWS } from '../src/lib/n8n/core/schema.ts';

type Call = { name: string; args: Record<string, unknown> };

/** Fake n8n with every core table and workflow installed at `version`. */
async function fakeN8n(version: string) {
  const keys = await generateVapid();
  const calls: Call[] = [];
  const responses: Record<string, (a: Record<string, unknown>) => unknown> = {
    search_projects: () => ({ data: [{ id: 'p1', type: 'personal' }] }),
    search_data_tables: () => ({ data: TABLE_NAMES.map((name) => ({ id: `t-${name}`, name, projectId: 'p1' })) }),
    search_workflows: () => ({ data: Object.entries(WORKFLOWS).map(([key, name]) => ({ id: `w-${key}`, name })) }),
    get_data_table_rows: () => {
      const rows = [
        { id: 1, key: 'version', value: version },
        { id: 2, key: 'vapid_public_key', value: keys.publicKey },
        { id: 3, key: 'base_currency', value: 'USD' },
        { id: 4, key: 'notify_workflow_id', value: 'w-notify' },
      ];
      return { rows, count: rows.length };
    },
    get_workflow_details: (a) =>
      a.workflowId === 'w-api'
        ? { workflow: { nodes: [{ name: 'Read API', type: 'n8n-nodes-base.webhook', parameters: { path: 'inv-test', options: { allowedOrigins: 'https://app.test' } } }] } }
        : { workflow: { nodes: [{ name: 'Sign Push', type: 'n8n-nodes-base.code', parameters: { jsCode: signPushCode(keys.privateJwk, keys.publicKey) } }] } },
  };
  const mcp: McpLike = {
    async call<T>(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      return (responses[name]?.(args) ?? {}) as T;
    },
  };
  return { mcp, calls };
}

const run = (mcp: McpLike) => install(mcp, { base: 'https://n8n.test', origin: 'https://app.test', baseCurrency: 'usd' });
const updates = (calls: Call[]) => calls.filter((c) => c.name === 'update_workflow').map((c) => c.args);

describe('upgradeCore', () => {
  test('v2 → v3 patches the summary nodes of invenstory-api in place and records the version', async () => {
    const { mcp, calls } = await fakeN8n('2');
    const info = await run(mcp);
    expect(info.version).toBe(CORE_VERSION);
    expect(info.apiUrl).toBe('https://n8n.test/webhook/inv-test');
    expect(updates(calls)).toEqual([
      {
        workflowId: 'w-api',
        operations: [
          { type: 'setNodeParameter', nodeName: 'Summary Sales', path: '/filters/conditions/0/keyValue', value: `=${SUMMARY_SALES_SINCE}` },
          { type: 'setNodeParameter', nodeName: 'Build Summary', path: '/jsCode', value: BUILD_SUMMARY_CODE },
        ],
      },
    ]);
    expect(calls.some((c) => c.name === 'publish_workflow' && c.args.workflowId === 'w-api')).toBe(true);
    expect(calls.some((c) => c.name === 'create_workflow_from_code')).toBe(false);
    const added = calls.find((c) => c.name === 'add_data_table_rows')?.args.rows;
    expect(added).toEqual([{ key: 'version', value: String(CORE_VERSION) }]);
  });

  test('v1 also re-signs the notify workflow with its existing keys', async () => {
    const { mcp, calls } = await fakeN8n('1');
    await run(mcp);
    expect(updates(calls).map((u) => u.workflowId)).toEqual(['w-notify', 'w-api']);
  });

  test('a current install changes nothing', async () => {
    const { mcp, calls } = await fakeN8n(String(CORE_VERSION));
    await run(mcp);
    expect(updates(calls)).toEqual([]);
    expect(calls.some((c) => c.name === 'add_data_table_rows')).toBe(false);
  });

  test('the patched parameter path exists on the Summary Sales node', () => {
    const node = dtGet('sumSales', 'Summary Sales', 't', { where: [['sold_at', 'gte', ex(SUMMARY_SALES_SINCE)]] });
    const filters = node.parameters?.filters as { conditions: { keyValue: unknown }[] };
    expect(filters.conditions[0]!.keyValue).toEqual(ex(SUMMARY_SALES_SINCE));
  });
});
