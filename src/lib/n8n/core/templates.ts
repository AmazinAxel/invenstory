// Deterministic SDK-code templates for the core workflows (no LLM involved).

import { ANALYSIS_TARGET, NOTICE, PREPARE_RUN, STOCK, SUMMARY, codeNode, signPushCode } from './code.ts';
import { WORKFLOWS, type TableIds } from './schema.ts';
import { code, dtDelete, dtGet, dtInsert, dtUpdate, ex, ifOk, program, respond, runSub, switchOn, type NodeSpec } from './sdk.ts';

const READ = 'Read API';
const WRITE = 'Write API';
const all = (node: string) => `$('${node}').all().map(function (i) { return i.json; })`;
const PERIOD_DAYS = `({ '7d': 7, '30d': 30, '90d': 90 })[$('${READ}').first().json.query.period] || 30`;

/** Summary reads two periods of sales: the current one and the one before it (per-product comparison). */
export const SUMMARY_SALES_SINCE = `{{ $now.minus({ days: 2 * (${PERIOD_DAYS}) }).toISO() }}`;
export const BUILD_SUMMARY_CODE = codeNode(
  SUMMARY,
  `{ products: ${all('Summary Products')}, sales: ${all('Summary Sales')}, items: ${all('Open Items')}, sessions: ${all('Newest Session')}, messages: ${all('Session Messages')}, config: ${all('Summary Config')}, period: $('${READ}').first().json.query.period, now: new Date().toISOString() }`,
);

export interface ApiParams {
  tables: TableIds;
  path: string;
  origins: string[]; // allowed browser origins
}

