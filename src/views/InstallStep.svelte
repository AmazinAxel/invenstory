<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../state/app.svelte.ts';
  import { install } from '../lib/n8n/install.ts';
  import { localCurrency } from '../lib/format.ts';

  // Setup runs on its own once n8n and a model are connected; the owner never sees the internals.
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function run() {
    if (!app.conn || busy) return;
    busy = true;
    error = null;
    try {
      const info = await install(app.mcp, { base: app.conn.base, origin: location.origin, baseCurrency: localCurrency() });
      await app.saveInstall(info);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (app.conn && app.llm && !app.install && !error) untrack(run);
  });
</script>

{#if app.conn && app.llm && !app.install}
  <section class="card" aria-live="polite">
    {#if error}
      <p class="error small">Setup didn't finish: {error}</p>
      <button class="primary" onclick={run}>Try again</button>
    {:else}
      <p class="muted">Setting things up…</p>
    {/if}
  </section>
{/if}
