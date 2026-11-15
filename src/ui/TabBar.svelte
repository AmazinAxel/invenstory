<script module lang="ts">
  export type Tab = 'dashboard' | 'chat' | 'automations';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  let { tab, onselect, badge }: { tab: Tab; onselect: (t: Tab) => void; badge?: Partial<Record<Tab, number>> } = $props();
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'dashboard', label: 'Overview', icon: 'dashboard' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'automations', label: 'Automations', icon: 'automations' },
  ];
</script>

<nav aria-label="Main">
  {#each tabs as t (t.id)}
    <button aria-current={tab === t.id ? 'page' : undefined} onclick={() => onselect(t.id)}>
      <span class="ic"><Icon name={t.icon} size={22} />{#if badge?.[t.id]}<span class="dot" aria-hidden="true"></span>{/if}</span>
      <span class="lbl">{t.label}</span>
      {#if badge?.[t.id]}<span class="sr-only">, {badge[t.id]} new</span>{/if}
    </button>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
    z-index: 10;
  }
  button {
    border: 0;
    border-radius: 0;
    background: none;
    min-height: 56px;
    display: grid;
    justify-items: center;
    gap: 2px;
    color: var(--muted);
    font-size: 0.72rem;
  }
  button[aria-current='page'] {
    color: var(--accent);
    font-weight: 600;
  }
  .ic {
    position: relative;
    display: inline-flex;
  }
  .dot {
    position: absolute;
    top: -2px;
    right: -4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
  }
</style>
