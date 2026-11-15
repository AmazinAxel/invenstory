<script lang="ts">
  import { money, count } from '../lib/format.ts';
  import type { Api, StockItem } from '../lib/n8n/api.ts';
  import Icon from './Icon.svelte';

  let { api, currency }: { api: Api; currency: string } = $props();

  let q = $state('');
  let items = $state<StockItem[]>([]);
  let total = $state(0);
  let next = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  async function load(reset: boolean) {
    const s = ++seq;
    loading = true;
    try {
      const page = await api.stock(q.trim(), reset ? '' : (next ?? ''));
      if (s !== seq) return;
      items = reset ? page.items : [...items, ...page.items];
      total = page.total;
      next = page.next;
      error = null;
    } catch (e) {
      if (s === seq) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (s === seq) loading = false;
    }
  }

  function search() {
    clearTimeout(timer);
    timer = setTimeout(() => void load(true), 300);
  }

  $effect(() => {
    void api;
    void load(true);
  });

  const level = (p: StockItem) =>
    p.quantity <= 0 ? ('out' as const) : p.reorder_point !== null && p.quantity <= p.reorder_point ? ('low' as const) : null;
</script>

<div class="stack" style="gap: 10px">
  <label class="search">
    <span class="sr-only">Search stock</span>
    <Icon name="search" size={18} />
    <input bind:value={q} oninput={search} placeholder="Search name or SKU" type="search" autocapitalize="off" />
  </label>
  {#if error}<p class="error small" role="alert">{error}</p>{/if}
  {#if items.length}
    <ul class="list">
      {#each items as p (p.sku)}
        {@const s = level(p)}
        <li>
          <div class="main">
            <span class="name">{p.name || p.sku}</span>
            <span class="muted small">{p.sku}{p.unit_price ? ` · ${money(p.unit_price, p.currency || currency)}` : ''}</span>
          </div>
          <div class="qty">
            <span class="num">{count(p.quantity)}</span>
            {#if s === 'out'}
              <span class="chip danger"><Icon name="stop" size={14} /> Out</span>
            {:else if s === 'low'}
              <span class="chip warn"><Icon name="alert" size={14} /> Low</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <p class="muted small">{items.length} of {total}</p>
    {#if next}<button disabled={loading} onclick={() => load(false)}>{loading ? 'Loading…' : 'Show more'}</button>{/if}
  {:else if !loading}
    <p class="muted small">{q ? 'No matching products.' : 'No products yet. Connect a source in Chat.'}</p>
  {/if}
</div>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid var(--control-line);
    border-radius: 8px;
    padding: 0 10px;
    background: var(--bg);
    color: var(--muted);
  }
  .search input {
    border: 0;
    padding-left: 0;
    background: transparent;
  }
  .search input:focus {
    outline: none;
  }
  .search:focus-within {
    outline: 2px solid var(--accent);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: 0;
  }
  .main {
    display: grid;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .qty {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.75rem;
    font-weight: 600;
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 1px 7px;
  }
  .warn {
    color: var(--warn);
  }
  .danger {
    color: var(--danger);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
