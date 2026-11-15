<script module lang="ts">
  import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
  export interface HeatmapRow { name: string; days: { date: string; units: number | null; revenue: number | null }[] }
  type Metric = 'units' | 'revenue';
  export interface SalesTile { name: string; index: number; current: number | null; previous: number | null; change: number | null; isNew: boolean; color: string; lightText: boolean }
  const DAY = 86400000;
  function timestamp(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const value = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date ? value : NaN;
  }
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  export function changeColor(change: number | null, isNew = false) {
    if (change === null && !isNew) return '#b3aca3';
    const amount = isNew ? 1 : Math.max(-1, Math.min(1, change ?? 0));
    const yellow = [239, 215, 145], blue = [49, 98, 177], red = [213, 100, 75];
    const target = amount >= 0 ? blue : red;
    const base = amount > 0 ? [224, 232, 248] : yellow;
    return `rgb(${base.map((v, i) => Math.round(v + (target[i]! - v) * Math.abs(amount))).join(',')})`;
  }
  export function buildTreemap(rows: HeatmapRow[], metric: Metric, endDate: string, periodDays: number) {
    const end = timestamp(endDate);
    if (!Number.isFinite(end) || !Number.isInteger(periodDays) || periodDays < 1 || periodDays > 366) {
      return { entries: [] as SalesTile[], currentFrom: '', currentTo: '', previousFrom: '', previousTo: '', invalidDates: 0, error: 'A valid end date and period of 1–366 days are required.' };
    }
    const start = end - (periodDays - 1) * DAY;
    const previousStart = start - periodDays * DAY;
    let invalidDates = 0;
    const entries = rows.map((row, index): SalesTile => {
      const byDate = new Map<string, number | null>();
      for (const day of row.days) {
        if (!Number.isFinite(timestamp(day.date))) { invalidDates++; continue; }
        const v = day[metric];
        byDate.set(day.date, byDate.has(day.date) ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
      }
      function sum(from: number) {
        let total = 0;
        for (let i = 0; i < periodDays; i++) {
          const v = byDate.get(iso(from + i * DAY));
          if (v === null || v === undefined) return null;
          total += v;
        }
        return Number.isFinite(total) ? total : null;
      }
      const current = sum(start), previous = sum(previousStart);
      const isNew = current !== null && current > 0 && previous === 0;
      const change = current === null || previous === null || isNew ? null : previous === 0 ? 0 : (current - previous) / previous;
      return { name: row.name, index, current, previous, change, isNew, color: changeColor(change, isNew), lightText: isNew || (change !== null && change >= 0.55) };
    });
    return {entries, currentFrom: iso(start), currentTo: iso(end), previousFrom: iso(previousStart), previousTo: iso(start - DAY), invalidDates, error: ''};
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
  let { rows = [], currency = 'USD', endDate = '', periodDays = 30 }: { rows?: HeatmapRow[]; currency?: string; demo?: boolean; endDate?: string; periodDays?: number } = $props();
  const metric: Metric = 'revenue';
  const model = $derived(buildTreemap(rows, metric, endDate, periodDays));
  let chartWidth = $state(1000);
  const chartHeight = $derived(chartWidth * 0.4);
  const tiles = $derived(layoutTreemap(model.entries, chartWidth, chartHeight));
  const revenues = $derived(buildTreemap(rows, 'revenue', endDate, periodDays).entries);
  let selected = $state<number | null>(null);
  const detail = $derived(model.entries.find(e => e.index === selected));
  const format = (v: number | null) => v === null ? 'Missing data' : metric === 'revenue' ? money(v, currency) : v.toLocaleString();
  const delta = (e: SalesTile) => e.isNew ? 'New from zero' : e.change === null ? 'No comparison' : `${e.change > 0 ? '+' : ''}${(e.change * 100).toFixed(1)}%`;
  const label = (e: SalesTile) => `${e.name}: ${format(e.current)}; previous: ${format(e.previous)}; ${delta(e)}`;
</script>

<div class="heatmap">
  <div class="heading"><h2>Revenue Heatmap</h2></div>
  {#if model.error}<p class="empty">{model.error}</p>
  {:else if !rows.length}<p class="empty">Category sales data is not connected yet.</p>
  {:else}
    <div class="treemap" bind:clientWidth={chartWidth} aria-label="Category totals; area represents current-period total">
      {#each tiles as tile (tile.index)}
        <button class="tile" class:light={tile.lightText} class:tiny={tile.width < 65 || tile.height < 30}
          style:left="{tile.x}px" style:top="{tile.y}px" style:width="{tile.width}px" style:height="{tile.height}px"
          style:--fill={tile.color} title={label(tile)} aria-label={label(tile)} aria-pressed={selected === tile.index} onclick={() => selected = selected === tile.index ? null : tile.index}>
          {#if tile.width >= 28 && tile.height >= 18}<span>{tile.name}{#if tile.width >= 65 && tile.height >= 42}<small>{revenues[tile.index]?.current == null ? 'Revenue unavailable' : money(revenues[tile.index]!.current!, currency)}</small>{/if}</span>{/if}
        </button>
      {/each}
      {#if !tiles.length}<p class="empty">No positive, complete current-period totals.</p>{/if}
    </div>
    <div class="legend"><span>Decrease</span><i></i><span>Increase</span><span class="neutral">Gray: no prior data</span></div>
    <p class="range">{model.currentFrom} – {model.currentTo} vs {model.previousFrom} – {model.previousTo}</p>
    {#if detail}<p class="detail" role="status">{label(detail)}</p>{/if}
    <details><summary>Values & comparison details</summary><div class="table-scroll"><table>
      <thead><tr><th>Category</th><th>Current</th><th>Previous</th><th>Change</th></tr></thead>
      <tbody>{#each model.entries as entry}<tr><th>{entry.name}</th><td>{format(entry.current)}</td><td>{format(entry.previous)}</td><td>{delta(entry)}</td></tr>{/each}</tbody>
    </table></div><p>Area follows the selected period total. Blue = increase, yellow = unchanged, red = decrease; color saturates at ±100%. Zero totals have no area. Missing daily values and duplicate dates are unknown, not zero.</p>
    {#if model.invalidDates}<p>{model.invalidDates} invalid date records ignored.</p>{/if}
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
  .neutral { margin-left:auto; }
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
