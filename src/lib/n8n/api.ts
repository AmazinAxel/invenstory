// Data-plane client for the invenstory-api webhook (secret path; reads and mutations).

export type Period = '7d' | '30d' | '90d';

export interface ActionItem {
  item_id: string;
  session_id: string;
  created_at: string;
  title: string;
  detail: string;
  kind: 'run' | 'draft';
  workflow_id: string | null;
  draft_channel: 'email' | 'whatsapp' | 'sms' | null;
  draft_to: string | null;
  draft_subject: string | null;
  draft_body: string | null;
}

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool';
  created_at: string;
  content: unknown;
}

export interface Summary {
  generated_at: string;
  period: Period;
  currency: string;
  kpis: { stock_value: number; revenue: number; units_sold: number; low_stock: number; out_of_stock: number; products: number; excluded_rows: number };
  sales_trend: { date: string; revenue: number; units: number }[];
  top_sellers: { sku: string; name: string; units: number; revenue: number }[];
  slow_movers: { sku: string; name: string; quantity: number; units: number }[];
  /** Per product: this period vs the period before it (top 50 by current revenue). Missing on core < v3. */
  product_sales?: { sku: string; name: string; units: number; revenue: number; prev_units: number; prev_revenue: number }[];
  action_items: ActionItem[];
  session: { session_id: string; created_at: string; origin: string; messages: StoredMessage[] } | null;
  config: { version: number; base_currency: string; vapid_public_key: string | null; analysis: boolean };
}

export interface StockItem {
  sku: string;
  name: string;
  quantity: number;
  reorder_point: number | null;
  unit_cost: number;
  unit_price: number;
  currency: string | null;
  source: string | null;
  updated_at: string | null;
}

export interface StockPage {
  total: number;
  next: string | null;
  items: StockItem[];
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class Api {
  constructor(readonly url: string) {}

  private async get<T>(params: Record<string, string>): Promise<T> {
    const u = new URL(this.url);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    const r = await fetch(u, { cache: 'no-store' });
    return this.parse<T>(r);
  }

  private async parse<T>(r: Response): Promise<T> {
    const j = (await r.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!r.ok || !j) throw new ApiError(j?.error ?? `n8n answered ${r.status}`, r.status);
    return j;
  }

  summary(period: Period) {
    return this.get<Summary>({ view: 'summary', period });
  }

  stock(q = '', cursor = '') {
    return this.get<StockPage>({ view: 'stock', q, cursor });
  }

  async post<T = { ok: boolean }>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...body }) });
    return this.parse<T>(r);
  }

  done = (item_id: string) => this.post('item.done', { item_id });
  dismiss = (item_id: string) => this.post('item.dismiss', { item_id });
  run = (item_id: string) => this.post<{ ok: boolean; output: unknown[] }>('item.run', { item_id });
  analyze = () => this.post<{ ok: boolean; started: boolean }>('analyze');
}
