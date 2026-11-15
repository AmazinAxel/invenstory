<script module lang="ts">
  export type Tab = 'dashboard' | 'chat' | 'automations';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import Brand from './Brand.svelte';
  import type { IconName } from './icons.ts';
  let { tab, onselect, badge }: { tab: Tab; onselect: (t: Tab) => void; badge?: Partial<Record<Tab, number>> } = $props();
  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'automations', label: 'Automations', icon: 'automations' },
  ];
</script>

<nav aria-label="Main">
  <div class="brand"><Brand /></div>
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
  .brand { display: none; }
  button {
    border: 0;
    border-radius: 0;
    background: none;
    min-height: 56px;
    display: grid;
    justify-items: center;
    gap: 2px;
    color: var(--muted);
    font-size: 0.8rem;
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
  @media (min-width: 900px) {
    nav {
      left: 16px; top: 16px; bottom: 16px; right: auto; width: 208px;
      display: flex; flex-direction: column; gap: 8px; padding: 28px 12px;
      background: linear-gradient(150deg, #e5e2dd, #d8dedf);
      border: 1px solid #ffffff70; border-radius: 24px;
    }
    .brand { display: block; margin: 0 4px 36px; }
    button { display: flex; gap: 13px; align-items: center; justify-content: flex-start; text-align: left; padding: 0 16px; min-height: 46px; border-radius: 14px; color: #393631; font-size: 14px; font-weight: 450; }
    button:hover { background: #ffffff55; }
    button[aria-current='page'] { background: #e8cfc2; color: #983b30; font-weight: 600; }
  }
  @media (max-width: 899px) {
    nav { background: #faf3ebf5; backdrop-filter: blur(12px); }
    button[aria-current='page'] { background: #edd8cc; }
  }
</style>
