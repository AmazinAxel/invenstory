<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './state/app.svelte.ts';
  import Onboarding from './views/Onboarding.svelte';
  import Shell from './views/Shell.svelte';

  onMount(() => void app.init());
</script>

{#if !app.ready}
  <p class="muted" style="padding: 24px 16px">Loading…</p>
{:else if app.onboarded}
  <Shell />
{:else}
  <Onboarding />
{/if}
