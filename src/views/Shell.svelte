<script lang="ts">
  import { onMount } from 'svelte';
  import { dashboard } from '../state/dashboard.svelte.ts';
  import TabBar, { type Tab } from '../ui/TabBar.svelte';
  import Dashboard from './Dashboard.svelte';
  import Chat from './Chat.svelte';
  import Automations from './Automations.svelte';

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
    void dashboard.refresh('open');
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

<main>
  <div hidden={tab !== 'dashboard'}><Dashboard onchat={() => select('chat')} /></div>
  <div hidden={tab !== 'chat'}><Chat active={tab === 'chat'} /></div>
  <div hidden={tab !== 'automations'}><Automations onchat={() => select('chat')} /></div>
</main>
<TabBar {tab} onselect={select} badge={{ dashboard: dashboard.data?.action_items.length ?? 0 }} />

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 16px 16px calc(88px + env(safe-area-inset-bottom));
  }
</style>
