// Canonical n8n data-table schema. Every table also has n8n's own id/createdAt/updatedAt.

export type ColumnType = 'string' | 'number' | 'boolean' | 'date';

export const TABLES = {
  inv_products: {
    sku: 'string',
    name: 'string',
    quantity: 'number',
    reorder_point: 'number',
    unit_cost: 'number',
    unit_price: 'number',
    currency: 'string',
    source: 'string',
    updated_at: 'date',
  },
  inv_sales: {
    sale_id: 'string',
    sold_at: 'date',
    sku: 'string',
    quantity: 'number',
    revenue: 'number',
    currency: 'string',
    channel: 'string',
  },
  inv_sessions: { session_id: 'string', created_at: 'date', origin: 'string', execution_id: 'string' },
  inv_messages: { session_id: 'string', created_at: 'date', role: 'string', content: 'string' },
  inv_action_items: {
    item_id: 'string',
    session_id: 'string',
    created_at: 'date',
    title: 'string',
    detail: 'string',
    kind: 'string',
    workflow_id: 'string',
    input: 'string',
    draft_channel: 'string',
    draft_to: 'string',
    draft_subject: 'string',
    draft_body: 'string',
    status: 'string',
    done_at: 'date',
  },
  inv_actions: { workflow_id: 'string', name: 'string', description: 'string', input_schema: 'string', registered_at: 'date' },
  inv_push_subscriptions: { endpoint: 'string', created_at: 'date' },
  inv_events: { created_at: 'date', kind: 'string', title: 'string', body: 'string', workflow_id: 'string' },
  inv_config: { key: 'string', value: 'string' },
} as const satisfies Record<string, Record<string, ColumnType>>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];
export type TableIds = Record<TableName, string>;

export const WORKFLOWS = {
  api: 'invenstory-api',
  analyze: 'invenstory-analyze',
  notify: 'invenstory-notify',
  error: 'invenstory-error',
} as const;
export type CoreWorkflow = keyof typeof WORKFLOWS;

/** Bumped whenever a core template changes; stored in inv_config.version. */
export const CORE_VERSION = 3;
