import { describe, expect, test } from 'bun:test';
import { NOTICE, PREPARE_RUN, STOCK, SUMMARY, ANALYSIS_TARGET, signPushCode } from '../src/lib/n8n/core/code.ts';
import { ex, lit } from '../src/lib/n8n/core/sdk.ts';
import { apiWorkflow } from '../src/lib/n8n/core/templates.ts';
import { TABLE_NAMES, type TableIds } from '../src/lib/n8n/core/schema.ts';

// Runs a Code-node source exactly as n8n would see it (minus the $-helpers).
const load = (src: string) => new Function(`${src}\nreturn run;`)() as (input: unknown) => any;

const NOW = '2026-11-15T12:00:00.000Z';
let id = 0;
const row = (r: Record<string, unknown>) => ({ id: ++id, createdAt: NOW, ...r });

describe('SUMMARY', () => {
  const run = load(SUMMARY);
  const products = [
    row({ sku: 'A', name: 'Alpha', quantity: 10, reorder_point: 5, unit_cost: 2, currency: 'USD' }),
    row({ sku: 'B', name: 'Beta', quantity: 3, reorder_point: 5, unit_cost: 1, currency: 'usd' }),
    row({ sku: 'C', name: 'Gamma', quantity: 0, reorder_point: 1, unit_cost: 9, currency: 'USD' }),
    row({ sku: 'E', name: 'Euro', quantity: 4, reorder_point: null, unit_cost: 5, currency: 'EUR' }),
  ];
  const sales = [
    row({ sku: 'A', quantity: 2, revenue: 20, currency: 'USD', sold_at: '2026-11-14T10:00:00Z' }),
    row({ sku: 'B', quantity: 1, revenue: 50, currency: 'USD', sold_at: '2026-11-10T10:00:00Z' }),
    row({ sku: 'A', quantity: 1, revenue: 9, currency: 'EUR', sold_at: '2026-11-13T10:00:00Z' }),
    row({ sku: 'A', quantity: 5, revenue: 50, currency: 'USD', sold_at: '2026-09-01T10:00:00Z' }), // outside 7d
  ];
  const base = {
    products,
    sales,
    items: [row({ item_id: 'i1', status: 'open', kind: 'draft', created_at: NOW }), row({ item_id: 'i2', status: 'done' })],
    sessions: [row({ session_id: 's1', created_at: NOW, origin: 'analysis' })],
    messages: [
      row({ session_id: 's1', role: 'assistant', content: '{"type":"text","text":"hi"}', created_at: '2026-11-15T11:00:00Z' }),
      row({ session_id: 'other', role: 'user', content: 'x', created_at: NOW }),
    ],
    config: [row({ key: 'base_currency', value: 'EUR' }), row({ key: 'base_currency', value: 'USD' }), row({ key: 'version', value: '1' })],
    period: '7d',
    now: NOW,
  };

  test('KPIs use the newest base currency and count excluded rows', () => {
    const s = run(base);
    expect(s.currency).toBe('USD');
    expect(s.kpis).toEqual({ stock_value: 23, revenue: 70, units_sold: 4, low_stock: 1, out_of_stock: 1, products: 4, excluded_rows: 2 });
  });

  test('trend covers the period day by day', () => {
    const s = run(base);
    expect(s.sales_trend).toHaveLength(7);
    expect(s.sales_trend.at(-2)).toEqual({ date: '2026-11-14', revenue: 20, units: 2 });
  });

  test('top sellers, slow movers, open items, session messages', () => {
    const s = run(base);
    expect(s.top_sellers.map((x: { sku: string }) => x.sku)).toEqual(['B', 'A']);
    expect(s.slow_movers[0].sku).toBe('E');
    expect(s.action_items.map((x: { item_id: string }) => x.item_id)).toEqual(['i1']);
    expect(s.session.messages).toEqual([{ role: 'assistant', created_at: '2026-11-15T11:00:00Z', content: { type: 'text', text: 'hi' } }]);
  });

  test('product sales compare this period with the one before', () => {
    const s = run({
      ...base,
      sales: [
        ...sales,
        row({ sku: 'A', quantity: 1, revenue: 10, currency: 'USD', sold_at: '2026-11-05T10:00:00Z' }), // previous 7d
        row({ sku: 'C', quantity: 2, revenue: 30, currency: 'USD', sold_at: '2026-11-02T10:00:00Z' }), // previous 7d only
        row({ sku: 'C', quantity: 2, revenue: 30, currency: 'USD', sold_at: '2026-10-30T10:00:00Z' }), // before both
      ],
    });
    expect(s.product_sales).toEqual([
      { sku: 'B', name: 'Beta', units: 1, revenue: 50, prev_units: 0, prev_revenue: 0 },
      { sku: 'A', name: 'Alpha', units: 3, revenue: 20, prev_units: 1, prev_revenue: 10 },
      { sku: 'C', name: 'Gamma', units: 0, revenue: 0, prev_units: 2, prev_revenue: 30 },
    ]);
    expect(s.kpis.revenue).toBe(70);
    expect(s.top_sellers.map((x: { sku: string }) => x.sku)).toEqual(['B', 'A']);
  });

  test('empty placeholder items from alwaysOutputData are ignored', () => {
    const s = run({ products: [{}], sales: [{}], items: [{}], sessions: [{}], messages: [{}], config: [{}], period: '30d', now: NOW });
    expect(s.kpis.products).toBe(0);
    expect(s.session).toBeNull();
    expect(s.sales_trend).toHaveLength(30);
    expect(s.config.analysis).toBe(false);
  });
});

