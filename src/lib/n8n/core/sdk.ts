// Tiny builder that emits n8n Workflow SDK source (a restricted TypeScript subset) from
// plain objects, so templates stay data and every string is JSON-escaped.

import { TABLES, type TableName } from './schema.ts';

export class Expr {
  constructor(readonly src: string) {}
}
/** An n8n expression, e.g. ex('{{ $json.sku }}'). */
export const ex = (src: string) => new Expr(src);

/** Verbatim SDK source (e.g. a node variable reference). */
export class Raw {
  constructor(readonly src: string) {}
}
export const raw = (src: string) => new Raw(src);

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function lit(v: unknown): string {
  if (v instanceof Expr) return `expr(${JSON.stringify(v.src)})`;
  if (v instanceof Raw) return v.src;
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{ ${entries.map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}: ${lit(x)}`).join(', ')} }`;
  }
  return JSON.stringify(v ?? null);
}

export interface NodeSpec {
  v: string; // variable name in the SDK code
  kind?: 'node' | 'trigger' | 'ifElse' | 'switchCase' | 'languageModel' | 'outputParser';
  type?: string;
  version: number;
  name: string;
  parameters?: Record<string, unknown>;
  settings?: Record<string, unknown>; // executeOnce, alwaysOutputData, onError …
  output?: Record<string, unknown>[];
  credentials?: Record<string, { id: string; name: string }>;
  subnodes?: Record<string, string>; // slot → variable name of a sub-node
}

export function decl(n: NodeSpec): string {
  const kind = n.kind ?? 'node';
  const subnodes = n.subnodes ? Object.fromEntries(Object.entries(n.subnodes).map(([k, v]) => [k, raw(v)])) : undefined;
  const config = { name: n.name, ...(n.settings ?? {}), parameters: n.parameters ?? {}, credentials: n.credentials, subnodes };
  const head = kind === 'ifElse' || kind === 'switchCase' ? '' : `type: ${JSON.stringify(n.type)}, `;
  const out = kind === 'ifElse' || kind === 'switchCase' || kind === 'languageModel' || kind === 'outputParser' ? '' : `, output: ${lit(n.output ?? [{}])}`;
  return `const ${n.v} = ${kind}({ ${head}version: ${n.version}, config: ${lit(config)}${out} });`;
}

export const SDK_IMPORT = "import { workflow, node, trigger, ifElse, switchCase, languageModel, outputParser, expr } from '@n8n/workflow-sdk';";

export function program(nodes: NodeSpec[], composition: string): string {
  return [SDK_IMPORT, '', ...nodes.map(decl), '', composition].join('\n');
}

// ---------- data table helpers ----------

export const tableRef = (id: string) => ({ __rl: true, mode: 'id', value: id });

export function columns(table: TableName, values: Record<string, unknown>) {
  const cols = TABLES[table] as Record<string, string>;
  return {
    mappingMode: 'defineBelow',
    value: values,
    schema: Object.keys(values).map((id) => ({
      id,
      displayName: id,
      required: false,
      defaultMatch: false,
      display: true,
      type: cols[id] ?? 'string',
      canBeUsedToMatch: true,
    })),
  };
}

export type Cond = [column: string, condition: string, value: unknown];
const conditions = (conds: Cond[]) => ({ conditions: conds.map(([keyName, condition, keyValue]) => ({ keyName, condition, keyValue })) });

export function dtGet(
  v: string,
  name: string,
  tableId: string,
  o: { where?: Cond[]; limit?: number; orderBy?: [string, 'ASC' | 'DESC'] } = {},
): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.dataTable',
    version: 1.1,
    name,
    settings: { executeOnce: true, alwaysOutputData: true },
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: tableRef(tableId),
      ...(o.where ? { matchType: 'allConditions', filters: conditions(o.where) } : {}),
      ...(o.limit ? { returnAll: false, limit: o.limit } : { returnAll: true }),
      ...(o.orderBy ? { orderBy: true, orderByColumn: o.orderBy[0], orderByDirection: o.orderBy[1] } : {}),
    },
    output: [{ id: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  };
}

export function dtInsert(v: string, name: string, table: TableName, tableId: string, values: Record<string, unknown>, settings?: Record<string, unknown>): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.dataTable',
    version: 1.1,
    name,
    settings,
    parameters: { resource: 'row', operation: 'insert', dataTableId: tableRef(tableId), columns: columns(table, values) },
    output: [{ id: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  };
}

export function dtUpdate(v: string, name: string, table: TableName, tableId: string, where: Cond[], values: Record<string, unknown>): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.dataTable',
    version: 1.1,
    name,
    settings: { alwaysOutputData: true },
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: tableRef(tableId),
      matchType: 'allConditions',
      filters: conditions(where),
      columns: columns(table, values),
    },
    output: [{ id: 1 }],
  };
}

export function dtDelete(v: string, name: string, tableId: string, where: Cond[], settings: Record<string, unknown> = { alwaysOutputData: true }): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.dataTable',
    version: 1.1,
    name,
    settings,
    parameters: { resource: 'row', operation: 'deleteRows', dataTableId: tableRef(tableId), matchType: 'allConditions', filters: conditions(where) },
    output: [{ id: 1 }],
  };
}

export function code(v: string, name: string, jsCode: string, output: Record<string, unknown>[] = [{}]): NodeSpec {
  return { v, type: 'n8n-nodes-base.code', version: 2, name, parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode }, output };
}

export function respond(v: string, name: string, body: Expr | string, status = 200): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.respondToWebhook',
    version: 1.5,
    name,
    parameters: {
      respondWith: 'json',
      responseBody: body,
      options: { responseCode: status, responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } },
    },
  };
}

export function ifOk(v: string, name: string, field = 'ok'): NodeSpec {
  return {
    v,
    kind: 'ifElse',
    version: 2.2,
    name,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: ex(`{{ $json.${field} }}`), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
    },
  };
}

export function switchOn(v: string, name: string, valueExpr: string, cases: string[]): NodeSpec {
  return {
    v,
    kind: 'switchCase',
    version: 3.2,
    name,
    parameters: {
      rules: {
        values: cases.map((c) => ({
          outputKey: c,
          renameOutput: true,
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [{ leftValue: ex(valueExpr), rightValue: c, operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and',
          },
        })),
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'Other' },
    },
  };
}

export function runSub(v: string, name: string, workflowId: string | Expr, wait: boolean): NodeSpec {
  return {
    v,
    type: 'n8n-nodes-base.executeWorkflow',
    version: 1.4,
    name,
    parameters: { source: 'database', workflowId: { __rl: true, mode: 'id', value: workflowId }, mode: 'once', options: { waitForSubWorkflow: wait } },
    output: [{}],
  };
}
