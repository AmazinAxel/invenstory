<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../state/app.svelte.ts';
  import { disablePush, enablePush, pushState, type PushState } from '../lib/push.ts';
  import { kv, K } from '../lib/kv.ts';
  import VoiceSettings from './VoiceSettings.svelte';
  import { voice } from '../state/voice.svelte.ts';

  let push = $state<PushState | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  onMount(() => void pushState().then((s) => (push = s)));

  async function toggle() {
    if (!app.install) return;
    busy = true;
    error = null;
    try {
      push = push === 'on' ? await disablePush($state.snapshot(app.install)) : await enablePush(app.mcp, $state.snapshot(app.install));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function changeLlm() {
    await kv.del(K.llm);
    app.llm = null;
  }
</script>

<section class="card" aria-labelledby="h-notify">
  <h2 id="h-notify">Notifications</h2>
  {#if push === 'needs-install'}
    <p class="muted small">On iPhone and iPad, add Invenstory to your Home Screen first (Share → Add to Home Screen), then open it from there.</p>
  {:else if push === 'unsupported'}
    <p class="muted small">This browser cannot receive notifications.</p>
  {:else if push === 'denied'}
    <p class="muted small">Notifications are blocked for this site in your browser settings.</p>
  {:else if push}
    <p class="muted small">Get a notification for new action items and failed workflows. No business data is sent in the notification itself.</p>
    <button class={push === 'on' ? '' : 'primary'} disabled={busy} onclick={toggle}>
      {busy ? '…' : push === 'on' ? 'Turn off on this device' : 'Turn on for this device'}
    </button>
  {/if}
  {#if error}<p class="error small" role="alert">{error}</p>{/if}
</section>

<section class="card" aria-labelledby="h-settings">
  <h2 id="h-settings">Settings</h2>
  <p class="muted small">
    n8n: {app.conn ? new URL(app.conn.base).host : '—'} · Model: {app.llm?.label ?? ''} {app.llm?.model ?? ''}
  </p>
  <div class="row">
    <button onclick={changeLlm}>Change language model</button>
    <button onclick={() => app.disconnect()}>Disconnect n8n</button>
  </div>
  <p class="muted small">Keys are stored on this device only. Disconnecting keeps your data in n8n.</p>
</section>

{#if voice.config || voice.setup}<VoiceSettings />{/if}