export function apiWorkflow({ tables: t, path, origins }: ApiParams): string {
  const hook = (v: string, name: string, method: 'GET' | 'POST'): NodeSpec => ({
    v,
    kind: 'trigger',
    type: 'n8n-nodes-base.webhook',
    version: 2.2,
    name,
    parameters: { httpMethod: method, path, authentication: 'none', responseMode: 'responseNode', options: { allowedOrigins: origins.join(',') } },
    output: [{ query: { view: 'summary', period: '30d' }, body: { op: 'item.done', item_id: 'i1' } }],
  });
  const body = (f: string) => `$('${WRITE}').first().json.body.${f}`;

  const nodes: NodeSpec[] = [
    // ----- reads -----
    hook('readHook', READ, 'GET'),
    switchOn('readRoute', 'Route Read', '{{ $json.query.view }}', ['summary', 'stock', 'notice']),
    dtGet('sumProducts', 'Summary Products', t.inv_products),
    dtGet('sumSales', 'Summary Sales', t.inv_sales, { where: [['sold_at', 'gte', ex(SUMMARY_SALES_SINCE)]] }),
    dtGet('sumItems', 'Open Items', t.inv_action_items, { where: [['status', 'eq', 'open']] }),
    dtGet('sumSession', 'Newest Session', t.inv_sessions, { limit: 1, orderBy: ['createdAt', 'DESC'] }),
    dtGet('sumMessages', 'Session Messages', t.inv_messages, {
      where: [['session_id', 'eq', ex(`{{ $('Newest Session').first().json.session_id || '__none__' }}`)]],
    }),
    dtGet('sumConfig', 'Summary Config', t.inv_config),
    code('sumBuild', 'Build Summary', BUILD_SUMMARY_CODE),
    dtGet('stockProducts', 'Stock Products', t.inv_products),
    code(
      'stockBuild',
      'Build Stock Page',
      codeNode(STOCK, `{ products: ${all('Stock Products')}, q: $('${READ}').first().json.query.q, cursor: $('${READ}').first().json.query.cursor }`),
    ),
    dtGet('noticeEvent', 'Latest Event', t.inv_events, { limit: 1, orderBy: ['createdAt', 'DESC'] }),
    code('noticeBuild', 'Build Notice', codeNode(NOTICE, `{ events: ${all('Latest Event')} }`)),
    respond('readReply', 'Reply Read', ex('{{ JSON.stringify($json) }}')),
    respond('readBad', 'Reply Unknown View', JSON.stringify({ ok: false, error: 'unknown view' }), 400),

    // ----- writes -----
    hook('writeHook', WRITE, 'POST'),
    switchOn('writeRoute', 'Route Write', '{{ $json.body.op }}', ['item.done', 'item.dismiss', 'item.run', 'analyze', 'push.unsubscribe', 'action.unregister']),
    dtUpdate('markItem', 'Mark Item', 'inv_action_items', t.inv_action_items, [['item_id', 'eq', ex(`{{ ${body('item_id')} }}`)]], {
      status: ex(`{{ ${body('op')} === 'item.done' ? 'done' : 'dismissed' }}`),
      done_at: ex('{{ $now.toISO() }}'),
    }),
    dtGet('runItem', 'Get Run Item', t.inv_action_items, { where: [['item_id', 'eq', ex(`{{ ${body('item_id')} }}`)]], limit: 1 }),
    dtGet('runRegistry', 'Get Registered Action', t.inv_actions, {
      where: [['workflow_id', 'eq', ex(`{{ $('Get Run Item').first().json.workflow_id || '__none__' }}`)]],
      limit: 1,
    }),
    code('runPrepare', 'Prepare Run', codeNode(PREPARE_RUN, `{ item: ${all('Get Run Item')}, registry: ${all('Get Registered Action')} }`), [
      { ok: true, item_id: 'i1', session_id: 's1', workflow_id: 'w1', input: {} },
    ]),
    ifOk('runOk', 'Runnable?'),
    code('runInput', 'Run Input', 'return [{ json: $input.first().json.input || {} }];'),
    runSub('runAction', 'Run Action Workflow', ex(`{{ $('Prepare Run').first().json.workflow_id }}`), true),
    code(
      'runOutput',
      'Collect Output',
      "const out = $input.all().map((i) => i.json).slice(0, 20);\nreturn [{ json: { ok: true, output: out } }];",
    ),
    dtUpdate('runDone', 'Mark Run Done', 'inv_action_items', t.inv_action_items, [['item_id', 'eq', ex(`{{ $('Prepare Run').first().json.item_id }}`)]], {
      status: 'done',
      done_at: ex('{{ $now.toISO() }}'),
    }),
    dtInsert(
      'runMessage',
      'Log Run Result',
      'inv_messages',
      t.inv_messages,
      {
        session_id: ex(`{{ $('Prepare Run').first().json.session_id }}`),
        created_at: ex('{{ $now.toISO() }}'),
        role: 'tool',
        content: ex(
          `{{ JSON.stringify({ type: 'action_result', item_id: $('Prepare Run').first().json.item_id, workflow_id: $('Prepare Run').first().json.workflow_id, output: $('Collect Output').first().json.output }) }}`,
        ),
      },
      { executeOnce: true },
    ),
    respond('runReply', 'Reply Run', ex(`{{ JSON.stringify($('Collect Output').first().json) }}`)),
    dtGet('anaConfig', 'Analysis Config', t.inv_config),
    code('anaTarget', 'Analysis Target', codeNode(ANALYSIS_TARGET, `{ config: ${all('Analysis Config')} }`), [{ ok: true, workflow_id: 'w1' }]),
    ifOk('anaOk', 'Analysis Ready?'),
    runSub('anaRun', 'Start Analysis', ex('{{ $json.workflow_id }}'), false),
    respond('anaReply', 'Reply Started', JSON.stringify({ ok: true, started: true })),
    dtDelete('unsub', 'Remove Subscription', t.inv_push_subscriptions, [['endpoint', 'eq', ex(`{{ ${body('endpoint')} }}`)]]),
    dtDelete('unreg', 'Unregister Action', t.inv_actions, [['workflow_id', 'eq', ex(`{{ ${body('workflow_id')} }}`)]]),
    respond('writeOk', 'Reply OK', JSON.stringify({ ok: true })),
    respond('writeErr', 'Reply Error', ex('{{ JSON.stringify({ ok: false, error: $json.error }) }}'), 400),
    respond('writeBad', 'Reply Unknown Op', JSON.stringify({ ok: false, error: 'unknown op' }), 400),
  ];

  const composition = `export default workflow(${JSON.stringify(WORKFLOWS.api)}, ${JSON.stringify(WORKFLOWS.api)})
  .add(readHook)
  .to(readRoute
    .onCase(0, sumProducts.to(sumSales).to(sumItems).to(sumSession).to(sumMessages).to(sumConfig).to(sumBuild).to(readReply))
    .onCase(1, stockProducts.to(stockBuild).to(readReply))
    .onCase(2, noticeEvent.to(noticeBuild).to(readReply))
    .onCase(3, readBad))
  .add(writeHook)
  .to(writeRoute
    .onCase(0, markItem.to(writeOk))
    .onCase(1, markItem)
    .onCase(2, runItem.to(runRegistry).to(runPrepare).to(runOk
      .onTrue(runInput.to(runAction).to(runOutput).to(runDone).to(runMessage).to(runReply))
      .onFalse(writeErr)))
    .onCase(3, anaConfig.to(anaTarget).to(anaOk
      .onTrue(anaRun.to(anaReply))
      .onFalse(writeErr)))
    .onCase(4, unsub.to(writeOk))
    .onCase(5, unreg.to(writeOk))
    .onCase(6, writeBad));`;
  return program(nodes, composition);
}

export interface NotifyParams {
  tables: TableIds;
  vapidPrivateJwk: JsonWebKey;
  vapidPublicKey: string;
}

