# Changelog

## Unreleased
- Faster onboarding: "Log in with OpenRouter" (OAuth PKCE, returns a user-owned key, default model
  `openrouter/auto`) and one-click local Ollama (no key, first installed model) are the default LLM choices; the
  API-key form moved behind "Use an API key instead". The n8n field accepts a bare Cloud name (`acme` ⇒
  `acme.app.n8n.cloud`) or any pasted editor link. Why: users had to find an instance URL and create an API key
  before seeing anything; now it is a name plus two logins. CSP `connect-src` allows `http://localhost:*` for Ollama.
- Install no longer asks for a base currency; it is inferred from the browser locale (first language tag with a
  region, USD fallback). Why: one less onboarding question, and the guess was already prefilled and rarely changed.
  An existing install keeps its stored `base_currency`.
- Incident: login to an n8n Cloud instance failed with "No MCP server found". Cause: MCP access was off in n8n
  settings (`/mcp-server/http` answers 404 `MCP access is disabled`). The error now says so and where to turn it on.
- Moved `.env.example` to `scripts/n8n.env.example`. Cloudflare's Git deploy wizard read the root file and asked the
  deployer for `N8N_BASE`/`N8N_MCP_TOKEN`, implying one shared n8n account. The app never used them: every user logs
  in to their own n8n in the browser and brings their own LLM key. Only `scripts/n8n.ts` reads them.

## 1.0.0-rc.1 (2026-11-15)
First release candidate. Implements docs/PLAN.md phases 0–7.

- **Phase 0 spike:** browser OAuth, workflow create/publish, webhook CORS, Code-node VAPID signing with real push
  delivery, workflow details for the gate, synchronous sub-workflow runs: all verified on n8n Cloud 2.47.7.
  n8n Cloud has no CORS on `/mcp-server/http` ⇒ re-planned around a same-origin stateless MCP proxy.
- **App:** Svelte 5 + Vite + TypeScript PWA; hand-rolled OAuth + MCP client; Claude and OpenAI-compatible streaming
  adapters; onboarding (n8n, LLM, install).
- **n8n core:** 9 data tables; `invenstory-api` (secret-path reads + item/analysis/push/action ops),
  `invenstory-notify` (payload-less Web Push), `invenstory-error`, `invenstory-analyze` (n8n LLM credential +
  structured output); idempotent installer with in-place versioned upgrades (core v2).
- **Dashboard:** KPIs, SVG revenue trend with tooltip/keyboard/table view, top sellers, stock list, one-tap action
  items (run or draft), insights, workflow activity; event-driven refresh.
- **Chat agent:** 19 gated tools, default-deny safety gate, persistent newest-session chat, live tool status and refusal
  reasons, run registered actions from chat.
- **Automations:** prompt + LLM suggestion chips, analysis setup, workflow list, registered actions, accounts,
  live connector search; notifications and settings.
- **Ops:** strict CSP `_headers`, Cloudflare Pages config, CI, `scripts/n8n.ts` terminal tool, documentation set.

## Changes since the last release
There was no earlier release: the previous state of the repository was the `init` commit (f144627), which held only
the implementation plan. Everything below is new in 1.0.0-rc.1, commit by commit, with the reason for each.
Decisions behind them are written up in [docs/DECISIONS.md](docs/DECISIONS.md) (D1–D16).

