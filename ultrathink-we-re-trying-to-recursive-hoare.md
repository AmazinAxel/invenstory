# Invenstory — implementation plan

## Context
Setting up and maintaining inventory/stock and sales-tracking automation is technically hard, slow and error-prone for small businesses. Invenstory is a static, mobile-first PWA in which an LLM builds n8n workflows inside the user's own n8n, n8n ingests and analyses stock/sales data, and a fixed dashboard shows statistics, insights and one-tap action items. There is no server of ours and no accounts. Greenfield project at `/home/alec/Projects/invenstory`.

## Decisions fixed in the interview
- **Hosting**: static files plus one stateless MCP CORS proxy (Cloudflare Pages Function `functions/mcp.ts`, same origin as the app). No accounts, no stored state, nothing logged. *(Re-planned 2026-11-14 after Phase 0 check 2: n8n Cloud sends no CORS headers on the MCP endpoint.)*
- **n8n**: the user's own instance (dev/test: n8n Cloud, paid plan). Connection = instance-level MCP server with OAuth login. OAuth discovery, client registration, authorize and token exchange run directly from the browser (verified, Phase 0 check 1); only MCP calls go through the proxy.
- **State**: n8n data tables are the only store. The browser keeps only secrets and config.
- **Analysis**: runs inside n8n (LLM credential also created in n8n), after data changes and on demand. No schedule.
- **Chat agent**: runs in the browser, calls the LLM directly and drives n8n MCP tools.
- **LLM protocols**: two adapters, Claude native and OpenAI-compatible (base URL + key + model; covers OpenAI, Gemini, OpenRouter, Grok, Groq).
- **Live updates**: Web Push sent by n8n. Push events: new action items, workflow failed. Signal only, no business data in the push.
- **Reads**: n8n webhook with a secret random path.
- **Dashboard**: fixed layout and canonical schema. Cards: KPI row, stock list, sales trend, top sellers, insights, action items, workflow activity.
- **Action items**: one tap either runs a registered workflow or opens a prefilled draft (mail / WhatsApp / SMS app) the user sends themselves; then marked done.
- **Safety**: workflows never send messages or emails (writes to business systems allowed). No confirmation prompts. Enforced by a hard gate in the app.
- **Chat sessions**: stored as multiple sessions, UI shows only the newest. Each completed analysis run opens a new session. No session list.
- **Connectors UI**: live from n8n only (`list_credentials`, `search_nodes`), nothing hardcoded for display. Credentials are created in n8n's UI via deep link.
- **Secrets**: stored plainly on the device.
- **UI**: Svelte 5 + Vite + TypeScript via bun, PWA, minimal; onboarding steps and empty states may carry one short sentence.
- **Deferred, planned only**: ElevenLabs realtime voice; PCA / dimensionality-reduction views.

