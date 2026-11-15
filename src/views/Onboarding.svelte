<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { beginLogin } from '../lib/n8n/oauth.ts';
  import { beginOpenRouterLogin, OPENROUTER_DEFAULT_MODEL } from '../lib/llm/openrouter.ts';
  import { buildLlmConfig } from '../lib/llm/config.ts';
  import ProviderForm from '../ui/ProviderForm.svelte';
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

  let llmBusy = $state(false);
  let llmResult = $state<{ ok: boolean; text: string } | null>(null);

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
      await app.saveLlm(buildLlmConfig({ protocol: 'openai', baseUrl: base, apiKey: '', model: id }));
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
    {#if loginError}<p class="error small" role="alert">{loginError}</p>{/if}
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
      {#if llmResult}<p class="small {llmResult.ok ? 'ok' : 'error'}" role={llmResult.ok ? 'status' : 'alert'}>{llmResult.text}</p>{/if}
    {:else}
    <ProviderForm />
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
