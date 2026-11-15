<script lang="ts">
  import { voice } from '../state/voice.svelte.ts';
  import Icon from './Icon.svelte';

  // Pointer: hold to talk, release to send; a short tap keeps the mic open until the next tap.
  // Keyboard and assistive tech produce clicks without pointer events (detail 0): toggle.
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    voice.press();
  }

  const label = $derived(
    voice.handsFree
      ? voice.speaking || voice.waiting
        ? 'Interrupt'
        : 'Turn off hands-free'
      : voice.speaking
        ? 'Stop speaking'
        : voice.listening
          ? 'Stop and send'
          : 'Hold to talk, or tap to start and tap again to send',
  );
</script>

<button
  type="button"
  class="mic"
  class:on={voice.listening}
  class:speaking={voice.speaking}
  aria-label={label}
  title={label}
  aria-pressed={voice.listening}
  onpointerdown={down}
  onpointerup={() => voice.unpress()}
  onpointercancel={() => voice.cancelPress()}
  onclick={(e) => e.detail === 0 && voice.toggle()}
  oncontextmenu={(e) => e.preventDefault()}
>
  <Icon name={voice.speaking ? 'square' : 'mic'} />
</button>

<style>
  .mic {
    width: 44px;
    height: 44px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    flex: none;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .mic.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .mic.speaking {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
