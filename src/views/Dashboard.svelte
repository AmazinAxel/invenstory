<script lang="ts">
  import { dashboard as d } from '../state/dashboard.svelte.ts';
  import { money, count, ago } from '../lib/format.ts';
  import type { Period } from '../lib/n8n/api.ts';
  import Kpi from '../ui/Kpi.svelte';
  import Trend from '../ui/Trend.svelte';
  import TopSellers from '../ui/TopSellers.svelte';
  import StockList from '../ui/StockList.svelte';
  import ActionItemRow from '../ui/ActionItem.svelte';
  import Activity from '../ui/Activity.svelte';
  import Md from '../ui/Md.svelte';
  import Icon from '../ui/Icon.svelte';
  import NotifyPrompt from '../ui/NotifyPrompt.svelte';

  let { onchat }: { onchat: () => void } = $props();
  let activityKey = $state(0);

  const s = $derived(d.data);
  const cur = $derived(s?.currency ?? 'USD');
  const insight = $derived.by(() => {
    const m = s?.session?.origin === 'analysis' ? s.session.messages.find((x) => x.role === 'assistant') : null;
    const c = m?.content as { type?: string; text?: string } | undefined;
    return c?.type === 'insight' ? { text: c.text ?? '', at: s!.session!.created_at } : null;
  });
  const periods: Period[] = ['7d', '30d', '90d'];
</script>

<div class="stack">
  <header class="row head">
    <h1>Overview</h1>
    <div class="segmented period" role="group" aria-label="Period">
      {#each periods as p (p)}
        <button aria-pressed={d.period === p} onclick={() => d.setPeriod(p)}>{p}</button>
      {/each}
    </div>
  </header>

  <NotifyPrompt />

  {#if d.error}<p class="error small" role="alert">{d.error}</p>{/if}

  {#if !s}
    <p class="muted">{d.loading ? 'Loading…' : ''}</p>
  {:else}
    <section class="kpis" aria-label="Key figures">
      <Kpi label="Revenue" value={money(s.kpis.revenue, cur)} hint="last {s.period}" />
      <Kpi label="Units sold" value={count(s.kpis.units_sold)} hint="last {s.period}" />
      <Kpi label="Stock value" value={money(s.kpis.stock_value, cur)} hint="{count(s.kpis.products)} products" />
      <Kpi
        label="Needs attention"
        value={count(s.kpis.out_of_stock + s.kpis.low_stock)}
        hint="{s.kpis.out_of_stock} out · {s.kpis.low_stock} low"
        status={s.kpis.out_of_stock ? { icon: 'stop', tone: 'danger' } : s.kpis.low_stock ? { icon: 'alert', tone: 'warn' } : undefined}
      />
    </section>
    {#if s.kpis.excluded_rows}
      <p class="muted small">{s.kpis.excluded_rows} rows in other currencies are not counted in {cur} totals.</p>
    {/if}

    <section class="card" aria-labelledby="h-actions">
      <div class="row between">
        <h2 id="h-actions">Action items</h2>
        {#if s.config.analysis}
          <button class="link" disabled={d.analysing} onclick={() => d.analyze()}>{d.analysing ? 'Analysing…' : 'Analyse now'}</button>
        {/if}
      </div>
      {#if s.action_items.length}
        <ul class="plain">
          {#each s.action_items as item (item.item_id)}
            <ActionItemRow
              {item}
              busy={d.busy[item.item_id]}
              result={d.results[item.item_id]}
              onact={() => d.act(item)}
              ondismiss={() => d.dismiss(item)}
            />
          {/each}
        </ul>
      {:else}
        <p class="muted small">Nothing to do right now.</p>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-insights">
      <h2 id="h-insights">Insights</h2>
      {#if insight}
        <Md text={insight.text} />
        <div class="row between">
          <span class="muted small">{ago(insight.at)}</span>
          <button class="link" onclick={onchat}>Ask a follow-up</button>
        </div>
      {:else if s.config.analysis}
        <p class="muted small">Insights appear after the next analysis.</p>
      {:else}
        <p class="muted small">Add an LLM credential in n8n to get insights. See Automations.</p>
      {/if}
    </section>

    <section class="card" aria-labelledby="h-trend">
      <h2 id="h-trend">Sales</h2>
      <Trend data={s.sales_trend} currency={cur} />
    </section>

    <section class="card" aria-labelledby="h-top">
      <h2 id="h-top">Top sellers</h2>
      <TopSellers rows={s.top_sellers} currency={cur} />
    </section>

    <section class="card" aria-labelledby="h-stock">
      <h2 id="h-stock">Stock</h2>
      <StockList api={d.api} currency={cur} />
    </section>

    <section class="card" aria-labelledby="h-activity">
      <div class="row between">
        <h2 id="h-activity">Workflow activity</h2>
        <button class="icon" aria-label="Refresh activity" onclick={() => activityKey++}><Icon name="refresh" size={18} /></button>
      </div>
      <Activity refreshKey={activityKey + (s ? 1 : 0)} />
    </section>
  {/if}
</div>

<style>
  .head {
    justify-content: space-between;
  }
  .period {
    min-width: 168px;
  }
  .between {
    justify-content: space-between;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  @media (min-width: 720px) {
    .kpis {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .icon {
    width: 40px;
    min-height: 40px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: none;
    color: var(--muted);
  }
</style>
