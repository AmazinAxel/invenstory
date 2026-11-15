# Architecture

## Overview

```
 Browser (PWA, static)                                   User's n8n (Cloud or self-hosted)
 ┌──────────────────────────────┐                        ┌──────────────────────────────────────┐
 │ Svelte 5 app                  │  OAuth (direct, CORS)  │ /mcp-oauth/*  /.well-known/*          │
 │  ├ onboarding / install ──────┼───────────────────────▶│                                        │
 │  ├ chat agent ─┐              │  MCP JSON-RPC          │ /mcp-server/http  (no CORS headers)   │
 │  │  gated tools ├─▶ /mcp ─────┼──▶ proxy (Pages Fn) ──▶│   tools: build/publish workflows,      │
 │  │             │   same-origin│     stateless          │   credentials list, node catalogue,    │
 │  ├ automations ┘              │                        │   data-table rows (append/read)        │
 │  ├ dashboard ─────────────────┼── HTTPS GET/POST ─────▶│ /webhook/inv-<secret>  invenstory-api  │
 │  └ service worker ◀── push ───┼── FCM/APNs ◀── VAPID ──│ invenstory-notify (Code node signs)    │
 │                               │                        │ invenstory-analyze (n8n LLM credential)│
 │  IndexedDB: tokens, LLM key,  │                        │ data tables inv_* (the only store)     │
 │   voice key (optional)        │                        │                                        │
 └──────────────┬───────────────┘                        └──────────────────────────────────────┘
                │ HTTPS (streaming, tool calls)          optional voice: HTTPS + WSS
                ▼                                         ──▶ ElevenLabs (speech-to-text, text-to-speech)
        LLM provider (Claude API or OpenAI-compatible)
```

Three channels from the browser (plus optional voice):
1. **Control plane**: MCP over streamable HTTP with OAuth, through the same-origin `/mcp` proxy
   (n8n Cloud sends no CORS headers on `/mcp-server/http`; found in Phase 0). Used for install, building workflows,
   credentials and node catalogue, executions, and append-only rows (chat messages, sessions, push subscriptions,
   action registry).
2. **Data plane**: HTTPS to the `invenstory-api` webhook at a secret random path (`/webhook/inv-<32 hex>`). All
   dashboard reads, plus synchronous mutations and action runs.