## Verified facts
- n8n MCP (`<instance>/mcp-server/http`) offers OAuth or bearer token; tools include `validate_workflow`, `create_workflow_from_code`, `update_workflow`, `publish_workflow`, `test_workflow`, `execute_workflow`, `get_workflow_details`, `search_workflow_executions`, `list_credentials`, `search_nodes`, `get_node_types`, `get_workflow_sdk_reference`, `create_data_table`, `add_data_table_rows`. It has **no** row read/update/delete and **no** credential creation.
- Phase 0 on n8n Cloud 2.47.7: `/.well-known/oauth-protected-resource/mcp-server/http`, `/.well-known/oauth-authorization-server`, `/mcp-oauth/register|authorize|token` all work from the browser (CORS `*`); DCR accepts any redirect URI ("Allowed callback URLs: All"). `/mcp-server/http` sends **no** CORS headers and there is no setting for it, so browsers cannot call it directly.
- n8n Cloud's Code node allows the `crypto` module (needed to sign Web Push).
- Live CORS preflight passes for api.anthropic.com, api.openai.com, api.x.ai, openrouter.ai, api.groq.com and Gemini's OpenAI-compatible endpoint.
- Phase 0 results (2026-11-14, n8n Cloud 2.47.7, MCP server 1.2.0, protocol 2025-06-18, 70 tools):
  1. Browser OAuth (DCR `token_endpoint_auth_method: none`, PKCE S256, `resource` param, scopes from protected-resource metadata) — pass. Access token 1 h + refresh token.
  2. MCP via the `/mcp` proxy — pass. Server is stateless (no `mcp-session-id`); responses are JSON or SSE.
  3. `validate_workflow` → `create_workflow_from_code` → `publish_workflow` of a webhook (custom path) + data-table insert + sub-workflow — pass. Credential binding still untested (instance had no credentials); `create_workflow_from_code` auto-assigns existing credentials of the matching type (`autoAssignedCredentials`).
  4. Browser POST (JSON, preflighted) to the webhook — pass. Webhook option `allowedOrigins` answers preflight with exactly that origin.
  5. Code node `require('crypto')` ES256 VAPID JWT (`createPrivateKey({format:'jwk'})`, `dsaEncoding:'ieee-p1363'`) → HTTP Request node payload-less POST → FCM 201 → service worker `push` event — pass. The Code sandbox has no network; sending must be an HTTP Request node.
  6. `get_workflow_details` returns nodes with `type`, `typeVersion`, full `parameters` (`resource`, `operation`, `method`, `jsCode`, `workflowId`), `credentials`, plus `settings` — pass.
  7. Webhook → data table → Execute Sub-workflow (wait) → Respond to Webhook — pass, 2.9 s round trip from the browser.
- MCP also has `get_data_table_rows` (filter/sort/paginate); still no row update/delete tools.

## Architecture
Browser (static) uses three channels:
1. **Control plane** — MCP over streamable HTTP with OAuth → same-origin proxy `/mcp` (header `x-n8n-instance: <origin>`) → `<instance>/mcp-server/http`: install core, build workflows, credentials, node catalogue, executions, append-only rows (chat messages, sessions, push subscriptions, action registry) so the chat log stays behind the login.
2. **Data plane** — HTTPS to the `invenstory-api` webhook (secret path): all reads, plus synchronous mutations and runs (awaited fetch, no polling).
3. **LLM** — HTTPS to the provider for the chat agent loop.

n8n → push service → service worker → notification, or `postMessage` refresh if the app is focused. The dashboard refreshes only on events: open, focus, push, own action completing.

### n8n tables (canonical schema; types string/number/boolean/date)
- `inv_products`: sku, name, quantity, reorder_point, unit_cost, unit_price, currency, source, updated_at
- `inv_sales`: sale_id, sold_at, sku, quantity, revenue, currency, channel
- `inv_sessions`: session_id, created_at, origin (onboarding|analysis), execution_id
- `inv_messages`: session_id, created_at, role, content (JSON)
- `inv_action_items`: item_id, session_id, created_at, title, detail, kind (run|draft), workflow_id, input, draft_channel, draft_to, draft_subject, draft_body, status, done_at
- `inv_actions`: workflow_id, name, description, input_schema, registered_at (gate-passed runnable workflows)
- `inv_push_subscriptions`: endpoint, created_at
- `inv_events`: created_at, kind (action_items|failure), title, body, workflow_id
- `inv_config`: key, value (version, vapid_public_key, base currency, analysis model)

Money KPIs use one base currency per instance (set during onboarding); rows in other currencies are excluded and their count is shown.

### Core workflows (shipped as deterministic SDK-code templates, no LLM; installed with `validate_workflow` → `create_workflow_from_code` → `publish_workflow`)
- `invenstory-api` — Webhook, secret path, allowed origin = app origin.
  - GET `view=summary&period=7d|30d|90d` → kpis, salesTrend, topSellers, slowMovers, open actionItems, newest session with messages, config
  - GET `view=stock&q=&cursor=`; GET `view=notice` (latest event, for the service worker)
  - POST `item.done`, `item.dismiss`, `item.run` (runs the registered sub-workflow synchronously, marks done, appends output to the session), `analyze`, `push.unsubscribe`, `action.unregister`
