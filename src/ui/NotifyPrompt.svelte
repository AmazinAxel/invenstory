<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte.ts';
  import { enablePush, pushState, shouldPromptPush } from '../lib/push.ts';
  import { kv, K } from '../lib/kv.ts';

  let show = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    const [state, handled] = await Promise.all([pushState(), kv.get<boolean>(K.pushPrompted)]);
    show = shouldPromptPush(state, !!handled);
  });

  const done = async () => {
    await kv.set(K.pushPrompted, true);
    show = false;
  };

  // Runs inside the tap, so the browser allows its permission popup.
  async function turnOn() {
    if (!app.install) {
      error = 'Invenstory is not installed yet.';
      return;
    }
    busy = true;
    error = null;
    try {
      const state = await enablePush(app.mcp, $state.snapshot(app.install));
      if (state === 'unsupported') {
        error = 'This browser could not turn on notifications.';
        return;
      }
      await done();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if show}
  <section class="card" aria-labelledby="h-notify">
    <h2 id="h-notify">Get notified</h2>
    <p class="muted small">Get a notification for new action items and failed workflows. No business data is sent in the notification itself. You can change this later in your browser's site settings.</p>
    <div class="row">
      <button class="primary" disabled={busy} onclick={turnOn}>{busy ? '…' : 'Turn on notifications'}</button>
      <button disabled={busy} onclick={done}>Not now</button>
    </div>
    {#if error}<p class="error small" role="alert">{error}</p>{/if}
  </section>
{/if}
