<script lang="ts">
  import { tick } from 'svelte';
  import { chat, SNAPSHOT_MARK } from '../state/chat.svelte.ts';
  import { toolLabel } from '../lib/agent/tools.ts';
  import { toolCalls, type Message, type Part } from '../lib/llm/types.ts';
  import { splitOptions } from '../lib/agent/options.ts';
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

  // One turn = everything the assistant did between two owner messages. The owner sees its tool calls folded and
  // only its last text (text written between tool calls is narration, hidden).
  type Call = Extract<Part, { type: 'tool_call' }>;
  type Turn = { user: string } | { calls: Call[]; text: string };
  const turns = $derived.by(() => {
    const out: Turn[] = [];
    for (const m of rows) {
      if (m.role === 'user') {
        out.push({ user: visibleText(m) });
        continue;
      }
      let t = out.at(-1);
      if (!t || 'user' in t) out.push((t = { calls: [], text: '' }));
      t.calls.push(...toolCalls(m.parts));
      const text = visibleText(m);
      if (text.trim()) t.text = text;
    }
    return out;
  });

  function status(id: string): string {
    const live = chat.tools[id];
    if (live) return live.status;
    const r = results.get(id);
    return r ? (r.isError ? (r.content.startsWith('Refused') || r.content.includes('safety gate') ? 'refused' : 'error') : 'ok') : 'error';
  }

  // Screen readers hear finished replies only: a live region over the streaming log re-reads every chunk.
  const announce = $derived.by(() => {
    if (chat.running) return 'Working…';
    const last = turns.at(-1);
    return last && 'text' in last ? splitOptions(last.text).body : '';
  });

  let end: HTMLDivElement | undefined = $state();
  let composerH = $state(0);
  $effect(() => {
    void rows.length;
    void chat.streaming;
    if (active) void tick().then(() => end?.scrollIntoView({ block: 'end' }));
  });
</script>

<div class="chat" class:embedded style:--composer-h="{composerH}px">
  <header class="row between" hidden={embedded}>
    <h1>Chat</h1>
    {#if chat.origin === 'analysis' && rows.length}<span class="muted small">Latest analysis</span>{/if}
  </header>

  <p class="sr-only" aria-live="polite">{announce}</p>
  <div class="log">
    {#if !rows.length && !chat.running}
      <div class="bubble assistant">
        <p>Hi! I set up and run your stock and sales automations in n8n. Where do you keep your stock and sales today?</p>
      </div>
      <div class="chips">
        {#each STARTERS as s (s)}<button class="chip" onclick={() => chat.send(s)}>{s}</button>{/each}
      </div>
    {/if}

    {#snippet toolRow(p: Call)}
      {@const live = chat.tools[p.id]}
      {@const s = status(p.id)}
      <div class="tool {s}">
        <span class="ic">
          {#if s === 'running'}<span class="spinner" aria-hidden="true"></span>
          {:else if s === 'ok'}<Icon name="check" size={16} />
          {:else if s === 'refused'}<Icon name="stop" size={16} />
          {:else}<Icon name="alert" size={16} />{/if}
        </span>
        <span class="lbl">{live?.label ?? toolLabel(p.name, p.input)}{live?.summary && s !== 'ok' ? ` · ${live.summary}` : ''}</span>
      </div>
      {#if s === 'refused' && (live?.detail ?? results.get(p.id)?.content)}
        <details class="refusal"><summary>Why it was refused</summary><pre>{live?.detail ?? results.get(p.id)?.content}</pre></details>
      {/if}
    {/snippet}

    {#each turns as t, i (i)}
      {#if 'user' in t}
        <div class="bubble user">{t.user}</div>
      {:else}
        {@const last = i === turns.length - 1}
        {@const working = last && chat.running}
        {@const steps = t.calls.filter((c) => status(c.id) !== 'refused')}
        {#if working}
          {@const current = t.calls.at(-1)}
          {#if current && status(current.id) !== 'refused'}{@render toolRow(current)}{/if}
        {:else if steps.length}
          <!-- Safety gate refusals stay outside the fold: the owner must always see them. -->
          <details class="steps" open={!t.text.trim()}>
            <summary>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</summary>
            {#each steps as c (c.id)}{@render toolRow(c)}{/each}
          </details>
        {/if}
        {#each t.calls.filter((c) => status(c.id) === 'refused') as c (c.id)}{@render toolRow(c)}{/each}
        {#if !working}
          {@const o = splitOptions(t.text)}
          {#if o.body.trim()}<div class="bubble assistant"><Md text={o.body} /></div>{/if}
          {#if last && o.options.length}
            <div class="chips">
              {#each o.options as opt (opt)}<button class="chip" onclick={() => chat.send(opt)}>{opt}</button>{/each}
            </div>
          {/if}
        {/if}
      {/if}
    {/each}

    {#if chat.streaming}
      <div class="bubble assistant"><Md text={chat.streaming} /></div>
    {:else if chat.running}
      <p class="muted small typing">Working…</p>
    {/if}

    {#if chat.ended === 'refusal'}<p class="muted small" role="status">The model declined to continue. Try rephrasing.</p>{/if}
    {#if chat.ended === 'step_limit'}<p class="muted small" role="status">Paused after many steps. Say “continue” to keep going.</p>{/if}
    {#if chat.ended === 'max_tokens'}<p class="muted small" role="status">The reply was cut off. Say “continue”.</p>{/if}
    {#if chat.error}<p class="error small" role="alert">{chat.error}</p>{/if}
    <div class="end" bind:this={end}></div>
  </div>

  <div class="composer" bind:offsetHeight={composerH}>
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
  .steps {
    display: grid;
    gap: 6px;
  }
  .steps summary {
    font-size: 0.85rem;
    color: var(--muted);
    cursor: pointer;
    padding-left: 4px;
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
  .chat {
    --dock: calc(56px + env(safe-area-inset-bottom)); /* tab bar */
  }
  .chat.embedded {
    --dock: env(safe-area-inset-bottom);
  }
  /* Scrolling the sentinel to the viewport bottom must stop above the fixed composer, or the newest message hides under it. */
  .end {
    scroll-margin-bottom: calc(var(--dock) + var(--composer-h, 0px) + 12px);
  }
  .composer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--dock);
    padding: 8px 16px;
    background: linear-gradient(to top, var(--bg) 70%, transparent);
    max-width: 960px;
    margin: 0 auto;
  }
</style>
