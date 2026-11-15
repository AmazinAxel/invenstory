<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { install } from '../lib/n8n/install.ts';

  let currency = $state(guessCurrency());
  let busy = $state(false);
  let step = $state('');
  let error = $state<string | null>(null);

  function guessCurrency(): string {
    try {
      const region = new Intl.Locale(navigator.language).maximize().region;
      const map: Record<string, string> = { US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CH: 'CHF', IN: 'INR', SE: 'SEK', NO: 'NOK', DK: 'DKK' };
      const euro = ['DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR', 'LU', 'SK', 'SI', 'EE', 'LV', 'LT', 'MT', 'CY', 'HR'];
      if (region && euro.includes(region)) return 'EUR';
      return (region && map[region]) || 'USD';
    } catch {
      return 'USD';
    }
  }

  async function run() {
    if (!app.conn) return;
    busy = true;
    error = null;
    try {
      const info = await install(app.mcp, {
        base: app.conn.base,
        origin: location.origin,
        baseCurrency: currency.trim() || 'USD',
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
    <label>
      Base currency
      <input bind:value={currency} maxlength="3" autocapitalize="characters" spellcheck="false" style="text-transform: uppercase" />
    </label>
    <button class="primary" disabled={busy || !/^[A-Za-z]{3}$/.test(currency.trim())} onclick={run}>
      {busy ? 'Installing…' : 'Install'}
    </button>
    {#if busy && step}<p class="muted small" aria-live="polite">{step}</p>{/if}
    {#if error}<p class="error small">{error}</p>{/if}
  {/if}
</section>
