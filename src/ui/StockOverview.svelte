<script module lang="ts">
  export interface StockAlerts { loading: boolean; error: string; items: { sku: string; name: string; quantity: number; status: 'low' | 'out' }[] }
</script>
<script lang="ts">
  import type { Api, StockItem } from '../lib/n8n/api.ts';
  import { count } from '../lib/format.ts';


  let { api, refreshKey = '', onalerts }: { api: Api; refreshKey?: string; onalerts?: (state: StockAlerts) => void } = $props();
  const uid = $props.id();
  let items = $state<StockItem[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let retry = $state(0);
  // Out of stock takes precedence over low stock.
  const level = (item: StockItem) => item.quantity <= 0 ? 'out' as const
    : item.reorder_point !== null && item.quantity <= item.reorder_point ? 'low' as const : null;
  const maximum = $derived(items.reduce((max, item) => Math.max(max, item.quantity), 0));
  const low = $derived(items.filter((item) => level(item) === 'low').length);
  const out = $derived(items.filter((item) => level(item) === 'out').length);
  $effect(() => {
    onalerts?.({ loading, error, items: items.flatMap(item => {
      const status = level(item);
      return status ? [{ sku: item.sku, name: item.name || item.sku, quantity: item.quantity, status }] : [];
    }).sort((a, b) => (a.status === b.status ? 0 : a.status === 'out' ? -1 : 1)
      || a.quantity - b.quantity || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)) });
  });
  $effect(() => {
    const client = api;
    void refreshKey;
    void retry;
    let cancelled = false;
    loading = true;
    error = '';
    items = [];
    total = 0;
    async function load() {
      let cursor = '';
      const cursors = new Set<string>();
      const loaded = new Map<string, StockItem>();
      try {
        do {
          cursors.add(cursor);
          const page = await client.stock('', cursor);
          if (cancelled) return;
          for (const item of page.items) loaded.set(item.sku, item);
          items = [...loaded.values()];
          total = page.total;
          if (!page.next) break;
          if (cursors.has(page.next)) throw new Error('Could not load the next stock page. Please retry.');
          cursor = page.next;
        } while (true);
      } catch (e) {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      } finally {
        if (!cancelled) loading = false;
      }
    }
    void load();
    return () => { cancelled = true; };
  });
</script>

