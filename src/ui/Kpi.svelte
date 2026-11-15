<script lang="ts">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons.ts';
  let { label, value, hint, status }: { label: string; value: string; hint?: string; status?: { icon: IconName; tone: 'warn' | 'danger' } } = $props();
</script>

<div class="kpi">
  <span class="label">{label}</span>
  <span class="value">
    {#if status}<span class="status {status.tone}"><Icon name={status.icon} size={16} /></span>{/if}
    {value}
  </span>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>

<style>
  .kpi {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 14px;
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .value {
    font-size: 1.35rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .status {
    display: inline-flex;
  }
  .warn {
    color: var(--warn);
  }
  .danger {
    color: var(--danger);
  }
</style>
