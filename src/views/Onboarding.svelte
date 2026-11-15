<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { beginLogin } from '../lib/n8n/oauth.ts';
  import { testLlm } from '../lib/llm/index.ts';
  import { ANTHROPIC_DEFAULT_MODEL } from '../lib/llm/anthropic.ts';
  import { OPENAI_PRESETS } from '../lib/llm/openai.ts';
  import { beginOpenRouterLogin, OPENROUTER_DEFAULT_MODEL } from '../lib/llm/openrouter.ts';
  import type { Effort, LlmConfig, Protocol } from '../lib/llm/types.ts';
  import InstallStep from './InstallStep.svelte';

  let base = $state(app.conn?.base ?? '');
  let loginBusy = $state(false);
  let loginError = $state<string | null>(app.error);
  let serverLabel = $state<string | null>(null);

  async function login() {
    loginBusy = true;
    loginError = null;
    try {
      await beginLogin(base);
    } catch (e) {
      loginError = e instanceof Error ? e.message : String(e);
      loginBusy = false;
    }
  }

  $effect(() => {
    if (!app.conn) return;
    const mcp = app.mcp;
    mcp
      .init()
      .then(() => (serverLabel = `${mcp.serverInfo.name ?? 'MCP'} ${mcp.serverInfo.version ?? ''}`.trim()))
      .catch((e: unknown) => (loginError = e instanceof Error ? e.message : String(e)));
  });

  // LLM form
  const saved = app.llm;
  let protocol = $state<Protocol>(saved?.protocol ?? 'anthropic');
  let preset = $state(saved?.label ?? 'OpenAI');
  let baseUrl = $state(saved?.protocol === 'openai' ? saved.baseUrl : OPENAI_PRESETS[0].baseUrl);
  let apiKey = $state(saved?.apiKey ?? '');
  let model = $state(saved?.model ?? ANTHROPIC_DEFAULT_MODEL);
  let effort = $state<Effort | ''>(saved?.effort ?? 'high');
  let llmBusy = $state(false);
  let llmResult = $state<{ ok: boolean; text: string } | null>(null);

  function pickProtocol(p: Protocol) {
    if (p === protocol) return;
    protocol = p;
    model = p === 'anthropic' ? ANTHROPIC_DEFAULT_MODEL : '';
    llmResult = null;
  }

  function pickPreset(label: string) {
    preset = label;
    const p = OPENAI_PRESETS.find((x) => x.label === label);
    if (p) baseUrl = p.baseUrl;
  }

  function config(): LlmConfig {
    return protocol === 'anthropic'
      ? { protocol, baseUrl: '', apiKey: apiKey.trim(), model: model.trim() || ANTHROPIC_DEFAULT_MODEL, effort, label: 'Claude' }
      : { protocol, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim(), label: preset };
  }

  let showForm = $state(false);

  async function openRouterLogin() {
    llmBusy = true;
    await beginOpenRouterLogin(OPENROUTER_DEFAULT_MODEL);
  }

  // Local Ollama needs no key; pick its first installed model. The page origin must be in OLLAMA_ORIGINS.
  async function useOllama() {
    llmBusy = true;
    llmResult = null;
    const base = 'http://localhost:11434/v1';
    try {
      const j = (await (await fetch(`${base}/models`)).json()) as { data?: { id: string }[] };
      const id = j.data?.[0]?.id;
      if (!id) throw new Error('Ollama is running but has no models. Run `ollama pull qwen3` first.');
      await app.saveLlm({ protocol: 'openai', baseUrl: base, apiKey: '', model: id, label: 'Ollama' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      llmResult = {
        ok: false,
        text: msg.includes('no models') ? msg : `Could not reach Ollama. Start it with OLLAMA_ORIGINS=${location.origin} ollama serve.`,
      };
    } finally {
      llmBusy = false;
    }
  }

  async function testAndSave() {
    llmBusy = true;
    llmResult = null;
    try {
      const cfg = config();
      const reply = await testLlm(cfg);
      await app.saveLlm(cfg);
      llmResult = { ok: true, text: `Saved. Model replied: ${reply.slice(0, 80)}` };
    } catch (e) {
      llmResult = { ok: false, text: e instanceof Error ? e.message : String(e) };
    } finally {
      llmBusy = false;
    }
  }
</script>

<main class="stack">
  <header class="stack" style="gap: 4px">
    <h1>Invenstory</h1>
    <p class="muted">Stock and sales automation inside your own n8n.</p>
  </header>

  <section class="card" aria-labelledby="step-n8n">
    <h2 id="step-n8n">1 · Connect n8n</h2>
    {#if app.conn}
      <p class="ok">Connected to {new URL(app.conn.base).host}{serverLabel ? ` · ${serverLabel}` : ''}</p>
      <div class="row">
        <button class="link" onclick={() => app.disconnect()}>Disconnect</button>
      </div>
    {:else}
      <p class="muted small">Needs n8n 2.36+ with Settings → MCP access turned on.</p>
      <label>
        n8n name or URL
        <input
          bind:value={base}
          placeholder="yourname (from yourname.app.n8n.cloud)"
          inputmode="url"
          autocomplete="url"
          autocapitalize="off"
          spellcheck="false"
          onkeydown={(e) => e.key === 'Enter' && base.trim() && login()}
        />
      </label>
      <button class="primary" disabled={!base.trim() || loginBusy} onclick={login}>
        {loginBusy ? 'Opening n8n…' : 'Log in with n8n'}
      </button>
    {/if}
    {#if loginError}<p class="error small">{loginError}</p>{/if}
  </section>

  <section class="card" aria-labelledby="step-llm">
    <h2 id="step-llm">2 · Language model</h2>
    {#if app.llm && !showForm}
      <p class="ok">Using {app.llm.label ?? 'Claude'} · {app.llm.model}</p>
      <div class="row"><button class="link" onclick={() => (showForm = true)}>Change</button></div>
    {:else if !showForm}
      <button class="primary" disabled={llmBusy} onclick={openRouterLogin}>Log in with OpenRouter</button>
      <button disabled={llmBusy} onclick={useOllama}>{llmBusy ? 'Looking for Ollama…' : 'Use Ollama on this computer'}</button>
      <div class="row"><button class="link" onclick={() => (showForm = true)}>Use an API key instead</button></div>
      {#if llmResult}<p class="small {llmResult.ok ? 'ok' : 'error'}">{llmResult.text}</p>{/if}
    {:else}
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
    <button class="primary" disabled={(!apiKey.trim() && (protocol === 'anthropic' || preset !== 'Ollama')) || (protocol === 'openai' && (!model.trim() || !baseUrl.trim())) || llmBusy} onclick={testAndSave}>
      {llmBusy ? 'Testing…' : 'Test and save'}
    </button>
    {#if llmResult}<p class="small {llmResult.ok ? 'ok' : 'error'}">{llmResult.text}</p>{/if}
    <p class="muted small">The key stays on this device.</p>
    {/if}
  </section>

  <InstallStep />
</main>

<style>
  main {
    max-width: 560px;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
</style>