<div class="stock" aria-busy={loading}>
  <section class="stock-panel" aria-label="Current stock levels">
    {#if loading}<p class="notice" role="status">Loading stock… {count(items.length)} products loaded.</p>{/if}
    {#if error}<p class="notice error" role="alert">{error} <button onclick={() => retry++}>Retry</button></p>{/if}
    {#if items.length}

      <div class="scroll" role="region" aria-label="Stock quantities">
        <ul class="stock-bars">
          {#each items as item, index (item.sku)}
            {@const status = level(item)}
            <li class="product">
              <span class="product-name" title={item.name || item.sku}>{item.name || item.sku}</span>
              <div class="track" class:empty-alert={status === 'out'} aria-hidden="true">
                {#if item.quantity > 0 && maximum > 0}
                  <svg class="bar-fill" class:low={status === 'low'} style:width={(item.quantity / maximum * 100) + '%'}>
                    <defs>
    <pattern id="{uid}-pattern-{index}" width="24" height="16" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="#26251f" stroke-width="1.8" stroke-linecap="round">
        {#if index % 5 === 0}
          <path d="M-6 4Q0-1 6 4T18 4T30 4M-6 12Q0 7 6 12T18 12T30 12" />
        {:else if index % 5 === 1}
          <g fill="#26251f" stroke="none"><circle cx="4" cy="4" r="1.5" /><circle cx="16" cy="4" r="1.5" /><circle cx="10" cy="12" r="1.5" /><circle cx="22" cy="12" r="1.5" /></g>
        {:else if index % 5 === 2}
          <path d="M3 3L6 7M15 2L12 5M21 10L23 14M9 12L12 15" stroke-width="2.5" />
        {:else if index % 5 === 3}
          <path d="M-8 16L8 0M4 16L20 0M16 16L32 0" />
        {:else}
          <path d="M-6 0A6 6 0 0 0 6 0A6 6 0 0 0 18 0A6 6 0 0 0 30 0M-12 8A6 6 0 0 0 0 8A6 6 0 0 0 12 8A6 6 0 0 0 24 8A6 6 0 0 0 36 8M-6 16A6 6 0 0 0 6 16A6 6 0 0 0 18 16A6 6 0 0 0 30 16" />
        {/if}
      </g>
    </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#{uid}-pattern-{index})" />
                  </svg>
                {/if}
              </div>
              <span class="quantity" class:out={status === 'out'}>{count(item.quantity)}<span class="sr-only"> units</span></span>
              <span class="status-slot">{#if status}<span class="pill" class:out={status === 'out'}>{status === 'out' ? 'Out' : 'Low'}</span>{:else}<span class="sr-only">In stock</span>{/if}</span>
            </li>
          {/each}
        </ul>
      </div>
    {:else if !loading && !error}
      <p class="notice">No products yet. Connect a source in Chat.</p>
    {/if}
  </section>
  <div class="details">
    <section class="panel" aria-labelledby="{uid}-summary">
      <h2 id="{uid}-summary">Inventory Summary</h2>
      <dl>
        <div><dt>{loading || error ? 'Products loaded' : 'Total products'}</dt><dd>{count(items.length)}</dd></div>
        <div><dt>Low stock items</dt><dd>{count(low)}</dd></div>
        <div><dt>Out of stock items</dt><dd class="out">{count(out)}</dd></div>
      </dl>
      {#if loading || error}<p class="note">{count(items.length)} of {count(total)} loaded. Counts reflect loaded products only.</p>{/if}
    </section>
  </div>
</div>

<style>
  .stock { display: grid; gap: 12px; min-width: 0; }
  .panel { min-width: 0; background: var(--surface, #fcf6ef); border: 1px solid var(--line, #e5d9ce); border-radius: 22px; padding: 14px; box-shadow: 0 5px 13px #5c3f2b0a; }
  .stock-panel { contain: inline-size; padding: 12px 0 18px; }
  .scroll { min-width: 0; }
  .scroll:focus-visible { outline: 2px solid #a9544c; outline-offset: 4px; }
  .stock-bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
  .product { display: grid; grid-template-columns: minmax(72px, 0.8fr) minmax(48px, 2fr) 4ch 34px; align-items: center; gap: 10px; }
  .product-name { font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
  .track { position: relative; height: 30px; border: 1px solid #403b34; border-radius: 5px 6px 4px 5px; overflow: hidden; background: #f7f1e7; box-shadow: inset 0 -3px 4px #70604b16, 0 1px 1px #57443114; }
  .track::before { content: ''; position: absolute; inset: 3px 4px; border-left: 1px solid #51483c55; border-right: 1px solid #51483c55; border-radius: 3px; pointer-events: none; z-index: 1; }
  .track::after { content: ''; position: absolute; inset: 2px 5px; border-top: 2px solid #fffdf5cc; border-bottom: 1px solid #6e604124; border-radius: 2px; pointer-events: none; z-index: 1; }
  .track.empty-alert { background: #f3d9d2; }
  .bar-fill { display: block; height: 100%; background: #eee8dc; }
  .bar-fill.low { background: #f1c8bb; }
  .quantity { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
  .status-slot { min-width: 0; }
  .pill { display: inline-block; background: #f1d3c6; color: #8f3028; border-radius: 12px; padding: 2px 6px; font-size: 12px; line-height: 1.4; white-space: nowrap; }
  .pill.out { background: #e9b7a9; }
  .out { color: #b7473b; }
  .details { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
  h2 { font: 600 23px/1.15 Georgia, serif; margin: 0 0 10px; letter-spacing: -0.035em; }
  dl { margin: 0; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
  dl div { display: flex; flex-direction: column; justify-content: space-between; gap: 6px; align-items: flex-start; padding: 6px 0; border-bottom: 1px solid var(--line, #e5d9ce); }
  dt { font-size: 10px; color: #786d65; }
  dd { margin: 0; font: 26px Georgia, serif; }
  .note { font-size: 11px; color: #82736a; margin: 12px 0 0; line-height: 1.6; }
  .notice { font-size: 14px; line-height: 1.6; color: #786d65; padding: 12px 0; margin: 0; }
  .error { color: #a44036; }
  button { color: inherit; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  @container stock (max-width: 720px) { .details { grid-template-columns: minmax(0, 1fr); } .panel { padding: 18px; } }
  @media (max-width: 400px) { .product { gap: 6px; grid-template-columns: minmax(64px, 1fr) minmax(40px, 1.3fr) 28px 34px; } }
</style>
