<script lang="ts">
  import type { Inline } from '../lib/md.ts';
  import Self from './MdInline.svelte';
  let { nodes }: { nodes: Inline[] } = $props();
</script>

{#each nodes as n, i (i)}{#if n.t === 'text'}{n.v}{:else if n.t === 'code'}<code>{n.v}</code>{:else if n.t === 'b'}<strong><Self nodes={n.c} /></strong>{:else if n.t === 'i'}<em><Self nodes={n.c} /></em>{:else if n.t === 'a'}<a href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Self nodes={n.c} /></a>{/if}{/each}

<style>
  code {
    font-size: 0.85em;
    background: var(--bg);
    padding: 1px 4px;
    border-radius: 4px;
  }
</style>