3. **LLM**: the chat agent loop runs in the browser and calls the provider directly (CORS verified for Anthropic,
   OpenAI, Gemini's OpenAI endpoint, OpenRouter, xAI, Groq).
4. **Voice** (optional, only with a voice key on the device): ElevenLabs REST + realtime WebSocket, see Voice below.

Analysis does **not** use the app's LLM key: it runs inside n8n on an LLM credential the user creates in n8n.

## The `/mcp` proxy (`src/server/mcp-proxy.ts`, mounted by `functions/mcp.ts` and `vite.config.ts`)
- Accepts POST/GET/DELETE on `/mcp`; the target comes from header `x-n8n-instance: <https origin>`.
- Forwards only to `<target>/mcp-server/http`, only these request headers: `authorization`, `content-type`, `accept`,
  `mcp-session-id`, `mcp-protocol-version`, `last-event-id`; returns `content-type`, `mcp-session-id`,
  `www-authenticate`; body streamed (SSE). Max request 1 MB.
- Host allowlist from env `N8N_ALLOWED_HOSTS` (default `*.app.n8n.cloud`; `*.x` matches exactly one label).
- Stores and logs nothing. The bearer token passes through it (accepted risk, see INFRASTRUCTURE.md).
- Login itself (discovery, dynamic client registration, PKCE, token exchange, refresh) goes **directly** from the
  browser to n8n: those endpoints send `Access-Control-Allow-Origin: *`.

## Data tables (canonical schema, `src/lib/n8n/core/schema.ts`)
Every table also has n8n's own `id`, `createdAt`, `updatedAt`.

| Table | Columns | Written by |
|---|---|---|
| `inv_products` | sku, name, quantity, reorder_point, unit_cost, unit_price, currency, source, updated_at | ingest workflows (upsert on sku) |
| `inv_sales` | sale_id, sold_at, sku, quantity, revenue, currency, channel | ingest workflows (insert, dedupe on sale_id) |
| `inv_sessions` | session_id, created_at, origin (onboarding\|analysis), execution_id | app (chat), analyze |
| `inv_messages` | session_id, created_at, role, content (JSON string) | app (chat), analyze, api (action results) |
| `inv_action_items` | item_id, session_id, created_at, title, detail, kind (run\|draft), workflow_id, input, draft_channel, draft_to, draft_subject, draft_body, status (open\|done\|dismissed), done_at | analyze, agent (`invenstory_run_action`), api (status) |
| `inv_actions` | workflow_id, name, description, input_schema, registered_at | agent (`invenstory_register_action`); api deletes on unregister |
| `inv_push_subscriptions` | endpoint, created_at | app (MCP append); api/notify delete |
| `inv_events` | created_at, kind (action_items\|failure), title, body, workflow_id | notify |
| `inv_config` | key, value | installer (append-only, newest row per key wins) |

Config keys: `version`, `base_currency`, `vapid_public_key`, `notify_workflow_id`, `analyze_workflow_id`, `analysis_model`.
Money KPIs use one base currency; rows in other currencies are excluded and counted (`kpis.excluded_rows`).

## Core workflows (`src/lib/n8n/core/`, generated as n8n Workflow SDK code, no LLM)
Installed by `install()` with `validate_workflow` → `create_workflow_from_code` → `publish_workflow`.

### `invenstory-api` (templates.ts: `apiWorkflow`)
Two Webhook triggers on the same secret path (GET and POST), `responseMode: responseNode`, `allowedOrigins` = the app
origins (installer adds new origins in place).

| Request | Response |
|---|---|
| `GET ?view=summary&period=7d\|30d\|90d` | `Summary` (see `src/lib/n8n/api.ts`): kpis, sales_trend (daily), top_sellers, slow_movers, open action_items, newest session with messages, config |
| `GET ?view=stock&q=&cursor=` | `{ total, next, items }`, 50 per page, search on sku/name |
| `GET ?view=notice` | latest `inv_events` row (used by the service worker) |
| `POST {op:"item.done"\|"item.dismiss", item_id}` | `{ok:true}` |
| `POST {op:"item.run", item_id}` | runs the item's workflow **only if** the item is an open `run` item and its workflow is in `inv_actions`; marks done; appends an `action_result` message; returns `{ok, output}` (400 `{ok:false,error}` otherwise) |
| `POST {op:"analyze"}` | starts `invenstory-analyze` without waiting (`{ok, started}`), or 400 if analysis is not set up |
| `POST {op:"push.unsubscribe", endpoint}` / `{op:"action.unregister", workflow_id}` | delete rows, `{ok:true}` |

Reads fan into Data table "get" nodes (`executeOnce`, `alwaysOutputData`) and one Code node (`SUMMARY`, `STOCK`,
`NOTICE` in `code.ts`). Placeholder `{}` items from `alwaysOutputData` are filtered by `real()`.

### `invenstory-notify` (`notifyWorkflow`)
Execute Workflow Trigger (passthrough `{kind,title,body,workflow_id}`) → insert `inv_events` → all subscriptions →
Code node signs one ES256 VAPID JWT per push-service origin (`require('crypto')`, key embedded) and dedupes endpoints →
HTTP Request POST, payload-less, `TTL: 86400` → delete rows answering 404/410. No business data is in the push.

### `invenstory-error` (`errorWorkflow`)
Error Trigger → describe failure → notify (`kind: failure`). Set as `errorWorkflow` on api, analyze and every
agent-built workflow. Not set on notify (would loop).

### `invenstory-analyze` (`analyze.ts`, installed later from Automations once an LLM credential exists)
Trigger → products, sales (90 d), open items, config, registered actions → `ANALYSIS_FACTS` Code (compact JSON) →
Basic LLM Chain with the chat-model node matching the credential type (`MODEL_CHOICES`; Anthropic uses
`claude-opus-5-5`, adaptive thinking, effort medium) and a Structured Output Parser (`ANALYSIS_SCHEMA`) →
`ANALYSIS_RECORDS` Code validates (≤5 items; `run` only for registered workflow ids; drafts limited to
email/whatsapp/sms) → new session + insight message + action items → notify if items were created.

## Safety gate (`src/lib/n8n/policy.ts`, `gate.ts`)
Checked after every create/update by the agent and before every publish, test, run and action registration. Default-deny.

| Node class | Rule |
|---|---|
| Flow/transform/trigger/data-table/LLM (`CORE_NODES`) | allowed |
| Business systems (`BUSINESS_NODES`: Sheets, Shopify, WooCommerce, Airtable, Postgres, …) | allowed unless operation (or resource+non-read op) matches `SEND_VERB`; expression operations refused |
| Messaging/email (`MESSAGING_NODES`: Gmail, Outlook, Slack, Telegram, WhatsApp, Twilio, …) | triggers and `READ_VERB` operations only |
| HTTP Request (+ tool) | literal `GET` only |
| Code (+ tool) | refused if it matches `CODE_NETWORK` (require/import/fetch/helpers.httpRequest/process/eval/…) |
| Execute Sub-workflow (+ tool) | fixed id only; target must be core analyze/notify or pass the gate itself (recursive, cycle-safe, depth 3) |
| `REFUSED_NODES` (command, SSH, n8n API, MCP client, legacy Function, emailSend, …) and anything unlisted | refused |

Violations go back to the LLM as the tool error (`describeViolations`), and the UI shows them as a red "refused" row.

## Chat agent (`src/lib/agent/`)
- `tools.ts` is the **only** way the LLM reaches n8n: 19 tools (node search/types, SDK reference, credentials list,
  workflow search/get/validate/create/update/test/publish/run, execution status (waits up to about 40 s), Invenstory schema,
  table read, register action, run action, start analysis). No agent/skill/preference/credential-edit/table-schema/
  delete tools. Agent-built workflows are named `Invenstory · …`; only those can be changed or run; core workflows
  are off limits. Creating a workflow auto-sets the error workflow.
- `loop.ts`: model turn → tool calls run sequentially → results appended → repeat (max 30 steps). Refusal stop
  reason ⇒ tools of that turn are not run. Invalid/truncated tool JSON (eager input streaming) ⇒ error result.
- `prompt.ts`: stable per install (caches). Tool results from n8n are prefixed as untrusted data.

## LLM adapters (`src/lib/llm/`)
Neutral `Message { role, parts: Part[] }` with parts `text`, `tool_call`, `tool_result`, `native` (Claude thinking /
redacted thinking / fallback blocks kept verbatim, replayed only to Claude).
- `anthropic.ts`: `POST /v1/messages`, `anthropic-version: 2026-10-21`, `anthropic-dangerous-direct-browser-access`,
  stream, top-level `cache_control`, `eager_input_streaming` on tools, `output_config.effort`, server-side
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) and `thinking.block_binding.prefix_mismatch_behavior:
  "drop_block"` (beta `thinking-binding-controls-2026-08-01`) on supported first-party models. After a mid-output
  fallback, thinking/tool_use blocks before the `fallback` block are dropped and not executed.
