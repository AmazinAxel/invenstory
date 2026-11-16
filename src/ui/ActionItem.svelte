<script lang="ts">
  import { channelLabel } from '../lib/draft.ts';
  import type { ActionItem } from '../lib/n8n/api.ts';
  import Icon from './Icon.svelte';

  let {
    item,
    busy,
    result,
    onact,
    ondismiss,
  }: {
    item: ActionItem;
    busy?: 'run' | 'draft' | 'dismiss';
    result?: { ok: boolean; text: string };
    onact: () => void;
    ondismiss: () => void;
  } = $props();

  const label = $derived(
    item.kind === 'run' ? (busy === 'run' ? 'Running…' : 'Run') : `Open ${channelLabel[item.draft_channel ?? 'email']} draft`,
  );
</script>

<li class="item">
  <div class="text">
    <h3>{item.title}</h3>
    {#if item.detail}<p class="muted small">{item.detail}</p>{/if}
    {#if item.kind === 'draft' && item.draft_to}<p class="muted small">To {item.draft_to}</p>{/if}
    {#if result}<p class="small {result.ok ? 'ok' : 'error'}" role={result.ok ? 'status' : 'alert'}>{result.text}</p>{/if}
  </div>
  <div class="actions">
    <button class="primary" disabled={!!busy} onclick={onact}>
      <Icon name={item.kind === 'run' ? 'play' : 'send'} size={16} />
      {label}
    </button>
    <button class="ghost" disabled={!!busy} onclick={ondismiss} aria-label="Dismiss {item.title}">
      <Icon name="x" size={18} />
    </button>
  </div>
</li>

<style>
  .item {
    display: grid;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .item:last-child {
    border-bottom: 0;
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions .primary {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .ghost {
    width: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
</style>