| Commit (in order; see `git log`) | What changed | Why |
|---|---|---|
| Phase 0 results and Phase 1 scaffold | Spike results recorded in the plan; re-plan to an MCP proxy; Svelte/Vite/TS app, IndexedDB store, OAuth + MCP client, Claude/OpenAI adapters, onboarding; proxy as Pages Function + dev middleware | Phase 0 proved browser OAuth works but n8n Cloud blocks browser MCP (no CORS), so a stateless same-origin proxy was needed (D1–D4) |
| Phase 2: install | Table schema, SDK-code templates for api/notify/error/analyze, Code-node logic as testable strings, idempotent installer, append-only config | The plan's deterministic core workflows; MCP lacks row updates (D5, D6) |
| Phase 3: dashboard | Data-plane client, event-driven dashboard store, KPI/trend/top sellers/stock/action items/insights/activity, safe markdown, draft links | Plan's fixed dashboard; reads via secret-path webhook; untrusted text never rendered as HTML |
| Phase 4: chat agent | Default-deny gate + policy, 18 gated tools, agent loop, system prompt, persistent newest-session chat UI | Plan's hard rule that workflows never send messages, enforced in code (D8–D10) |
| Phase 5: automations | Prompt + suggestion chips, analysis setup, workflow list, actions, accounts, connector search | Plan's Automations view, with everything read live from n8n |
| Phase 6 and 7 | Manifest, service worker (shell cache, payload-less push), push subscribe/unsubscribe, core v2 (endpoint dedupe) with in-place upgrade, settings, CSP `_headers` | Plan's push and PWA; upgrade path keeps workflow ids and VAPID keys (D7) |
| Record status | Implementation status in the plan | Hand-off traceability |
| Rate limits + run-action tool | 429 backoff/retry, non-JSON-RPC errors, waiting execution checks, `invenstory_run_action`, prompt rules | Live test: n8n rate-limited the agent, which then improvised a runner workflow (D11, D12) |
| History repair | `repairHistory` for unanswered tool calls | Live test: a reload or lost save broke every later Claude call in the session (D13) |
| drop_block | Claude requests drop thinking blocks whose prefix changed | Live test: an app update changed prompt/tools and invalidated stored thinking signatures (D14) |
| Release candidate | Documentation set, `scripts/n8n.ts`, token support in `Mcp`, CI, `wrangler.toml`, `.env.example`, version 1.0.0-rc.1 | Hand-off to a second developer and their Claude; reproducible live checks without the browser relay (D15, D16) |
| Document why each change was made | Commit-by-commit table with reasons, docs/DECISIONS.md (D1–D16), CLAUDE.md rule to record reasons | Team request: every change must carry its reason for the next developer |
| Restore the original plan | Original plan file restored verbatim at its original path; README done/to-improve summary | The original plan must stay available unedited; `docs/PLAN.md` is the living copy | Original plan file restored verbatim at its original path; README done/to-improve summary | The original plan must stay available unedited; `docs/PLAN.md` is the living copy |

## Incident log (found in live testing)
Kept so future work doesn't reintroduce them.

1. **n8n MCP has no CORS** (Phase 0, check 2). Browsers can't call `/mcp-server/http`; no instance setting exists.
   Fix: `/mcp` proxy (Pages Function + Vite middleware). OAuth endpoints do have CORS and stay direct.
2. **`get_data_table_rows` limit ≤ 100** broke the installer's config read. Fix: paged `readRows`.
3. **MCP rate limiting (429 "Too many requests")** while the agent polled executions and terminal checks ran in
   parallel; the client treated the non-JSON-RPC body as an empty result, so the agent saw failing tools and
   improvised a "runner" workflow. Fix: backoff/retry with Retry-After, non-JSON-RPC ⇒ error, execution checks wait
   server-side, prompt rule against polling, dedicated `invenstory_run_action` tool.
4. **`tool_use ids were found without tool_result blocks`** after a reload/lost save mid-run. Every later Claude
   request in that session failed. Fix: deterministic `repairHistory` (interrupted results) on load and before send.
5. **`Invalid signature in thinking block … bound to a different conversation`** after an app update changed the
   system prompt and tool list. Claude preserved thinking binds blocks to the prefix. Fix: send
   `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` with beta `thinking-binding-controls-2026-08-01`.
6. **Duplicate push subscriptions** possible when re-enabling notifications. Fix: client-side check + endpoint
   dedupe in the notify signing code (core v2, applied in place).
7. **Onboarding confusion:** a doc example's placeholder sheet link and "today's date" were taken literally. The agent
   handled it correctly; keep examples in user-facing text concrete.
