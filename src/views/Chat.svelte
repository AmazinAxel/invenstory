<script lang="ts">
  import { tick } from 'svelte';
  import { chat, SNAPSHOT_MARK } from '../state/chat.svelte.ts';
  import { toolLabel } from '../lib/agent/tools.ts';
  import type { Message } from '../lib/llm/types.ts';
  import Md from '../ui/Md.svelte';
  import Prompt from '../ui/Prompt.svelte';
  import Icon from '../ui/Icon.svelte';

  // embedded: shown inside guided setup, which has no tab bar or page header of its own.
  let { active, embedded = false }: { active: boolean; embedded?: boolean } = $props();

  const STARTERS = ['My stock is in Google Sheets', 'I sell on Shopify', 'I use WooCommerce', 'What can you do?'];

  // Tool-result status by call id, for calls not tracked live (e.g. after a reload).
  const results = $derived.by(() => {
    const m = new Map<string, { isError?: boolean; content: string }>();
    for (const msg of chat.messages) for (const p of msg.parts) if (p.type === 'tool_result') m.set(p.id, { isError: p.isError, content: p.content });
    return m;
  });

  function visibleText(m: Message): string {
    return m.parts
      .filter((p) => p.type === 'text' && !p.text.startsWith(SNAPSHOT_MARK))
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('\n\n');
  }

  const rows = $derived(chat.messages.filter((m) => m.role === 'assistant' || visibleText(m)));

  let end: HTMLDivElement | undefined = $state();
  $effect(() => {
    void rows.length;
    void chat.streaming;
    if (active) void tick().then(() => end?.scrollIntoView({ block: 'end' }));
  });
</script>

<div class="chat" class:embedded>
  <header class="row between" hidden={embedded}>
    <h1>Chat</h1>
    {#if chat.origin === 'analysis' && rows.length}<span class="muted small">Latest analysis</span>{/if}
  </header>

  <div class="log" aria-live="polite">
    {#if !rows.length && !chat.running}
      <div class="bubble assistant">
        <p>Hi! I set up and run your stock and sales automations in n8n. Where do you keep your stock and sales today?</p>
      </div>
      <div class="chips">
        {#each STARTERS as s (s)}<button class="chip" onclick={() => chat.send(s)}>{s}</button>{/each}
      </div>
    {/if}

    {#each rows as m, i (i)}
      {#if m.role === 'user'}
        <div class="bubble user">{visibleText(m)}</div>
      {:else}
        {#each m.parts as p, j (j)}
          {#if p.type === 'text' && p.text.trim()}
            <div class="bubble assistant"><Md text={p.text} /></div>
          {:else if p.type === 'tool_call'}
            {@const live = chat.tools[p.id]}
            {@const r = results.get(p.id)}
            {@const status = live?.status ?? (r ? (r.isError ? (r.content.startsWith('Refused') || r.content.includes('safety gate') ? 'refused' : 'error') : 'ok') : 'error')}
            <div class="tool {status}">
              <span class="ic">
                {#if status === 'running'}<span class="spinner" aria-hidden="true"></span>
                {:else if status === 'ok'}<Icon name="check" size={16} />
                {:else if status === 'refused'}<Icon name="stop" size={16} />
                {:else}<Icon name="alert" size={16} />{/if}
              </span>
              <span class="lbl">{live?.label ?? toolLabel(p.name, p.input)}{live?.summary && status !== 'ok' ? ` · ${live.summary}` : ''}</span>
            </div>
            {#if status === 'refused' && (live?.detail ?? r?.content)}
              <details class="refusal"><summary>Why it was refused</summary><pre>{live?.detail ?? r?.content}</pre></details>
            {/if}
          {/if}
        {/each}
      {/if}
    {/each}

    {#if chat.streaming}
      <div class="bubble assistant"><Md text={chat.streaming} /></div>
    {:else if chat.running}
      <p class="muted small typing">Working…</p>
    {/if}

    {#if chat.ended === 'refusal'}<p class="muted small">The model declined to continue. Try rephrasing.</p>{/if}
    {#if chat.ended === 'step_limit'}<p class="muted small">Paused after many steps. Say “continue” to keep going.</p>{/if}
    {#if chat.ended === 'max_tokens'}<p class="muted small">The reply was cut off. Say “continue”.</p>{/if}
    {#if chat.error}<p class="error small" role="alert">{chat.error}</p>{/if}
    <div bind:this={end}></div>
  </div>

  <div class="composer">
    <Prompt running={chat.running} onsend={(t) => chat.send(t)} onstop={() => chat.stop()} />
  </div>
</div>

<style>
  .chat {
    display: grid;
    gap: 12px;
  }
  .between {
    justify-content: space-between;
  }
  .log {
    display: grid;
    gap: 10px;
    padding-bottom: 88px;
  }
  .bubble {
    max-width: 88%;
    padding: 10px 14px;
    border-radius: 16px;
    overflow-wrap: anywhere;
  }
  .bubble.user {
    justify-self: end;
    background: var(--accent);
    color: var(--accent-text);
    border-bottom-right-radius: 4px;
    white-space: pre-wrap;
  }
  .bubble.assistant {
    justify-self: start;
    background: var(--surface);
    border: 1px solid var(--line);
    border-bottom-left-radius: 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    border-radius: 999px;
    min-height: 40px;
    font-size: 0.9rem;
  }
  .tool {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--muted);
    padding-left: 4px;
  }
  .tool .ic {
    display: inline-flex;
    width: 16px;
  }
  .tool.ok .ic {
    color: var(--ok);
  }
  .tool.error .ic {
    color: var(--warn);
  }
  .tool.refused {
    color: var(--danger);
  }
  .refusal {
    font-size: 0.8rem;
    margin-left: 28px;
  }
  .refusal pre {
    white-space: pre-wrap;
    margin: 4px 0 0;
    font-family: inherit;
    color: var(--muted);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
  .composer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(56px + env(safe-area-inset-bottom));
    padding: 8px 16px;
    background: linear-gradient(to top, var(--bg) 70%, transparent);
    max-width: 960px;
    margin: 0 auto;
  }
  .embedded .composer {
    bottom: env(safe-area-inset-bottom);
  }
</style>