/** Sub-workflow: record an event, then send a payload-less Web Push to every subscription. */
export function notifyWorkflow({ tables: t, vapidPrivateJwk, vapidPublicKey }: NotifyParams): string {
  const nodes: NodeSpec[] = [
    {
      v: 'fromCaller',
      kind: 'trigger',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      version: 1.3,
      name: 'From Caller',
      parameters: { inputSource: 'passthrough' },
      output: [{ kind: 'action_items', title: 'New action items', body: '2 new items', workflow_id: '' }],
    },
    dtInsert(
      'recordEvent',
      'Record Event',
      'inv_events',
      t.inv_events,
      {
        created_at: ex('{{ $now.toISO() }}'),
        kind: ex("{{ $json.kind || 'action_items' }}"),
        title: ex("{{ $json.title || 'Invenstory' }}"),
        body: ex("{{ $json.body || '' }}"),
        workflow_id: ex("{{ $json.workflow_id || '' }}"),
      },
      { executeOnce: true },
    ),
    { ...dtGet('subs', 'Get Subscriptions', t.inv_push_subscriptions), settings: { executeOnce: true } },
    code('sign', 'Sign Push', signPushCode(vapidPrivateJwk, vapidPublicKey), [{ endpoint: 'https://fcm.googleapis.com/fcm/send/x', authorization: 'vapid t=x, k=y' }]),
    {
      v: 'send',
      type: 'n8n-nodes-base.httpRequest',
      version: 4.5,
      name: 'Send Push',
      parameters: {
        method: 'POST',
        url: ex('{{ $json.endpoint }}'),
        sendHeaders: true,
        specifyHeaders: 'keypair',
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: ex('{{ $json.authorization }}') },
            { name: 'TTL', value: '86400' },
            { name: 'Urgency', value: 'normal' },
          ],
        },
        options: { timeout: 10000, response: { response: { fullResponse: true, neverError: true } } },
      },
      output: [{ statusCode: 201, headers: {}, body: '' }],
    },
    {
      v: 'gone',
      type: 'n8n-nodes-base.filter',
      version: 2.2,
      name: 'Expired Subscriptions',
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [
            { leftValue: ex('{{ $json.statusCode }}'), rightValue: 404, operator: { type: 'number', operation: 'equals' } },
            { leftValue: ex('{{ $json.statusCode }}'), rightValue: 410, operator: { type: 'number', operation: 'equals' } },
          ],
          combinator: 'or',
        },
      },
      output: [{ statusCode: 410 }],
    },
    dtDelete('prune', 'Remove Expired', t.inv_push_subscriptions, [['endpoint', 'eq', ex("{{ $('Sign Push').item.json.endpoint }}")]], {}),
  ];
  const composition = `export default workflow(${JSON.stringify(WORKFLOWS.notify)}, ${JSON.stringify(WORKFLOWS.notify)})
  .add(fromCaller)
  .to(recordEvent)
  .to(subs)
  .to(sign)
  .to(send)
  .to(gone)
  .to(prune);`;
  return program(nodes, composition);
}

/** Error workflow for every Invenstory workflow except notify (avoids a failure loop). */
export function errorWorkflow({ notifyId }: { notifyId: string }): string {
  const nodes: NodeSpec[] = [
    {
      v: 'failed',
      kind: 'trigger',
      type: 'n8n-nodes-base.errorTrigger',
      version: 1,
      name: 'On Failure',
      output: [{ execution: { id: '1', error: { message: 'Boom' } }, workflow: { id: 'w1', name: 'Ingest' } }],
    },
    {
      v: 'describe',
      type: 'n8n-nodes-base.set',
      version: 3.4,
      name: 'Describe Failure',
      parameters: {
        mode: 'manual',
        includeOtherFields: false,
        assignments: {
          assignments: [
            { id: 'kind', name: 'kind', value: 'failure', type: 'string' },
            { id: 'title', name: 'title', value: ex("{{ 'Workflow failed: ' + ($json.workflow?.name || 'unknown') }}"), type: 'string' },
            { id: 'body', name: 'body', value: ex("{{ ($json.execution?.error?.message || 'No error message').slice(0, 300) }}"), type: 'string' },
            { id: 'wf', name: 'workflow_id', value: ex("{{ $json.workflow?.id || '' }}"), type: 'string' },
          ],
        },
      },
      output: [{ kind: 'failure', title: 'Workflow failed: Ingest', body: 'Boom', workflow_id: 'w1' }],
    },
    runSub('notify', 'Notify', notifyId, false),
  ];
  const composition = `export default workflow(${JSON.stringify(WORKFLOWS.error)}, ${JSON.stringify(WORKFLOWS.error)})
  .add(failed)
  .to(describe)
  .to(notify);`;
  return program(nodes, composition);
}