describe('STOCK / NOTICE / PREPARE_RUN / ANALYSIS_TARGET', () => {
  test('stock search and paging', () => {
    const run = load(STOCK);
    const products = Array.from({ length: 60 }, (_, i) => row({ sku: `S${i}`, name: `Item ${String(i).padStart(2, '0')}`, quantity: i }));
    const p1 = run({ products, q: '' });
    expect(p1.total).toBe(60);
    expect(p1.items).toHaveLength(50);
    expect(p1.next).toBe('50');
    expect(run({ products, cursor: '50' }).items).toHaveLength(10);
    expect(run({ products, q: 'item 05' }).items.map((x: { sku: string }) => x.sku)).toEqual(['S5']);
  });

  test('notice falls back when there is no event', () => {
    const run = load(NOTICE);
    expect(run({ events: [{}] }).title).toBe('Invenstory');
    expect(run({ events: [row({ kind: 'failure', title: 'T', body: 'B' })] }).kind).toBe('failure');
  });

  test('item.run requires an open run item whose workflow is registered', () => {
    const run = load(PREPARE_RUN);
    const item = row({ item_id: 'i', kind: 'run', status: 'open', workflow_id: 'w', session_id: 's', input: '{"n":1}' });
    expect(run({ item: [item], registry: [row({ workflow_id: 'w' })] })).toEqual({ ok: true, item_id: 'i', session_id: 's', workflow_id: 'w', input: { n: 1 } });
    expect(run({ item: [item], registry: [{}] }).ok).toBe(false);
    expect(run({ item: [{ ...item, status: 'done' }], registry: [row({ workflow_id: 'w' })] }).ok).toBe(false);
    expect(run({ item: [{}], registry: [{}] }).ok).toBe(false);
  });

  test('analysis target reads the newest config value', () => {
    const run = load(ANALYSIS_TARGET);
    expect(run({ config: [{}] }).ok).toBe(false);
    expect(run({ config: [row({ key: 'analyze_workflow_id', value: 'old' }), row({ key: 'analyze_workflow_id', value: 'new' })] })).toEqual({ ok: true, workflow_id: 'new' });
  });
});

describe('push signing code', () => {
  test('produces VAPID JWTs that verify with the public key', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pub = Buffer.from(raw).toString('base64url');
    const src = signPushCode(await crypto.subtle.exportKey('jwk', kp.privateKey), pub);
    const items = [{ json: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' } }, { json: { endpoint: 'http://bad' } }];
    const fn = new Function('require', '$input', 'Buffer', src) as (r: unknown, i: unknown, b: unknown) => { json: { endpoint: string; authorization: string } }[];
    const out = fn(require, { all: () => items }, Buffer);
    expect(out).toHaveLength(1);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(out[0]!.json.authorization)!;
    expect(m[2]).toBe(pub);
    const [h, c, s] = m[1]!.split('.');
    expect(JSON.parse(Buffer.from(c!, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(s!, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('SDK serializer', () => {
  test('escapes strings and emits expr()', () => {
    expect(lit({ a: "it's", 'b-c': [1, ex('{{ $json.x }}')], u: undefined })).toBe(`{ a: "it's", "b-c": [1, expr("{{ $json.x }}")] }`);
  });
  test('api template embeds path, origins and table ids', () => {
    const tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, `id_${n}`])) as TableIds;
    const code = apiWorkflow({ tables, path: 'inv-abc', origins: ['https://a.example', 'http://localhost:5173'] });
    expect(code).toContain('"inv-abc"');
    expect(code).toContain('"https://a.example,http://localhost:5173"');
    expect(code).toContain('"id_inv_action_items"');
    expect(code).not.toContain('"undefined"');
    expect(code).not.toMatch(/value: (undefined|null)\b/);
  });
});

import { extractVapid } from '../src/lib/n8n/core/code.ts';
describe('push upgrade helpers', () => {
  test('signing code dedupes endpoints and its keys can be recovered', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const src = signPushCode(jwk, 'PUBKEY');
    const items = [{ json: { endpoint: 'https://a.example/x' } }, { json: { endpoint: 'https://a.example/x' } }];
    const fn = new Function('require', '$input', 'Buffer', src) as (r: unknown, i: unknown, b: unknown) => unknown[];
    expect(fn(require, { all: () => items }, Buffer)).toHaveLength(1);
    const k = extractVapid(src)!;
    expect(k.publicKey).toBe('PUBKEY');
    expect(k.privateJwk.d).toBe(jwk.d);
  });
});
