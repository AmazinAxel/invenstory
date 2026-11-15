<script lang="ts">
  import { money } from '../lib/format.ts';
  let { rows, currency }: { rows: { sku: string; name: string; units: number; revenue: number }[]; currency: string } = $props();
  const max = $derived(Math.max(1, ...rows.map((r) => r.revenue)));
</script>

{#if rows.length}
  <ol class="bars">
    {#each rows as r (r.sku)}
      <li title="{r.name}: {money(r.revenue, currency)}, {r.units} units">
        <div class="row">
          <span class="name">{r.name}</span>
          <span class="val">{money(r.revenue, currency)}</span>
        </div>
        <div class="track"><div class="bar" style="width: {Math.max(2, (r.revenue / max) * 100)}%"></div></div>
        <span class="units">{r.units} units</span>
      </li>
    {/each}
  </ol>
{:else}
  <p class="muted small">No sales in this period yet.</p>
{/if}

<style>
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
    --series: #0d9488;
  }
  @media (prefers-color-scheme: dark) {
    .bars {
      --series: #11a394;
    }
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.9rem;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .val {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .track {
    height: 8px;
    margin-top: 4px;
  }
  .bar {
    height: 100%;
    background: var(--series);
    border-radius: 0 4px 4px 0;
  }
  .units {
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
