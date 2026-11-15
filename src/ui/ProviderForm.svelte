<script lang="ts">
  // API-key form shared by Onboarding and the Automations "AI provider" card. Tests the connection before replacing the saved provider.
  import { app } from '../state/app.svelte.ts';
  import { testLlm } from '../lib/llm/index.ts';
  import { buildLlmConfig } from '../lib/llm/config.ts';
  import { ANTHROPIC_DEFAULT_MODEL } from '../lib/llm/anthropic.ts';
  import { OPENAI_PRESETS } from '../lib/llm/openai.ts';
  import type { Effort, Protocol } from '../lib/llm/types.ts';

  let { onsaved }: { onsaved?: () => void } = $props();

  const saved = app.llm;
  let protocol = $state<Protocol>(saved?.protocol ?? 'anthropic');
  let baseUrl = $state(saved?.protocol === 'openai' ? saved.baseUrl : OPENAI_PRESETS[0].baseUrl);
  let apiKey = $state(saved?.apiKey ?? '');
  let model = $state(saved?.model ?? ANTHROPIC_DEFAULT_MODEL);
  let effort = $state<Effort | ''>(saved?.effort ?? 'high');
  // Derived so the dropdown can never disagree with the typed base URL (and the label buildLlmConfig saves).
  const preset = $derived(OPENAI_PRESETS.find((p) => p.baseUrl === baseUrl.trim().replace(/\/+$/, ''))?.label ?? 'Custom');
  let busy = $state(false);
  let result = $state<{ ok: boolean; text: string } | null>(null);

  function pickProtocol(p: Protocol) {
    if (p === protocol) return;
    protocol = p;
    apiKey = ''; // never carry one provider's key to another provider's host
    model = p === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '';
    result = null;
  }

  function pickPreset(label: string) {
    const p = OPENAI_PRESETS.find((x) => x.label === label);
    if (p) baseUrl = p.baseUrl;
  }

  async function testAndSave() {
    busy = true;
    result = null;
    try {
      const cfg = buildLlmConfig({ protocol, apiKey, baseUrl, model, effort });
      const reply = await testLlm(cfg);
      await app.saveLlm(cfg);
      result = { ok: true, text: `Saved. Model replied: ${reply.slice(0, 80)}` };
      onsaved?.();
    } catch (e) {
      result = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      busy = false;
    }
  }
</script>

<div class="segmented" role="group" aria-label="Protocol">
  <button aria-pressed={protocol === 'anthropic'} onclick={() => pickProtocol('anthropic')}>Claude</button>
  <button aria-pressed={protocol === 'openai'} onclick={() => pickProtocol('openai')}>OpenAI-compatible</button>
</div>
{#if protocol === 'openai'}
  <label>
    Provider
    <select value={preset} onchange={(e) => pickPreset(e.currentTarget.value)}>
      {#each OPENAI_PRESETS as p (p.label)}<option>{p.label}</option>{/each}
      <option>Custom</option>
    </select>
  </label>
  <label>Base URL <input bind:value={baseUrl} inputmode="url" autocapitalize="off" spellcheck="false" /></label>
  {#if preset === 'Groq'}
    <p class="muted small">Get a key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a>.</p>
  {/if}
{/if}
<label>
  API key
  <input bind:value={apiKey} type="password" autocomplete="off" spellcheck="false" />
</label>
<label>
  Model
  <input bind:value={model} placeholder={protocol === 'openai' ? 'e.g. the provider’s model id' : ''} autocapitalize="off" spellcheck="false" />
</label>
{#if protocol === 'anthropic'}
  <label>
    Effort
    <select bind:value={effort}>
      <option value="">Model default</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="xhigh">Extra high</option>
    </select>
  </label>
{/if}
<button class="primary" disabled={busy} onclick={testAndSave}>{busy ? 'Testing…' : 'Test and save'}</button>
{#if result}<p class="small {result.ok ? 'ok' : 'error'}" role={result.ok ? 'status' : 'alert'}>{result.text}</p>{/if}
<p class="muted small">The key stays on this device. An OpenRouter key is also saved in your n8n, so analysis can run while the app is closed.</p>
