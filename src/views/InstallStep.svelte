<script lang="ts">
  import { app } from '../state/app.svelte.ts';
</script>

<section class="card" aria-labelledby="step-install">
  <h2 id="step-install">3 · Install into n8n</h2>
  {#if !app.conn || !app.llm}
    <p class="muted small">Connect n8n and a language model first.</p>
  {:else}
    <p class="muted small">Coming next.</p>
  {/if}
</section>
