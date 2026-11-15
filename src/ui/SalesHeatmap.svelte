<script module lang="ts">
  import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
  import type { Summary } from '../lib/n8n/api.ts';
  export type ProductSales = NonNullable<Summary['product_sales']>[number];
  export interface SalesTile { name: string; index: number; current: number; previous: number; change: number | null; isNew: boolean; color: string; lightText: boolean }
  export function changeColor(change: number | null, isNew = false) {
    if (change === null && !isNew) return '#b3aca3';
    const amount = isNew ? 1 : Math.max(-1, Math.min(1, change ?? 0));
    const yellow = [239, 215, 145], blue = [49, 98, 177], red = [213, 100, 75];
    const target = amount >= 0 ? blue : red;
    const base = amount > 0 ? [224, 232, 248] : yellow;
    return `rgb(${base.map((v, i) => Math.round(v + (target[i]! - v) * Math.abs(amount))).join(',')})`;
  }
  const amount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
  /** One tile per product: area = this period's revenue, color = change against the previous period. */
  export function buildTiles(products: ProductSales[]): SalesTile[] {
    return products.map((p, index) => {
      const current = amount(p.revenue), previous = amount(p.prev_revenue);
      const isNew = current > 0 && previous === 0;
      const change = isNew ? null : previous === 0 ? 0 : (current - previous) / previous;
      return { name: p.name || p.sku, index, current, previous, change, isNew, color: changeColor(change, isNew), lightText: isNew || (change !== null && change >= 0.55) };
    });
  }
  export function layoutTreemap(entries: SalesTile[], width = 1000, height = 400, gap = 2) {
    type Node = { tile?: SalesTile; value?: number; children?: Node[] };
    const positive = entries.filter(e => e.current !== null && Number.isFinite(e.current) && e.current > 0);
    if (!positive.length || width <= 0 || height <= 0) return [];
    const max = Math.max(...positive.map(e => e.current!));
    const root = hierarchy<Node>({ children: positive.map(tile => ({ tile, value: tile.current! / max })) })
      .sum(d => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || (a.data.tile?.index ?? 0) - (b.data.tile?.index ?? 0));
    const result = treemap<Node>().tile(treemapSquarify).size([width, height]).paddingInner(gap).round(false)(root);
    return result.leaves().map(node => ({ ...node.data.tile!, x: Math.min(width, Math.max(0, node.x0)), y: Math.min(height, Math.max(0, node.y0)), width: Math.max(0, Math.min(width, node.x1) - Math.min(width, Math.max(0, node.x0))), height: Math.max(0, Math.min(height, node.y1) - Math.min(height, Math.max(0, node.y0))) }));
  }
</script>

<script lang="ts">
  import { money } from '../lib/format.ts';
  let { products, currency = 'USD', periodDays = 30 }: { products?: ProductSales[]; currency?: string; periodDays?: number } = $props();
  const entries = $derived(buildTiles(products ?? []));
  let chartWidth = $state(1000);
  const chartHeight = $derived(chartWidth * 0.4);
  const tiles = $derived(layoutTreemap(entries, chartWidth, chartHeight));
  let selected = $state<number | null>(null);
  const detail = $derived(entries.find(e => e.index === selected));
  const format = (v: number) => money(v, currency);
  const delta = (e: SalesTile) => e.isNew ? 'New from zero' : e.change === null ? 'No comparison' : `${e.change > 0 ? '+' : ''}${(e.change * 100).toFixed(1)}%`;
  const label = (e: SalesTile) => `${e.name}: ${format(e.current)}; previous: ${format(e.previous)}; ${delta(e)}`;
</script>

<div class="heatmap">
  <div class="heading"><h2>Revenue Heatmap</h2></div>
  {#if !products}<p class="empty">Product sales are not available from n8n yet. Reload to update Invenstory in n8n.</p>
  {:else if !entries.length}<p class="empty">No product sales in the last {periodDays * 2} days.</p>
  {:else}
    <div class="treemap" bind:clientWidth={chartWidth} aria-label="Product revenue; area represents current-period revenue">
      {#each tiles as tile (tile.index)}
        <button class="tile" class:light={tile.lightText} class:tiny={tile.width < 65 || tile.height < 30}
          style:left="{tile.x}px" style:top="{tile.y}px" style:width="{tile.width}px" style:height="{tile.height}px"
          style:--fill={tile.color} title={label(tile)} aria-label={label(tile)} aria-pressed={selected === tile.index} onclick={() => selected = selected === tile.index ? null : tile.index}>
          {#if tile.width >= 28 && tile.height >= 18}<span>{tile.name}{#if tile.width >= 65 && tile.height >= 42}<small>{format(tile.current)}</small>{/if}</span>{/if}
        </button>
      {/each}
      {#if !tiles.length}<p class="empty">No product revenue this period.</p>{/if}
    </div>
    <div class="legend"><span>Decrease</span><i></i><span>Increase</span></div>
    <p class="range">Last {periodDays} days vs the {periodDays} days before</p>
    {#if detail}<p class="detail" role="status">{label(detail)}</p>{/if}
    <details><summary>Values & comparison details</summary><div class="table-scroll"><table>
      <thead><tr><th>Product</th><th>Current</th><th>Previous</th><th>Change</th></tr></thead>
      <tbody>{#each entries as entry}<tr><th>{entry.name}</th><td>{format(entry.current)}</td><td>{format(entry.previous)}</td><td>{delta(entry)}</td></tr>{/each}</tbody>
    </table></div><p>Area follows this period's revenue. Blue = increase, yellow = unchanged, red = decrease; color saturates at ±100%. Products without revenue this period have no area. Shows the top 50 products by revenue.</p>
    </details>
  {/if}
</div>


<style>
  .heatmap { min-width: 0; }
  .heading { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  h2 { font:600 23px/1.1 Georgia,serif; letter-spacing:-0.03em; margin:0; }
  .treemap { position:relative; aspect-ratio:5 / 2; margin-top:6px; border-radius:12px; background:#f2e7db; overflow:hidden; }
  .tile { position:absolute; display:flex; align-items:center; justify-content:center; padding:4px; min-height:0; min-width:0; border:0; border-radius:4px; background:linear-gradient(135deg,#ffffff45,transparent 70%),var(--fill); color:#443425; font-size:clamp(12px,1.1vw,17px); font-weight:650; line-height:1.1; overflow:hidden; text-align:center; }
  .tile.light { color:#fff; text-shadow:0 1px 2px #21485b33; }
  .tile span { overflow:hidden; overflow-wrap:anywhere; max-height:100%; }
  .tile.tiny span { font-size:12px; }
  .tile:focus-visible, .tile[aria-pressed='true'] { outline:2px solid #5a392c; outline-offset:-4px; z-index:1; }
  .legend { display:flex; align-items:center; gap:5px; font-size:12px; color:#786c60; margin-top:5px; }
  .legend i { width:80px; height:6px; background:linear-gradient(90deg,#d5644b,#efd791 49%,#e0e8f8 51%,#3162b1); border-radius:8px; }
  .range { margin:4px 0; font-size:12px; color:#81756a; }
  .detail { font-size:13px; padding:5px 0; }
  details { color:#81756a; font-size:12px; }
  summary { cursor:pointer; }
  details p { line-height:1.5; margin-top:6px; }
  .table-scroll { overflow:auto; max-height:220px; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  td,th { padding:6px; text-align:right; border-bottom:1px solid #e8ddcf; }
  th:first-child { text-align:left; }
  .empty { padding:16px; font-size:12px; color:#786d65; }
  .tile small { display: block; font-size: 12px; font-weight: 500; margin-top: 4px; }
</style>