- `invenstory-analyze` — sub-workflow: aggregate tables → chat-model node bound to the user's n8n LLM credential (node variant chosen by credential type) with structured output → new session + insight message + action items → `invenstory-notify` if new items.
- `invenstory-notify` — sub-workflow: Code node signs a VAPID JWT (ES256, `crypto`), payload-less POST to each subscription, deletes rows answering 404/410. VAPID key pair is generated in the browser at install; the private key lives in this workflow.
- `invenstory-error` — Error Trigger, set as error workflow on every Invenstory workflow → event row + notify.

### LLM-built workflows (through the chat agent)
- **Ingest**: trigger (app trigger preferred) → read connector → normalise → upsert `inv_products` / insert `inv_sales` → call `invenstory-analyze` only when rows changed.
- **Action**: Execute Workflow Trigger → steps → return output; registered in `inv_actions` after passing the gate.

## Safety gate (`src/lib/n8n/gate.ts`, `policy.ts`)
The LLM reaches n8n only through the app's tool wrapper, which exposes a fixed subset of MCP tools (no agent, skill, preference, credential-edit, table-schema or delete tools). After every create/update and before every publish/execute/register, the wrapper loads `get_workflow_details` and checks each node, default-deny:
- core flow/transform/trigger/data-table/LLM nodes: allowed;
- known business-system nodes: allowed unless the operation name matches a send/message verb;
- known messaging/email nodes: read operations and triggers only;
- HTTP Request: GET only; Code: refused if it references network or `require`; MCP-client and unknown node types: refused;
- Execute Sub-workflow: target must be a core workflow or itself pass the gate.

Violations are returned to the LLM as the tool error; publish/run is refused. Data from tables and tools is passed to the LLM marked as untrusted. LLM output and n8n data are rendered through a minimal safe markdown renderer, never as raw HTML; `_headers` sets a strict CSP (`script-src 'self'`).

## App layout
```
package.json  vite.config.ts  svelte.config.js  tsconfig.json  index.html
functions/mcp.ts                  MCP CORS proxy (Pages Function); vite dev server mounts the same handler
public/       manifest.webmanifest  sw.js  icon.svg  _headers
src/main.ts   App.svelte  app.css
src/lib/kv.ts                     IndexedDB key-value, shared with sw.js
src/lib/n8n/{oauth,mcp}.ts        OAuth (discovery, DCR, PKCE, refresh) + streamable-HTTP MCP client, hand-rolled as in the spike
src/lib/n8n/install.ts            detect / install / upgrade tables + core workflows
src/lib/n8n/core/{api,analyze,notify,error}.ts   SDK-code templates
src/lib/n8n/api.ts                data-plane client
src/lib/n8n/{gate,policy}.ts
src/lib/llm/{types,sse,anthropic,openai}.ts      streaming + tool calls, plain fetch
src/lib/agent/{loop,tools,prompt}.ts             loop, tool subset + gate wrapper, system prompt
src/lib/{push,draft,md}.ts        VAPID + subscribe, draft URL builder, safe markdown
src/state/*.svelte.ts             runes stores
src/views/{Onboarding,Dashboard,Chat,Automations}.svelte
src/ui/                           Kpi, StockList, Trend (hand SVG), TopSellers, ActionItem, Activity, Prompt, TabBar, icons
test/                             gate, sse, draft, vapid
```
Runtime dependencies: `svelte` only. (`@modelcontextprotocol/sdk` dropped: its OAuth flow ties the resource to the server URL, which breaks behind the `/mcp` proxy; the hand-rolled client was verified in Phase 0.) No UI, chart, PWA or LLM SDK libraries. bun 1.4.4 in `~/.bun/bin`; no flake needed.

## Phases
**0. Spike (blocking).** Throwaway page in `spike/`, run against the user's n8n Cloud with the user clicking through login. Checks: (1) browser OAuth incl. client registration, PKCE and token exchange; (2) MCP tool calls from the browser through the `/mcp` proxy (spike: emulated in `spike/server.py`); (3) `create_workflow_from_code` + publish of a webhook workflow with custom path, data-table node and bound credential; (4) browser fetch to that webhook on Cloud; (5) Code-node ES256 signing and a push that arrives; (6) `get_workflow_details` exposes node type + operation for the gate; (7) synchronous sub-workflow run through the webhook inside Cloud's timeout. Check 1 failing → stop and re-plan. Any other failure → stop and report before continuing. Delete `spike/` afterwards.

