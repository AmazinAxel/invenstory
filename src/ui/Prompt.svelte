<script lang="ts">
  import Icon from './Icon.svelte';
  let {
    running,
    onsend,
    onstop,
    placeholder = 'Message Invenstory',
  }: { running: boolean; onsend: (text: string) => void; onstop: () => void; placeholder?: string } = $props();
  let text = $state('');
  let el: HTMLTextAreaElement | undefined = $state();

  function grow() {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }
  function submit() {
    if (!text.trim() || running) return;
    onsend(text);
    text = '';
    queueMicrotask(grow);
  }
  function key(e: KeyboardEvent) {
    // Enter sends on devices with a hardware keyboard; Shift+Enter makes a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      submit();
    }
  }
</script>

<form class="prompt" onsubmit={(e) => (e.preventDefault(), submit())}>
  <label class="sr">{placeholder}<textarea bind:this={el} bind:value={text} rows="1" {placeholder} oninput={grow} onkeydown={key}></textarea></label>
  {#if running}
    <button type="button" class="send" onclick={onstop} aria-label="Stop"><Icon name="x" /></button>
  {:else}
    <button type="submit" class="send primary" disabled={!text.trim()} aria-label="Send"><Icon name="send" /></button>
  {/if}
</form>

<style>
  .prompt {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 6px;
  }
  .sr {
    flex: 1;
    display: block;
    font-size: 0;
  }
  textarea {
    font-size: 1rem;
    border: 0;
    background: transparent;
    min-height: 40px;
    padding: 9px 8px;
    line-height: 1.35;
  }
  textarea:focus {
    outline: none;
  }
  .prompt:focus-within {
    outline: 2px solid var(--accent);
  }
  .send {
    width: 44px;
    height: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    flex: none;
  }
</style>
