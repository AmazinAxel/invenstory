<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { chat } from '../state/chat.svelte.ts';
  import { dashboard } from '../state/dashboard.svelte.ts';
  import { analysisChoices, listCredentials, readRows, setupAnalysis, type CredentialInfo } from '../lib/n8n/install.ts';
  import type { ModelChoice } from '../lib/n8n/core/analyze.ts';
  import { NAME_PREFIX } from '../lib/agent/tools.ts';
  import { humanType, suggestIdeas } from '../lib/suggest.ts';
  import { ago } from '../lib/format.ts';
  import Prompt from '../ui/Prompt.svelte';
  import Icon from '../ui/Icon.svelte';
  import Settings from '../ui/Settings.svelte';

  let { onchat, active }: { onchat: () => void; active: boolean } = $props();
  // Shell keeps every tab mounted; wait for the first visit so app start spends no n8n MCP calls (rate-limited) or LLM calls here.
  let opened = $state(false);
  $effect(() => {
    if (active) opened = true;
  });

  const base = $derived(app.conn?.base ?? '');
  let creds = $state<CredentialInfo[]>([]);
  let llmCreds = $state<(CredentialInfo & { choice: ModelChoice })[]>([]);
  let flows = $state<{ id: string; name: string; active: boolean; updatedAt: string }[]>([]);
  let actions = $state<{ workflow_id: string; name: string; description: string }[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(false);

  async function load() {
    if (!app.install) return;
    loading = true;
    try {
      const mcp = app.mcp;
      const inst = app.install;
      const [c, w, a] = await Promise.all([
        listCredentials(mcp),
        mcp.call<{ data: { id: string; name: string; active: boolean; updatedAt: string; isArchived?: boolean }[] }>('search_workflows', { query: 'Invenstory', limit: 100 }),
        readRows<{ workflow_id: string; name: string; description: string }>(mcp, inst.projectId, inst.tables.inv_actions),
      ]);
      creds = c;
      llmCreds = analysisChoices(c);
      flows = w.data.filter((x) => x.name.startsWith(NAME_PREFIX) && !x.isArchived);
      // inv_actions is append-only on register; the newest row per workflow wins.
      const seen = new Map<string, (typeof a)[number]>();
      for (const r of a) seen.set(r.workflow_id, r);
      actions = [...seen.values()].filter((r) => flows.some((f) => f.id === r.workflow_id));
      loadError = null;
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void chat.changed;
    if (opened) void load();
  });

  // ----- analysis setup -----
  let pick = $state('');
  let model = $state('');
  let setupBusy = $state(false);
  let setupStep = $state('');
  let setupError = $state<string | null>(null);
  const picked = $derived(llmCreds.find((c) => c.id === pick) ?? llmCreds[0]);
  $effect(() => {
    if (picked) model = picked.choice.defaultModel;
  });

  async function setup() {
    if (!picked || !app.install) return;
    setupBusy = true;
    setupError = null;
    try {
      const info = await setupAnalysis(app.mcp, $state.snapshot(app.install), picked, model.trim(), (m) => (setupStep = m));
      await app.saveInstall(info);
      void dashboard.refresh('action');
    } catch (e) {
      setupError = e instanceof Error ? e.message : String(e);
    } finally {
      setupBusy = false;
    }
  }

  async function unregister(workflowId: string) {
    try {
      await dashboard.api.post('action.unregister', { workflow_id: workflowId });
      actions = actions.filter((a) => a.workflow_id !== workflowId);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  }

  // ----- connector search (live from n8n) -----
  let query = $state('');
  let found = $state<{ id: string; name: string; description: string; trigger: boolean }[]>([]);
  let searching = $state(false);
  async function searchNodes() {
    const q = query.trim();
    if (!q) return;
    searching = true;
    try {
      const r = await app.mcp.callTool('search_nodes', { queries: [q] });
      const text = r.content.map((c) => c.text ?? '').join('');
      found = [...text.matchAll(/- (\S+?)( \[TRIGGER\])?\n\s+Display Name: ([^\n]+)\n\s+Version: [^\n]+\n\s+Description: ([^\n]+)/g)].map((m) => ({
        id: m[1]!,
        trigger: !!m[2],
        name: m[3]!,
        description: m[4]!,
      }));
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      searching = false;
    }
  }

  // ----- suggestion chips: one LLM call whenever the credential set changes -----
  let ideas = $state<string[]>([]);
  $effect(() => {
    const types = [...new Set(creds.map((c) => c.type))].sort();
    if (!opened || !app.llm || loading) return;
    const key = `invenstory.ideas.${types.join(',')}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) return void (ideas = JSON.parse(cached) as string[]);
    } catch {
      /* storage unavailable */
    }
    const cfg = $state.snapshot(app.llm);
    void suggestIdeas(cfg, types)
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

  function ask(text: string) {
    onchat();
    void chat.send(text);
  }
</script>

<div class="stack">
  <h1>Automations</h1>
  {#if loadError}<p class="error small" role="alert">{loadError}</p>{/if}

  <section class="card" aria-labelledby="h-new">
    <h2 id="h-new">Describe an automation</h2>
    <Prompt running={chat.running} onsend={ask} onstop={() => chat.stop()} placeholder="e.g. Sync my Shopify stock every hour" />
    {#if ideas.length}
      <div class="chips">{#each ideas as idea (idea)}<button class="chip" onclick={() => ask(idea)}>{idea}</button>{/each}</div>
    {/if}
  </section>

  <section class="card" aria-labelledby="h-analysis">
    <h2 id="h-analysis">Analysis</h2>
    {#if app.install?.workflows.analyze}
      <p class="ok small">Analysis runs in n8n after data changes.</p>
      <button class="link" onclick={() => dashboard.analyze()} disabled={dashboard.analysing}>{dashboard.analysing ? 'Analysing…' : 'Run analysis now'}</button>
    {:else if llmCreds.length}
      <p class="muted small">Pick the n8n credential analysis should use.</p>
      <label>
        Credential
        <select bind:value={pick}>
          {#each llmCreds as c (c.id)}<option value={c.id}>{c.name} · {c.choice.label}</option>{/each}
        </select>
      </label>
      <label>Model <input bind:value={model} placeholder="n8n default" autocapitalize="off" spellcheck="false" /></label>
      <button class="primary" disabled={setupBusy} onclick={setup}>{setupBusy ? setupStep || 'Setting up…' : 'Set up analysis'}</button>
      {#if setupError}<p class="error small">{setupError}</p>{/if}
    {:else}
      <p class="muted small">Analysis needs an LLM credential (Anthropic, OpenAI, Gemini, OpenRouter, xAI, Groq or Mistral) in n8n.</p>
      <div class="row">
        <a class="button" href="{base}/home/credentials/create" target="_blank" rel="noopener">Add it in n8n</a>
        <button onclick={load} disabled={loading}>Check again</button>
      </div>
    {/if}
  </section>

  <section class="card" aria-labelledby="h-flows">
    <h2 id="h-flows">Your automations</h2>
    {#if flows.length}
      <ul class="list">
        {#each flows as f (f.id)}
          <li>
            <span class="dot {f.active ? 'on' : ''}" aria-hidden="true"></span>
            <div class="main">
              <span>{f.name.slice(NAME_PREFIX.length)}</span>
              <span class="muted small">{f.active ? 'Active' : 'Draft'} · changed {ago(f.updatedAt)}</span>
            </div>
            <a href="{base}/workflow/{f.id}" target="_blank" rel="noopener" aria-label="Open {f.name} in n8n"><Icon name="link" size={18} /></a>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">{loading ? 'Loading…' : 'None yet. Describe one above.'}</p>
    {/if}
    {#if actions.length}
      <h3>One-tap actions</h3>
      <ul class="list">
        {#each actions as a (a.workflow_id)}
          <li>
            <div class="main"><span>{a.name}</span><span class="muted small">{a.description}</span></div>
            <button class="link" onclick={() => unregister(a.workflow_id)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card" aria-labelledby="h-accounts">
    <h2 id="h-accounts">Connected accounts</h2>
    {#if creds.length}
      <ul class="list">
        {#each creds as c (c.id)}
          <li><div class="main"><span>{c.name}</span><span class="muted small">{humanType(c.type)}</span></div></li>
        {/each}
      </ul>
    {:else}
      <p class="muted small">{loading ? 'Loading…' : 'No accounts connected in n8n yet.'}</p>
    {/if}
    <a class="button" href="{base}/home/credentials/create" target="_blank" rel="noopener">Add an account in n8n</a>
  </section>

  <section class="card" aria-labelledby="h-nodes">
    <h2 id="h-nodes">Find a connector</h2>
    <form class="row" onsubmit={(e) => (e.preventDefault(), searchNodes())}>
      <input bind:value={query} placeholder="e.g. Shopify, Airtable, Postgres" style="flex: 1" autocapitalize="off" />
      <button type="submit" disabled={searching || !query.trim()}>{searching ? '…' : 'Search'}</button>
    </form>
    {#if found.length}
      <ul class="list">
        {#each found as n (n.id)}
          <li>
            <div class="main"><span>{n.name}{n.trigger ? ' · trigger' : ''}</span><span class="muted small">{n.description}</span></div>
            <button class="link" onclick={() => ask(`Use ${n.name} (${n.id}) to keep my stock and sales up to date.`)}>Use</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <Settings />
</div>

<style>
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
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .list li:last-child {
    border-bottom: 0;
  }
  .main {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .main > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--muted);
    flex: none;
  }
  .dot.on {
    background: var(--ok);
    border-color: var(--ok);
  }
  .button {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 16px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    text-decoration: none;
  }
  h3 {
    margin-top: 8px;
  }
</style>
