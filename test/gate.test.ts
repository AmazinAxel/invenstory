import { describe, expect, test } from 'bun:test';
import { checkNode, checkWorkflow, describeViolations, type GateWorkflow } from '../src/lib/n8n/gate.ts';

const node = (type: string, parameters: Record<string, unknown> = {}, name = 'N') => ({ name, type: `n8n-nodes-base.${type}`, parameters });

describe('checkNode', () => {
  test('core nodes pass', () => {
    for (const t of ['set', 'if', 'dataTable', 'scheduleTrigger', 'webhook', 'merge']) expect(checkNode(node(t)).violation).toBeUndefined();
    expect(checkNode({ name: 'm', type: '@n8n/n8n-nodes-langchain.lmChatAnthropic' }).violation).toBeUndefined();
  });

  test('unknown, community and refused types are denied', () => {
    expect(checkNode(node('somethingNew')).violation).toMatch(/unknown/);
    expect(checkNode({ name: 'c', type: 'n8n-nodes-acme.acme' }).violation).toMatch(/unknown/);
    expect(checkNode(node('executeCommand')).violation).toMatch(/never/);
    expect(checkNode({ name: 'mcp', type: '@n8n/n8n-nodes-langchain.mcpClientTool' }).violation).toMatch(/never/);
    expect(checkNode(node('emailSend')).violation).toMatch(/never/);
  });

  test('business nodes: writes allowed, sending refused', () => {
    expect(checkNode(node('googleSheets', { operation: 'append' })).violation).toBeUndefined();
    expect(checkNode(node('shopify', { resource: 'product', operation: 'update' })).violation).toBeUndefined();
    expect(checkNode(node('shopifyTrigger')).violation).toBeUndefined();
    expect(checkNode(node('hubspot', { resource: 'engagement', operation: 'sendEmail' })).violation).toMatch(/send/);
    expect(checkNode(node('wooCommerce', { resource: 'order', operation: '={{ $json.op }}' })).violation).toMatch(/expression/);
  });

  test('messaging nodes: triggers and reads only', () => {
    expect(checkNode(node('gmailTrigger')).violation).toBeUndefined();
    expect(checkNode(node('gmail', { resource: 'message', operation: 'getAll' })).violation).toBeUndefined();
    expect(checkNode(node('gmail', { resource: 'message', operation: 'send' })).violation).toMatch(/only read/);
    expect(checkNode(node('gmail', { resource: 'message', operation: 'reply' })).violation).toMatch(/only read/);
    expect(checkNode(node('slack', {})).violation).toMatch(/explicit read/);
    expect(checkNode(node('telegram', { operation: 'sendMessage' })).violation).toMatch(/only read/);
  });

  test('HTTP Request: GET only, default GET, no expressions', () => {
    expect(checkNode(node('httpRequest', { url: 'https://x' })).violation).toBeUndefined();
    expect(checkNode(node('httpRequest', { method: 'GET' })).violation).toBeUndefined();
    expect(checkNode(node('httpRequest', { method: 'POST' })).violation).toMatch(/GET/);
    expect(checkNode(node('httpRequest', { method: '={{ "GET" }}' })).violation).toMatch(/expression/);
  });

  test('Code: no modules or network', () => {
    expect(checkNode(node('code', { jsCode: 'return $input.all().map(i => ({ json: { a: 1 } }));' })).violation).toBeUndefined();
    for (const src of [
      "const c = require('crypto')",
      'await fetch("https://x")',
      'this.helpers.httpRequest({ url })',
      'const m = await import("x")',
      'process.env.X',
      'new Function("return fetch")()',
    ]) {
      expect(checkNode(node('code', { jsCode: src })).violation).toMatch(/Code may not/);
    }
    expect(checkNode(node('code', { language: 'pythonNative', pythonCode: 'import requests\nrequests.get(u)' })).violation).toMatch(/Code may not/);
  });

  test('Execute Sub-workflow needs a fixed id', () => {
    expect(checkNode(node('executeWorkflow', { source: 'database', workflowId: { __rl: true, mode: 'id', value: 'abc' } }))).toEqual({ target: 'abc' });
    expect(checkNode(node('executeWorkflow', { workflowId: { __rl: true, value: '={{ $json.id }}' } })).violation).toMatch(/fixed/);
    expect(checkNode(node('executeWorkflow', { source: 'parameter', workflowJson: '{}' })).violation).toMatch(/fixed/);
  });
});

describe('checkWorkflow', () => {
  const wf = (id: string, nodes: GateWorkflow['nodes']): GateWorkflow => ({ id, name: id, nodes });
  const store: Record<string, GateWorkflow> = {
    good: wf('good', [node('set')]),
    bad: wf('bad', [node('gmail', { operation: 'send' }, 'Mail supplier')]),
    loop: wf('loop', [node('executeWorkflow', { workflowId: { __rl: true, value: 'loop' } })]),
  };
  const ctx = { trustedTargets: new Set(['core-analyze']), load: async (id: string) => store[id] ?? Promise.reject(new Error('nope')) };
  const call = (target: string) => node('executeWorkflow', { workflowId: { __rl: true, mode: 'id', value: target } }, `Call ${target}`);

  test('trusted core targets are not loaded', async () => {
    expect(await checkWorkflow(wf('w', [call('core-analyze')]), ctx)).toEqual([]);
  });
  test('sub-workflows are gated recursively', async () => {
    expect(await checkWorkflow(wf('w', [call('good')]), ctx)).toEqual([]);
    const v = await checkWorkflow(wf('w', [call('bad')]), ctx);
    expect(v).toHaveLength(1);
    expect(v[0]!.node).toBe('bad › Mail supplier');
  });
  test('cycles terminate and missing targets are violations', async () => {
    expect(await checkWorkflow(wf('w', [call('loop')]), ctx)).toEqual([]);
    expect((await checkWorkflow(wf('w', [call('missing')]), ctx))[0]!.reason).toMatch(/could not be loaded/);
  });
  test('disabled nodes are ignored and the message explains the refusal', async () => {
    const v = await checkWorkflow(wf('w', [{ ...node('gmail', { operation: 'send' }), disabled: true }, node('httpRequest', { method: 'POST' }, 'Post')]), ctx);
    expect(v).toHaveLength(1);
    expect(describeViolations(v)).toContain('Post (n8n-nodes-base.httpRequest): HTTP Request must use GET');
  });
});
