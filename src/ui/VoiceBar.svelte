<script lang="ts">
  import { voice } from '../state/voice.svelte.ts';
  import Icon from './Icon.svelte';

  const status = $derived.by(() => {
    switch (voice.phase) {
      case 'connecting':
        return 'Starting the microphone…';
      case 'listening':
        return voice.handsFree ? 'Listening. Just talk.' : 'Listening… release to send';
      case 'thinking':
        return voice.handsFree ? 'Working on it. Say “stop” or tap the mic to cancel.' : 'Working on it…';
      case 'speaking':
        return 'Speaking';
      default:
        return voice.handsFree ? 'Hands-free is paused.' : 'Hold the mic to talk, or tap it to start and stop.';
    }
  });
</script>

{#if voice.enabled}
  <div class="voicebar" role="status" aria-live="polite">
    <div class="text">
      <span class="state" class:live={voice.phase === 'listening'}>{status}</span>
      {#if voice.partial}<span class="partial">“{voice.partial}”</span>{/if}
      {#if voice.error}<span class="error small">{voice.error}</span>{/if}
    </div>
    {#if voice.speaking}
      <button type="button" class="tool" onclick={() => voice.stopAudio()}><Icon name="square" size={16} /> Stop</button>
    {:else if voice.error}
      <button type="button" class="tool" aria-label="Dismiss" onclick={() => (voice.error = null)}><Icon name="x" size={16} /></button>
    {/if}
    <button
      type="button"
      class="tool"
      class:on={voice.handsFree}
      aria-pressed={voice.handsFree}
      title="Hands-free: talk without holding the button"
      onclick={() => voice.setHandsFree(!voice.handsFree)}
    >
      <Icon name="headset" size={16} /> Hands-free
    </button>
  </div>
{/if}

<style>
  .voicebar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 4px 4px 4px 12px;
    margin-bottom: 6px;
    min-height: 54px;
  }
  .text {
    flex: 1;
    display: grid;
    gap: 2px;
    min-width: 0;
    font-size: 0.875rem;
  }
  .state {
    color: var(--muted);
  }
  .state.live {
    color: var(--accent);
    font-weight: 600;
  }
  .partial {
    overflow-wrap: anywhere;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    min-width: 44px;
    padding: 0 10px;
    justify-content: center;
    font-size: 0.875rem;
  }
  .tool.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
</style>
