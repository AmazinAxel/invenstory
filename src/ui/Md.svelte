<script lang="ts">
  import { parse } from '../lib/md.ts';
  import MdInline from './MdInline.svelte';
  let { text }: { text: string } = $props();
  const blocks = $derived(parse(text));
</script>

<div class="md">
  {#each blocks as b, i (i)}
    {#if b.t === 'p'}
      <p><MdInline nodes={b.c} /></p>
    {:else if b.t === 'h'}
      <p class="h"><strong><MdInline nodes={b.c} /></strong></p>
    {:else if b.t === 'ul'}
      <ul>{#each b.items as it, j (j)}<li><MdInline nodes={it} /></li>{/each}</ul>
    {:else if b.t === 'ol'}
      <ol>{#each b.items as it, j (j)}<li><MdInline nodes={it} /></li>{/each}</ol>
    {:else if b.t === 'pre'}
      <pre>{b.v}</pre>
    {/if}
  {/each}
</div>

<style>
  .md {
    display: grid;
    gap: 8px;
    overflow-wrap: anywhere;
  }
  ul,
  ol {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 4px;
  }
  pre {
    margin: 0;
    padding: 8px;
    background: var(--bg);
    border-radius: 8px;
    overflow-x: auto;
    font-size: 0.8rem;
  }
</style>
