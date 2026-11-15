<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { chat } from '../state/chat.svelte.ts';
  import { dashboard } from '../state/dashboard.svelte.ts';
  import { setup } from '../state/setup.svelte.ts';
  import { suggestIdeas } from '../lib/suggest.ts';
  import Icon from '../ui/Icon.svelte';
  import Settings from '../ui/Settings.svelte';
  import Chat from './Chat.svelte';

  const base = $derived(app.conn?.base ?? '');

  // Common places small shops keep stock and sales. `match` is a prefix of the n8n credential type.
  const CONNECTORS = [
    { name: 'Google Sheets', match: 'googleSheets' },
    { name: 'Shopify', match: 'shopify' },
    { name: 'WooCommerce', match: 'wooCommerce' },
    { name: 'Airtable', match: 'airtable' },
    { name: 'Stripe', match: 'stripe' },
    { name: 'Postgres', match: 'postgres' },
  ];
  const connected = (match: string) => setup.creds.some((c) => c.type.startsWith(match));

  const hasData = $derived(!!dashboard.data && dashboard.data.kpis.products + dashboard.data.kpis.units_sold > 0);
  const hasFlow = $derived(setup.flows.some((f) => f.active));

  // Re-check when coming back from adding an account in n8n, and after each chat run.
  $effect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void setup.check();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
  let wasRunning = false;
  $effect(() => {
    const running = chat.running;
    if (wasRunning && !running) void setup.check();
    wasRunning = running;
  });

  // One short LLM call per set of connected services, cached like the Automations tab.
  let ideas = $state<string[]>([]);
  $effect(() => {
    const types = [...new Set(setup.creds.map((c) => c.type))].sort();
    if (!app.llm || setup.loading) return;
    const key = `invenstory.ideas.${types.join(',')}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) return void (ideas = JSON.parse(cached) as string[]);
    } catch {
      /* storage unavailable */
    }
    void suggestIdeas($state.snapshot(app.llm), types)
      .then((list) => {
        ideas = list;
        try {
          localStorage.setItem(key, JSON.stringify(list));
        } catch {
          /* ignore */
        }
      })
      .catch(() => (ideas = []));
  });
</script>

<div class="stack">
  <header class="stack" style="gap: 4px">
    <h1>Let's connect your shop</h1>
    <p class="muted">Your dashboard opens once your stock is in and an automation keeps it up to date.</p>
  </header>

  <ol class="progress">
    <li class:ok={setup.creds.length > 0}><Icon name={setup.creds.length ? 'check' : 'link'} size={16} /> Connect where your stock lives</li>
    <li class:ok={hasFlow}><Icon name={hasFlow ? 'check' : 'link'} size={16} /> Set up an automation</li>
    <li class:ok={hasData}><Icon name={hasData ? 'check' : 'link'} size={16} /> Bring in your stock and sales</li>
  </ol>

  <section class="card" aria-labelledby="h-connect">
    <h2 id="h-connect">Connectors</h2>
    <ul class="grid">
      {#each CONNECTORS as c (c.name)}
        <li>
          <span>{c.name}</span>
          {#if connected(c.match)}
            <button class="link" onclick={() => chat.send(`I connected ${c.name}. Set it up to keep my stock and sales up to date.`)}>Use</button>
          {:else}
            <!-- /credentials/create opens n8n's "Add credential" picker; n8n has no URL parameter to preselect a type. -->
            <a class="link" href="{base}/home/credentials/create" target="_blank" rel="noopener">Add</a>
          {/if}
        </li>
      {/each}
    </ul>
    <p class="muted small">Add opens n8n in a new tab: pick the service, sign in, then come back here. Using something else? Just say so below.</p>
    {#if setup.error}<p class="error small" role="alert">{setup.error}</p>{/if}
  </section>

  {#if ideas.length}
    <section class="card" aria-labelledby="h-ideas">
      <h2 id="h-ideas">Ideas</h2>
      <div class="chips">{#each ideas as idea (idea)}<button class="chip" onclick={() => chat.send(idea)}>{idea}</button>{/each}</div>
    </section>
  {/if}

  <Chat active embedded />

  <details>
    <summary class="muted small">Settings</summary>
    <Settings />
  </details>
</div>

<style>
  .progress {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .progress li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .progress li.ok {
    color: var(--ok);
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }
  .grid li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    border-radius: 999px;
    min-height: 40px;
    font-size: 0.9rem;
    text-align: left;
  }
</style>
