<script lang="ts">
  import { dashboard as d } from '../state/dashboard.svelte.ts';
  import { money, count, ago } from '../lib/format.ts';
  import type { Period } from '../lib/n8n/api.ts';
  import Kpi from '../ui/Kpi.svelte';
  import Trend from '../ui/Trend.svelte';
  import StockOverview, { type StockAlerts } from '../ui/StockOverview.svelte';
  import SalesHeatmap from '../ui/SalesHeatmap.svelte';
  import ActionItemRow from '../ui/ActionItem.svelte';
  import Activity from '../ui/Activity.svelte';
  import Icon from '../ui/Icon.svelte';
  import Md from '../ui/Md.svelte';
  import NotifyPrompt from '../ui/NotifyPrompt.svelte';

  let { onchat }: { onchat: () => void } = $props();
  let activityKey = $state(0);


  const s = $derived(d.data);
  const cur = $derived(s?.currency ?? 'USD');
  const insight = $derived.by(() => {
    const m = s?.session?.origin === 'analysis' ? s.session.messages.find((x) => x.role === 'assistant') : null;
    const c = m?.content as { type?: string; text?: string; invest?: Invest[] } | undefined;
    return c?.type === 'insight' ? { text: c.text ?? '', at: s!.session!.created_at, invest: Array.isArray(c.invest) ? c.invest : [] } : null;
  });
  type Invest = { sku: string; name: string; reason: string };
  let stockAlerts = $state<StockAlerts>({ loading: true, error: '', items: [] });
  const periods: Period[] = ['7d', '30d', '90d'];
</script>

