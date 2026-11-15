<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { install } from '../lib/n8n/install.ts';
  import { localCurrency } from '../lib/format.ts';

  let busy = $state(false);
  let step = $state('');
  let error = $state<string | null>(null);

  async function run() {
    if (!app.conn) return;
    busy = true;
    error = null;
    try {
      const info = await install(app.mcp, {
        base: app.conn.base,
        origin: location.origin,
        baseCurrency: localCurrency(),
        onStep: (m) => (step = m),
      });
      await app.saveInstall(info);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card" aria-labelledby="step-install">
  <h2 id="step-install">3 · Install into n8n</h2>
  {#if !app.conn || !app.llm}
    <p class="muted small">Connect n8n and a language model first.</p>
  {:else}
    <p class="muted small">Creates Invenstory's tables and core workflows in your n8n, or reuses an existing install.</p>
    <button class="primary" disabled={busy} onclick={run}>
      {busy ? 'Installing…' : 'Install'}
    </button>
    {#if busy && step}<p class="muted small" aria-live="polite">{step}</p>{/if}
    {#if error}<p class="error small">{error}</p>{/if}
  {/if}
</section>
