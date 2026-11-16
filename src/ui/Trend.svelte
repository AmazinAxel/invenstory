<script lang="ts">
  import { money, shortDate } from '../lib/format.ts';

  let { data, currency, height = 168 }: { data: { date: string; revenue: number; units: number }[]; currency: string; height?: number } = $props();

  const H = $derived(height);
  const PAD = { top: 12, right: 8, bottom: 22, left: 8 };
  let width = $state(320);
  let hover = $state<number | null>(null);

  const max = $derived(Math.max(1, ...data.map((d) => d.revenue)));
  // Round the top gridline up to a friendly number.
  const top = $derived.by(() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  });
  const innerW = $derived(Math.max(10, width - PAD.left - PAD.right));
  const innerH = $derived(H - PAD.top - PAD.bottom);
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const line = $derived(data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.revenue).toFixed(1)}`).join(''));
  const area = $derived(data.length ? `${line}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '');
  const total = $derived(data.reduce((s, d) => s + d.revenue, 0));

  function move(e: PointerEvent) {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const rel = (e.clientX - rect.left - PAD.left) / innerW;
    hover = Math.min(data.length - 1, Math.max(0, Math.round(rel * (data.length - 1))));
  }
  function key(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const cur = hover ?? data.length - 1;
    hover = Math.min(data.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)));
  }
  const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(x(hover) - 70, 0), width - 140));
  const point = $derived(hover === null ? undefined : data[hover]);
</script>

<figure class="trend" bind:clientWidth={width}>
  <figcaption class="sr-only">Daily revenue, {data.length} days, total {money(total, currency)}</figcaption>
  <svg
    {width}
    height={H}
    role="slider"
    aria-label="Revenue per day"
    aria-valuemin={0}
    aria-valuemax={Math.max(0, data.length - 1)}
    aria-valuenow={hover ?? Math.max(0, data.length - 1)}
    aria-valuetext={point ? `${shortDate(point.date)}: ${money(point.revenue, currency)}` : 'Use arrow keys to inspect days'}
    tabindex="0"
    onpointermove={move}
    onpointerdown={move}
    onpointerleave={() => (hover = null)}
    onkeydown={key}
    onblur={() => (hover = null)}
  >
    {#each [0.5, 1] as f (f)}
      <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(top * f)} y2={y(top * f)} />
      <text class="axis" x={PAD.left} y={y(top * f) - 4}>{money(top * f, currency, true)}</text>
    {/each}
    <line class="base" x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} />
    <path class="area" d={area} />
    <path class="line" d={line} />
    {#if data.length}
      <text class="axis" x={PAD.left} y={H - 6}>{shortDate(data[0]!.date)}</text>
      <text class="axis" x={width - PAD.right} y={H - 6} text-anchor="end">{shortDate(data[data.length - 1]!.date)}</text>
    {/if}
    {#if hover !== null && point}
      <line class="cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} />
      <circle class="dot" cx={x(hover)} cy={y(point.revenue)} r="4.5" />
    {/if}
  </svg>
  {#if point}
    <div class="tip" style="left: {tipLeft}px" role="status">
      <strong>{shortDate(point.date)}</strong>
      <span>{money(point.revenue, currency)}</span>
      <span class="muted">{point.units} units</span>
    </div>
  {/if}
  <details class="table">
    <summary>Show as table</summary>
    <table>
      <thead><tr><th>Day</th><th>Revenue</th><th>Units</th></tr></thead>
      <tbody>
        {#each data as d (d.date)}
          <tr><td>{shortDate(d.date)}</td><td>{money(d.revenue, currency)}</td><td>{d.units}</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>

<style>
  .trend {
    position: relative;
    margin: 0;
    --series: var(--accent);
  }
  @media (prefers-color-scheme: dark) {
    .trend {
      --series: #11a394;
    }
  }
  svg {
    display: block;
    touch-action: pan-y;
    outline: none;
  }
  svg:focus-visible {
    outline: 2px solid var(--accent);
    border-radius: 6px;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .base {
    stroke: var(--muted);
    stroke-width: 1;
    opacity: 0.5;
  }
  .axis {
    fill: var(--muted);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .area {
    fill: var(--series);
    opacity: 0.12;
  }
  .line {
    fill: none;
    stroke: var(--series);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .cross {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .dot {
    fill: var(--series);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .tip {
    position: absolute;
    top: 0;
    width: 140px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.8rem;
    display: grid;
    pointer-events: none;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
    font-variant-numeric: tabular-nums;
  }
  .table summary {
    font-size: 0.8rem;
    color: var(--muted);
    cursor: pointer;
    margin-top: 4px;
  }
  table {
    width: 100%;
    font-size: 0.8rem;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: right;
    padding: 2px 4px;
  }
  th:first-child,
  td:first-child {
    text-align: left;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