- `openai.ts`: Chat Completions streaming with tool calls (OpenAI, Gemini, OpenRouter, Grok, Groq presets or custom).

## Chat persistence (`src/state/chat.svelte.ts`, `chat-history.ts`)
- Sessions/messages are appended to n8n via MCP (`add_data_table_rows`); content `{"type":"parts","parts":[…]}`.
  The UI shows only the newest session (from `view=summary`); each analysis run creates a new session.
  "New chat" resets the screen client-side; `shouldAdopt` keeps the older summary session hidden until a newer one exists (D21).
- History is replayed byte-identically (stored content == live content). Each user message carries a dashboard
  snapshot part (hidden in the UI) so answers can quote figures.
- `repairHistory` gives any unanswered tool call a fixed "interrupted" result (reload mid-run, lost save).
- Analysis sessions start with a synthetic user turn (APIs require a user message first).

## Voice (`src/lib/voice/`, `src/state/voice.svelte.ts`)
Optional and per device: invisible unless an ElevenLabs key is saved in the Voice card at the bottom of the Automations tab (`K.voice` =
`{ provider, apiKey, voiceId, voiceName, ttsModel, sttModel }`). The Voice card itself only shows on a device that
opened the app once with `?voice` (flag in `localStorage`), so ordinary users are never asked for a key.
A wrapper around the chat agent, nothing more:
- **In:** mic (`getUserMedia`, echo cancellation, noise suppression, auto gain, mono) → AudioWorklet
  `public/voice-capture.js` (same-origin for the CSP) → 16 kHz 16-bit PCM in ~100 ms chunks (resampled if the
  context runs at another rate) → `wss://api.elevenlabs.io/v1/speech-to-text/realtime` opened with a fresh
  single-use token (`POST /v1/single-use-token/realtime_scribe`). Push-to-talk: one session per press,
  `commit_strategy=manual`, commit on release. Hands-free: one session, `commit_strategy=vad`, half-duplex (silence
  is sent while the reply plays; listening resumes ~0.45 s after), reconnects up to 3 times after time limits/drops.
