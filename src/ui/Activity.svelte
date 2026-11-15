<script lang="ts">
  import { ago } from '../lib/format.ts';
  import { app } from '../state/app.svelte.ts';
  import Icon from './Icon.svelte';

  let { refreshKey = 0 }: { refreshKey?: number } = $props();

  interface Exec {
    id: string;
    workflowId: string;
    status: string;
    mode: string;
    startedAt: string;
  }
  let rows = $state<(Exec & { name: string })[]>([]);
  let error = $state<string | null>(null);
  let names = new Map<string, string>();

  async function load() {
    try {
      const apiId = app.install?.workflows.api;
      const mcp = app.mcp;
      const [ex, wfs] = await Promise.all([
        mcp.call<{ data: Exec[] }>('search_workflow_executions', { limit: 40 }),
        names.size ? Promise.resolve(null) : mcp.call<{ data: { id: string; name: string }[] }>('search_workflows', { limit: 200 }),
      ]);
      if (wfs) names = new Map(wfs.data.map((w) => [w.id, w.name]));
      // The dashboard's own reads are noise; everything else is activity.
      rows = ex.data
        .filter((e) => e.workflowId !== apiId)
        .slice(0, 8)
        .map((e) => ({ ...e, name: names.get(e.workflowId) ?? 'Workflow' }));
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void refreshKey;
    void load();
  });

  const failed = (s: string) => s === 'error' || s === 'crashed';
</script>

{#if error}
  <p class="error small" role="alert">{error}</p>
{:else if rows.length}
  <ul>
    {#each rows as r (r.id)}
      <li>
        <span class="status {failed(r.status) ? 'danger' : r.status === 'success' ? 'ok' : 'muted'}">
          <Icon name={failed(r.status) ? 'stop' : r.status === 'success' ? 'check' : 'refresh'} size={16} />
          <span class="sr">{r.status}</span>
        </span>
        <span class="name">{r.name.replace(/^invenstory-/, 'Invenstory ')}</span>
        <span class="muted small when">{failed(r.status) ? 'failed · ' : ''}{ago(r.startedAt)}</span>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted small">No workflow runs yet.</p>
{/if}

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .when {
    white-space: nowrap;
  }
  .status {
    display: inline-flex;
  }
  .ok {
    color: var(--ok);
  }
  .danger {
    color: var(--danger);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