<div class="dashboard">
  <div class="notify"><NotifyPrompt /></div>
  {#if d.error}<p class="error small" role="alert">{d.error}</p>{/if}

  {#if !s}
    <p class="muted">{d.loading ? 'Loading…' : ''}</p>
  {:else}
    {#if insight?.invest.length}
      <section class="card invest-card" aria-labelledby="h-invest">
        <div class="row between">
          <h2 id="h-invest">Invest more in</h2>
          <span class="muted small">{ago(insight.at)}</span>
        </div>
        <ol class="invest-list">
          {#each insight.invest as p, i (i)}
            <li><strong>{p.name}</strong>{#if p.reason}<span class="muted"> {p.reason}</span>{/if}</li>
          {/each}
        </ol>
      </section>
    {/if}
    <section class="card actions-banner" aria-labelledby="h-actions">
      <div class="row between">
        <h2 id="h-actions">Action items</h2>
        <span class="attention-badge" class:out={s.kpis.out_of_stock > 0}>Needs attention: {count(s.kpis.out_of_stock + s.kpis.low_stock)}</span>
        {#if s.config.analysis}
          <button class="link" disabled={d.analysing} onclick={() => d.analyze()}>{d.analysing ? 'Analysing…' : 'Analyse now'}</button>
        {/if}
      </div>
      {#if stockAlerts.loading}
        <p class="muted small" role="status">Loading inventory alerts…</p>
      {:else if stockAlerts.error}
        <p class="error small" role="alert">Could not load complete inventory alerts. {stockAlerts.error}</p>
      {:else if stockAlerts.items.length}
        <ul class="inventory-alerts">
          {#each stockAlerts.items as item (item.sku)}
            <li class:out={item.status === 'out'}>{item.status === 'out' ? item.name + ' is out of stock.' : item.name + ' is running low, with ' + count(item.quantity) + ' units remaining.'}</li>
          {/each}
        </ul>
      {:else}
        <p class="muted small">All products are sufficiently stocked.</p>
      {/if}
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

<section class="stock-column" aria-label="Current inventory">
      <h1 class="column-title">Stock Overview</h1>
      <StockOverview api={d.api} refreshKey={s.generated_at} onalerts={(state) => stockAlerts = state} />
    </section>
    <section class="insights-mode" aria-label="Business overview">
      <h1 class="column-title">Insights</h1>
      <div class="period-row"><span>Sales period</span><div class="segmented period" role="group" aria-label="Sales period">
        {#each periods as p (p)}<button aria-pressed={d.period === p} onclick={() => d.setPeriod(p)}>{p}</button>{/each}
      </div></div>
    <div class="insights-grid">
    <section class="kpis" aria-label="Key figures">
      <Kpi label="Revenue" value={money(s.kpis.revenue, cur)} hint="last {s.period}" />
      <Kpi label="Units sold" value={count(s.kpis.units_sold)} hint="last {s.period}" />
      <Kpi label="Stock value" value={money(s.kpis.stock_value, cur)} hint="{count(s.kpis.products)} products" />

    </section>
    {#if s.kpis.excluded_rows}
      <p class="muted small">{s.kpis.excluded_rows} rows in other currencies are not counted in {cur} totals.</p>
    {/if}

    <section class="card sales-card" aria-labelledby="h-trend">
      <h2 id="h-trend">Sales</h2>
      <Trend data={s.sales_trend} currency={cur} height={94} />
    </section>

    <section class="card insight-card" aria-labelledby="h-insight">
      <h2 id="h-insight">Latest analysis</h2>
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

    <section class="card heatmap-card" aria-label="Sales heatmap">
      <SalesHeatmap products={s.product_sales} currency={cur} periodDays={Number(s.period.slice(0, -1))} />
    </section>

    <section class="card activity-card" aria-labelledby="h-activity">
      <div class="row between">
        <h2 id="h-activity">Workflow activity</h2>
        <button class="icon" aria-label="Refresh activity" onclick={() => activityKey++}><Icon name="refresh" size={18} /></button>
      </div>
      <Activity refreshKey={activityKey + (s ? 1 : 0)} />
    </section>
    </div>
    </section>
  {/if}
</div>

<style>
  .column-title { font: 600 30px/1.15 Georgia, serif; letter-spacing: -0.035em; margin: 0 0 12px; }
  .stock-column > .column-title { padding: 18px 18px 0; }
  .insights-mode > .column-title { color: var(--text); margin-bottom: 0; }
  .stock-column { min-width: 0; container-type: inline-size; container-name: stock; }
  .dashboard > .error, .dashboard > .muted, .dashboard > .notify { grid-column: 1 / -1; }
  .notify:empty { display: none; }
  @container shell (min-width: 1000px) {
    .dashboard.dashboard { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr); align-items: start; }
  }
  .dashboard {
    --bg: #f8f0e8; --surface: #fcf6ef; --text: #292620; --muted: #7b7068;
    --line: #e6d9ce; --accent: #a74f47; --accent-text: #fff9f4;
    --danger: #b7473b; --warn: #a4513e; --ok: #75634e;
    color: var(--text); color-scheme: light;
    background: radial-gradient(ellipse at 85% 8%, #eee2d7 0, transparent 50%), var(--bg);
    border-radius: 24px; padding: 0;
    display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px;
  }
  .insights-mode { container-type: inline-size; container-name: business; min-width: 0; position: relative; isolation: isolate; overflow: hidden; background: var(--bg); border-radius: 24px; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-content: start; }
  .insights-mode .period { background: #fff7ecdd; }
  .insights-mode .insights-grid {
    margin-left: 10px; padding: 10px; grid-column: 1 / -1;
    background: #fff4e5a8; border: 1px solid #fff8ed88; border-radius: 28px;
    backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
    box-shadow: 0 18px 45px #33221e24, inset 0 1px 0 #fff9;
  }
  .insights-mode .card, .insights-mode :global(.kpi) {
    background: #fff8eef0; border-color: #fff9edaa;
    box-shadow: 0 5px 15px #4f302015;
  }
  .insights-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .kpis, .heatmap-card, .activity-card, .insights-grid > p { grid-column: 1 / -1; }
  .activity-card { padding: 9px 12px; gap: 5px; }
  .activity-card h2 { font-size: 19px; }
  .activity-card .icon { width: 30px; min-height: 30px; }
  .activity-card :global(ul) { display: flex; gap: 12px; overflow-x: auto; margin: 0; padding: 0; }
  .activity-card :global(li) { flex: 0 0 auto; max-width: 360px; padding: 6px 0; border-bottom: 0; }
  .activity-card :global(.name) { max-width: 220px; }
  .activity-card :global(.when) { white-space: nowrap; }
  .card { min-width: 0; border-radius: 16px; padding: 10px; box-shadow: 0 5px 13px #5c3f2b0a; align-content: start; }
  .card h2 { font: 600 20px/1.15 Georgia, 'Times New Roman', serif; letter-spacing: -0.035em; }
  .dashboard :global(.kpi) { border-radius: 14px; padding: 9px 10px; box-shadow: 0 4px 10px #5c3f2b08; }
  .dashboard :global(.kpi .value) { font: 600 23px/1.25 Georgia, serif; }
  .sales-card :global(.trend) { --series: #c77d6e; }
  .sales-card :global(figure) { min-width: 0; }
  .sales-card :global(svg) { max-width: 100%; }
  @container business (max-width: 480px) {
    .insights-mode .insights-grid { margin-left: 0; padding: 12px; border-radius: 22px; gap: 12px; }
    .insights-grid { grid-template-columns: minmax(0, 1fr); }
    .card { padding: 18px; }
    .dashboard :global(.kpi .value) { font-size: 24px; }
  }
  .period-row { display: flex; justify-content: flex-end; align-items: center; gap: 12px; color: var(--text); font-size: 11px; }
  .period {
    min-width: 168px;
  }
  .between {
    justify-content: space-between;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  @container business (min-width: 620px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
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
  .activity-card :global(li) { font-size: 11px; }
  .activity-card :global(.when) { font-size: 10px; }
  .period-row > span { display: none; }
  .period button { min-height: 30px; font-size: 11px; padding: 0 9px; }
  .period { min-width: 136px; }
  @container business (min-width: 520px) { .kpis { grid-template-columns: repeat(3,minmax(0,1fr)); } }
  .actions-banner { grid-column: 1 / -1; text-align: center; padding: 10px 16px; max-height: none; overflow: visible; }
  .actions-banner > .row { justify-content: center; gap: 16px; }
  .actions-banner .plain { display: flex; gap: 16px; text-align: left; }
  .actions-banner .plain :global(li) { flex: 1; min-width: 260px; }
  .insights-grid { grid-template-columns: minmax(0, 1fr); }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @container business (min-width: 520px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .actions-banner .plain :global(.item) { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
  .actions-banner :global(h3) { font-size: 12px; }
  .actions-banner :global(button) { min-height: 28px; font-size: 11px; }
  .actions-banner :global(.text) { min-width: 0; }
  .actions-banner :global(.actions) { flex-shrink: 0; }
  .actions-banner :global(p) { margin: 0; font-size: 11px; }
  .dashboard :global(.kpi) { padding: 6px 10px; gap: 2px; }
  .dashboard :global(.kpi) { min-width: 0; padding: 8px; }
  .dashboard :global(.kpi .value) { font-size: 19px; overflow-wrap: anywhere; }
  .dashboard :global(.kpi .label), .dashboard :global(.kpi .hint) { font-size: 10px; }
  .actions-banner .plain, .activity-card :global(ul) { flex-wrap: wrap; overflow: visible; }
  .dashboard :global(.kpi .value) { white-space: normal; overflow: visible; }
  .invest-card { grid-column: 1 / -1; padding: 10px 16px; }
  .invest-list { margin: 0; padding-left: 22px; display: grid; gap: 6px; font-size: 14px; line-height: 1.5; }
  .invest-list li::marker { color: var(--accent); font-weight: 600; }
  .inventory-alerts { margin: 0; padding-left: 18px; display: grid; gap: 8px; line-height: 1.5; }
  .inventory-alerts li::marker { color: #b06b5b; }
  .inventory-alerts li.out { color: #9e453b; }
  .attention-badge { font-size: 13px; padding: 4px 9px; border-radius: 12px; color: #844a38; background: #f2dfd2; }
  .attention-badge.out { color: #9e453b; background: #f1d5cd; }
  .actions-banner .inventory-alerts { text-align: left; font-size: 14px; }
  .dashboard :global(.kpi .label), .dashboard :global(.kpi .hint) { font-size: 12px; }
  .activity-card :global(li), .activity-card :global(.when) { font-size: 13px; }
  .period button { font-size: 12px; }
  .actions-banner :global(p), .actions-banner :global(h3), .actions-banner :global(button) { font-size: 13px; }
</style>