- **Turn:** the final transcript goes through `chat.send(text, { voice: true })`, which adds the hidden `VOICE_HINT`
  text part (after the snapshot part; `isHiddenText` hides both in the UI). Stored and replayed like any message.
- **Out:** `Chat.listen()` events (start, text delta, tool start, end) → `SentenceChunker` (incremental, skips code
  and tables, markdown stripped by `toSpeech`) → `Speaker` (one `POST /v1/text-to-speech/{voice}/stream?
  output_format=pcm_24000` at a time, at most one sentence downloaded ahead, `AbortController` on stop) →
  `WebAudioSink` (one `AudioContext`, gapless scheduling, created in the user's tap). No `<audio>`/`blob:`, so no
  `media-src` in the CSP.
- **While it works:** tool starts become spoken progress lines (`ProgressThrottle`: newest label, ≥ 6 s apart, never
  over speech or the user's own words). Speech during a run: "stop"/"cancel" → `chat.stop()` + silence; anything
  else → one tool-less `createLlm(app.llm).turn()` with `QUICK_SYSTEM`, the snapshot and the tool status, spoken and
  shown as an ephemeral "quick answer" (not persisted, not in `chat.messages`).
- **Seam:** engines implement `SttEngine` / `TtsEngine` (`types.ts`); `createEngines()` in `index.ts` picks them.
  Only ElevenLabs exists. Voice errors show in the voice bar and never touch `chat.error`.

## Dashboard and push
- Refresh only on events: open, focus (≥15 s apart), push (service-worker message), own action completing.
- Action items: `run` → `POST item.run`; `draft` → open `mailto:` / `https://wa.me/` / `sms:` link with prefilled text
  in the user's own app, then `item.done`. Invenstory never sends messages itself.
- `public/sw.js`: network-first shell, immutable `/assets/*` cache; on push, refresh the focused window or fetch
  `view=notice` (API URL read from IndexedDB key `api`) and show a notification.

## File map
```
functions/mcp.ts            Pages Function → src/server/mcp-proxy.ts
public/                     manifest, sw.js, icon.svg, _headers (CSP), voice-capture.js (AudioWorklet)
scripts/n8n.ts              terminal MCP access (token)
src/lib/kv.ts               IndexedDB store (shared with sw.js)
src/lib/n8n/                oauth, mcp, install, api, gate, policy, core/{schema,code,sdk,templates,analyze}
src/lib/llm/                types, anthropic, openai, index (createLlm, testLlm)
src/lib/agent/              tools, prompt, loop
src/lib/voice/              types (engine seam), elevenlabs, capture, player, speaker, text, pcm, progress, quick
src/lib/{sse,draft,md,format,push,suggest}.ts
src/state/                  app, dashboard, chat (+ chat-history), voice
src/views/                  Onboarding, InstallStep, Shell, Dashboard, Chat, Automations
src/ui/                     Kpi, Trend, SalesHeatmap, StockOverview, ActionItem, Activity, Md, MdInline, Prompt, TabBar, Settings, VoiceSettings, MicButton, VoiceBar, Icon
test/                       bun tests
docs/                       this folder
```