**1. Scaffold + connect.** Project, kv store, n8n URL entry, OAuth, LLM provider form with a test call.

**2. Install.** Detect existing install (`search_workflows`, `search_data_tables`) or create tables and core workflows; rediscover the secret webhook path on a new device; check for an LLM credential in n8n and deep-link if missing.

**3. Dashboard.** Fixed cards from `view=summary` / `view=stock`, period switch, action item tap (run or draft), activity from `search_workflow_executions`, refresh on events.

**4. Chat.** Both adapters, agent loop with gated tools, newest-session view, onboarding interview that builds the first ingest workflows, follow-ups in the same session, messages appended via MCP.

**5. Automations.** Connected credentials, node catalogue search, deep link to n8n credentials, Invenstory workflow list with status, prompt box (same chat), suggestion chips generated by one LLM call when the credential set changes.

**6. Push + PWA.** Manifest, service worker (app shell + push handler), VAPID keygen, subscribe, notification on new action items and failures.

**7. Finish.** Mobile pass (safe areas, touch targets, bundle size), CSP, `bun run build` → `dist/` + `functions/` ready for Cloudflare Pages (other hosts need an equivalent `/mcp` proxy route). Deployment is not performed unless asked.

## Deferred (planned, not built now)
- **Voice — ElevenLabs realtime.** Preferred shape: ElevenLabs realtime speech-to-text and streaming text-to-speech wrapped around the existing browser agent loop, so the user's LLM and the gate stay in charge; ElevenLabs key entered like the LLM key. Browser access to those endpoints must be verified first. Voice-driven suggestions come with it.
- **PCA / dimensionality reduction.** Explore later: build a standardised feature matrix per product or asset over time (price, sales velocity, margin, stock cover, volatility) from the canonical tables, compute PCA in the browser, show a 2D/3D scatter with component loadings and time trajectories; compare with a non-linear method (UMAP) for clusters. Study applicability to multi-asset data (prices, indices, property values over time). No implementation now.

## Verification
- `bun install`, `bun run check` (svelte-check + tsc), `bun test` (gate policy, SSE parsing, draft URLs, VAPID JWT verified with WebCrypto), `bun run build`, `bun run preview`.
- End to end with the user's n8n Cloud: login → install → add a Google Sheets credential → chat builds an ingest workflow → dashboard fills → analysis opens a new session → follow-up question → tap a run item and a draft item → ask for a workflow that emails a supplier and see the gate refuse it → push arrives with the app closed (needs an HTTPS deployment and the PWA installed on the phone) → sign in on a second device and see the same state.

## Prerequisites from the user
n8n Cloud instance URL on 2.36+ with instance-level MCP enabled; an LLM credential created in n8n; an LLM API key for the app.

## MCP proxy (`functions/mcp.ts`)
- Accepts POST/GET/DELETE on `/mcp`; target from `x-n8n-instance` (https origin only, no path); forwards only to `<target>/mcp-server/http`.
- Forwards only `authorization`, `content-type`, `accept`, `mcp-session-id`, `mcp-protocol-version`, `last-event-id`; returns body streamed (SSE) with `content-type`, `mcp-session-id`, `www-authenticate`.
- Host allowlist from env `N8N_ALLOWED_HOSTS` (default `*.app.n8n.cloud`); no logging, no storage.
- Self-hosted n8n behind the user's own reverse proxy can add CORS there and skip the proxy (config switch "direct").

## Known risks
- The bearer token transits the proxy (our edge function); whoever operates the deployment could read it.
- Anyone holding the secret webhook URL can read business data and chat history and trigger registered runs.
- Secrets sit unencrypted in browser storage.
- The gate's node lists need upkeep; unlisted connectors are refused until added.
- n8n workflow building via MCP is in public preview; iPhone push needs the PWA installed.
- n8n data tables have a size cap; large sales histories may need pruning later.
