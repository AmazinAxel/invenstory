<script lang="ts">
  import { voice } from '../state/voice.svelte.ts';
  import {
    DEFAULT_STT_MODEL,
    listTtsModels,
    listVoices,
    pickTtsModel,
    STT_MODELS,
    subscription,
    type Subscription,
    type VoiceChoice,
  } from '../lib/voice/elevenlabs.ts';
  import type { VoiceConfig } from '../lib/voice/types.ts';

  // Optional, per device: the ElevenLabs key is pasted here (demo devices) and never leaves this
  // browser except to api.elevenlabs.io. Lists load only when the card is opened.
  let key = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let sub = $state<Subscription | null>(null);
  let voices = $state<VoiceChoice[]>([]);
  let models = $state<VoiceChoice[]>([]);
  let loadedFor = '';

  const cfg = $derived(voice.config);
  const fmt = (n: number) => n.toLocaleString();

  async function load(apiKey: string) {
    const [s, v, m] = await Promise.all([subscription(apiKey), listVoices(apiKey), listTtsModels(apiKey)]);
    sub = s;
    voices = v;
    models = m;
    loadedFor = apiKey;
    return { v, m };
  }

  async function connect() {
    const apiKey = key.trim();
    if (!apiKey) return;
    busy = true;
    error = null;
    try {
      const { v, m } = await load(apiKey); // subscription() validates the key first-hand
      const first = v[0];
      if (!first) throw new Error('This ElevenLabs account has no voices yet. Add one in ElevenLabs, then connect again.');
      await voice.save({ provider: 'elevenlabs', apiKey, voiceId: first.id, voiceName: first.name, ttsModel: pickTtsModel(m), sttModel: DEFAULT_STT_MODEL });
      key = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function opened(e: Event) {
    const c = voice.config;
    if (!(e.currentTarget as HTMLDetailsElement).open || !c || loadedFor === c.apiKey) return;
    busy = true;
    error = null;
    try {
      await load(c.apiKey);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function update(patch: Partial<VoiceConfig>) {
    const c = voice.config;
    if (!c) return;
    void voice.save({ ...($state.snapshot(c) as VoiceConfig), ...patch });
  }

  function pickVoice(id: string) {
    update({ voiceId: id, voiceName: voices.find((v) => v.id === id)?.name ?? id });
  }

  async function remove() {
    await voice.remove();
    sub = null;
    voices = [];
    models = [];
    loadedFor = '';
  }
</script>

<details class="card" ontoggle={opened}>
  <summary><h2>Voice {cfg ? '' : '(optional)'}</h2></summary>
  {#if !cfg}
    <p class="muted small">
      Talk to Invenstory and hear the answers. Paste an ElevenLabs API key (ElevenLabs → Developers → API keys). The key
      stays on this device and is sent only to ElevenLabs.
    </p>
    <form class="row" onsubmit={(e) => (e.preventDefault(), void connect())}>
      <label class="grow">ElevenLabs API key<input type="password" bind:value={key} autocomplete="off" spellcheck="false" /></label>
      <button class="primary" type="submit" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Connect'}</button>
    </form>
  {:else}
    <p class="muted small">
      Voice is on for this device: a microphone button appears in the chat. The ElevenLabs key stays on this device.
      {#if sub}<br />Plan {sub.tier || '—'} · {fmt(sub.characterCount)} of {fmt(sub.characterLimit)} credits used{/if}
    </p>
    <label>
      Voice
      <select value={cfg.voiceId} onchange={(e) => pickVoice(e.currentTarget.value)} disabled={!voices.length}>
        {#if !voices.some((v) => v.id === cfg.voiceId)}<option value={cfg.voiceId}>{cfg.voiceName}</option>{/if}
        {#each voices as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
      </select>
    </label>
    <label>
      Speech model
      <select value={cfg.ttsModel} onchange={(e) => update({ ttsModel: e.currentTarget.value })} disabled={!models.length}>
        {#if !models.some((m) => m.id === cfg.ttsModel)}<option value={cfg.ttsModel}>{cfg.ttsModel}</option>{/if}
        {#each models as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
    </label>
    <label>
      Transcription model
      <select value={cfg.sttModel} onchange={(e) => update({ sttModel: e.currentTarget.value })}>
        {#each STT_MODELS as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
    </label>
    <div class="row">
      <button onclick={() => voice.test()}>Test voice</button>
      <button onclick={remove}>Remove</button>
    </div>
    {#if voice.error}<p class="error small">{voice.error}</p>{/if}
  {/if}
  {#if busy && cfg}<p class="muted small">Loading voices…</p>{/if}
  {#if error}<p class="error small" role="alert">{error}</p>{/if}
</details>

<style>
  summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  summary h2 {
    display: inline;
  }
  .grow {
    flex: 1;
    min-width: 200px;
  }
  form.row {
    align-items: flex-end;
  }
</style>
