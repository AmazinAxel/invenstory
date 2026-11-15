<script lang="ts">
  import { onMount } from 'svelte';
  import { dashboard } from '../state/dashboard.svelte.ts';
  import TabBar, { type Tab } from '../ui/TabBar.svelte';
  import Dashboard from './Dashboard.svelte';
  import Chat from './Chat.svelte';
  import Automations from './Automations.svelte';
  import Setup from './Setup.svelte';
  import { setup } from '../state/setup.svelte.ts';
  import Brand from '../ui/Brand.svelte';
  import type { HeatmapRow } from '../ui/SalesHeatmap.svelte';
  import { analysis } from '../state/analysis.svelte.ts';

  let { heatmapRows = [], heatmapIsDemo = false }: { heatmapRows?: HeatmapRow[]; heatmapIsDemo?: boolean } = $props();

  const saved = (() => {
    try {
      return (localStorage.getItem('invenstory.tab') as Tab | null) ?? 'dashboard';
    } catch {
      return 'dashboard';
    }
  })();
  let tab = $state<Tab>(saved);

  function select(t: Tab) {
    tab = t;
    try {
      localStorage.setItem('invenstory.tab', t);
    } catch {
      /* private mode */
    }
    window.scrollTo({ top: 0 });
  }

  onMount(() => {
    void setup.load().then(() => {
      if (setup.done) void dashboard.refresh('open');
    });
    // One-time per install: with an OpenRouter login, analysis sets itself up (a no-op once it exists).
    void analysis.ensure();
    const onVisible = () => document.visibilityState === 'visible' && void dashboard.refresh('focus');
    const onMessage = (e: MessageEvent) => (e.data as { type?: string })?.type === 'push' && void dashboard.refresh('push');
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  });
</script>

<div class="app-shell" class:onboarding={setup.done !== true}>
{#if setup.done === null}
  <p class="muted">Loading…</p>
{:else if !setup.done}
  <header><Brand /></header><main><Setup /></main>
{:else}
<header class="mobile-brand"><Brand /></header>
<main class:wide={tab === 'dashboard'}>
  <div hidden={tab !== 'dashboard'}><Dashboard onchat={() => select('chat')} {heatmapRows} {heatmapIsDemo} /></div>
  <div hidden={tab !== 'chat'}><Chat active={tab === 'chat'} /></div>
  <div hidden={tab !== 'automations'}><Automations active={tab === 'automations'} onchat={() => select('chat')} /></div>
</main>
<TabBar {tab} onselect={select} badge={{ dashboard: dashboard.data?.action_items.length ?? 0 }} />
{/if}
</div>

<style>
  .app-shell {
    --bg: #f6eee5; --surface: #fff8ef; --text: #302923; --muted: #81756b;
    --line: #e3d5c8; --accent: #a84f43; --accent-text: #fff8ef;
    --danger: #b64236; --warn: #a05b39; --ok: #6d7851; --radius: 20px; --gap: 20px;
    background: radial-gradient(ellipse at 85% 10%, #eee0d5aa, transparent 55%), var(--bg);
    color: var(--text); color-scheme: light; min-height: 100dvh;
  }
  .mobile-brand { padding: 20px 24px 4px; }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(88px + env(safe-area-inset-bottom));
  }
  main { container: shell / inline-size; }
  main.wide { max-width: 1440px; }
  main > div { min-width: 0; }
  .app-shell :global(.card) { border-radius: 20px; box-shadow: 0 5px 18px #56382408; }
  .app-shell :global(h1) { font: 600 36px/1.15 Georgia, 'Times New Roman', serif; letter-spacing: -0.035em; }
  .app-shell :global(h2) { font-family: Georgia, 'Times New Roman', serif; font-weight: 600; }
  .app-shell :global(button), .app-shell :global(a.button) { transition: background-color 120ms ease; }
  @media (min-width: 900px) {
    .app-shell { padding: 12px 20px 12px 244px; }
    .mobile-brand { display: none; }
    main { padding: 16px 0 32px; }
  }
  .app-shell.onboarding { padding: 24px; }
  @media (prefers-reduced-motion: reduce) { .app-shell :global(button), .app-shell :global(a.button) { transition: none; } }
</style>
