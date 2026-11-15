# Changelog

## Unreleased
- Voice mode (optional, per device): talk to the chat and hear the answer. Open the app once with `?voice` to
  reveal the Voice card on that device (ordinary users are never asked for an ElevenLabs key), then paste the key in
  the Voice card at the bottom of the Automations tab (checked against the account, voices and speech models loaded,
  Test voice, credits shown); a mic button then appears in the chat composer. Hold to talk and release to send (or
  tap to start, tap to send), with a live transcript; the reply is spoken sentence by sentence while it streams, with
  a Stop control. Hands-free lets ElevenLabs detect the end of a turn and does not listen while the reply plays.
  During long runs it says short progress lines from the tool labels (at most one about every 6 s), "stop"/"cancel"
  ends the run, and other questions get a quick spoken answer that is shown once and not saved. Spoken messages carry
  a hidden voice hint so the model answers in a few plain sentences; the `Options:` line of a reply is shown as chips
  but never read aloud. Why: owners on the shop floor want to ask without typing; wrapping the existing agent keeps
  the gate, tools and history unchanged (see the voice ADR in docs/adr/). Production headers: `Permissions-Policy`
  now allows the microphone for the app (`microphone=(self)`) and the CSP `connect-src` adds
  `wss://api.elevenlabs.io` (`https:` does not cover WebSockets). Without a voice key nothing changes.
- Analysis now ranks up to five products worth investing more in, each with a one-line reason, and the Dashboard
  shows them at the top ("Invest more in", hidden until an analysis has produced picks). The model gets per-product
  revenue for this and the previous period, units, stock and margin. Core v4: setup patches the `Prepare Facts`,
  `Insight Format`, `Analyst` and `Build Records` nodes of `invenstory-analyze` in place. Why: the owner asked which
  products to invest in. Suppliers are not ranked yet: the store has no supplier data, and n8n MCP cannot add a
  column to an existing table.
- The Revenue Heatmap shows products instead of categories and now has real data: one tile per product (top 50),
  area = revenue this period, color = change against the period before. Core v3: the summary reads two periods of
  sales and returns `product_sales`; installs below v3 rerun setup on load, which updates the `Summary Sales` filter
  and `Build Summary` code in place. Upgrades now also run when setup had to recreate the notify workflow (before,
  that skipped every upgrade step). Why: the dashboard redesign added the heatmap without a data source (it always
  said "not connected"), and the store has no product categories.
- The Dashboard shows the latest analysis insight again ("Latest analysis" card beside Sales, with "Ask a
  follow-up"). Why: the redesign dropped it, so analysis results were only visible in Chat. The unused TopSellers and
  StockList components are removed (the heatmap and Stock Overview replace them).
- Chat has a "New chat" button: it clears the conversation and the next message starts a separate session, so the model
  no longer sees the old messages (#21, D21). Why: the only way to change topic was to keep chatting in one growing
  history. Earlier chats stay in n8n but the app shows only the newest session, so they cannot be reopened. Reloading
  before sending shows the previous chat again.
- The Automations tab has an "AI provider" card again: it shows the current provider and model and lets the owner switch
  to Claude or any OpenAI-compatible provider (OpenAI, Gemini, OpenRouter, Grok, Groq, Ollama, custom URL) with an API
  key. The connection is tested before saving and the old provider is kept if it fails (#20, D20). Why: without it a
  wrong or expired key could only be fixed by clearing site data; Groq has no OAuth login, so a key form is the route.
  The onboarding key form and this card are one shared component.
- The Notifications and Settings card is gone from the Automations tab, so "Change language model" and "Disconnect
  n8n" are no longer reachable once setup is done (the Setup view still has them while setup is open). Why: the owner decided
  these controls don't belong in daily use; notifications are now asked for once on the Dashboard (#13) and changed
  in the browser's site settings. To switch model or disconnect today, clear the site's data.
- Chat keeps following a streaming reply on phones: it no longer stops after a few chunks and shows "Jump to latest" by
  itself. Only the reader scrolling up pauses it. Why: iOS Safari delivers scroll events a frame late and overshoots
  `scrollIntoView`, which the old at-the-bottom check mistook for the reader leaving (incident 9).
- Notifications are asked for with a one-time "Turn on notifications" card on the Dashboard; tapping it opens the
  browser's own permission popup and enables push. It hides when push is unavailable, already on, blocked, or after
  the owner taps "Not now". Why: the Automations-tab Settings card is going away (#14), and enabling push needs a
  tap, so the prompt has to live somewhere the owner sees first. Afterwards the browser's site settings control it.
- Automation ideas moved from the Automations tab to the empty Chat: the "Describe an automation" card is gone and
  the AI-suggested ideas show beside the starter chips. Why: it was a second, duplicate chat prompt; Chat is where
  automations are created, so ideas belong there. Ideas load when the empty chat is first seen (not at app start).
- Accessibility polish (UI audit P2s): buttons show hover and press feedback; placeholders use the muted color
  (4.1:1 ⇒ 5:1+ in dark mode); every error message is announced (`role="alert"`, success notes `role="status"`); the
  tab badge is read as "N new"; the connector search has a label; text links and the open-in-n8n icon get ~44px tap
  areas without changing layout. Why: taps gave no feedback on phones, and screen-reader and small-target gaps
  remained after the P1 pass.
- Chat scrolling: the newest message now stops above the fixed composer, a streaming reply keeps following only while
  the owner is at the bottom (scroll up to read and it leaves you alone), and a "Jump to latest" button appears when new
  content arrives out of view. Opening the Chat tab and sending a message always go to the bottom. Why: autoscroll
  appeared not to work, and a follow-the-bottom view that can't be escaped is unreadable while a reply streams.
- Accessibility and startup cost (UI audit P1s): text fields, the stock search and the chat composer get a
  `--control-line` border with at least 3:1 contrast in both themes (was 1.28:1, WCAG 1.4.11). The Automations tab loads its
  n8n data and AI ideas on first visit instead of at app start. Why: fields were hard to find for low-vision users, and
  hidden-tab loads spent rate-limited n8n MCP calls and an LLM call on every launch.
- Chat shows outcomes, not process: each assistant turn's tool steps fold into one expandable "N steps" line (safety
  gate refusals stay visible; the fold opens when a turn ends without a reply), and only the turn's last text shows.
  The system prompt asks for at most 3 plain sentences, says "automation" instead of workflow/node/ids, and requires
  a confirmation before publishing, running a writing automation or a registered action. Questions with a few obvious
  answers end in `Options: A | B`, rendered as one-tap chips on the latest reply (D19). Why: owners are not
  technical and were reading every tool call and narration line; confirmations were free-text only.
- Faster onboarding: "Log in with OpenRouter" (OAuth PKCE, returns a user-owned key, default model
  `openrouter/auto`) and one-click local Ollama (no key, first installed model) are the default LLM choices; the
  API-key form moved behind "Use an API key instead". The n8n field accepts a bare Cloud name (`acme` ⇒
  `acme.app.n8n.cloud`) or any pasted editor link. Why: users had to find an instance URL and create an API key
  before seeing anything; now it is a name plus two logins. CSP `connect-src` allows `http://localhost:*` for Ollama.
- Guided setup replaces the empty dashboard: after install the app shows connectors (Google Sheets, Shopify,
  WooCommerce, Airtable, Stripe, Postgres) with connected status, AI ideas for the connected services, a three-step
  progress list and the chat inline. Tabs and dashboard unlock once stock or sales rows exist and one Invenstory
  automation is active (remembered per device, cleared on disconnect). Why: a dashboard of zeros told new users
  nothing; setup is a conversation, so it lives next to the chat.
- Onboarding step 3 ("Install into n8n") is gone: setup runs automatically once n8n and a model are connected,
  showing only "Setting things up…" or a retry. Why: the audience should not need to know about tables and workflows.
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
8. **Chat autoscroll "didn't fire"** (issue #2). Cause found by inspection, not live repro: `scrollIntoView` aligned the
   end sentinel to the viewport bottom, which sits under the fixed composer and tab bar, so the newest message was hidden.
   Fix: `scroll-margin-bottom` on the sentinel = tab bar + measured composer height. That fixed the overlap, but a
   desktop-browser check of the real component missed #9: the hidden browser pane fires no scroll events (no frames), so
   scroll timing was never exercised. Check scrolling in the iOS Simulator or a visible pane with real frames.
9. **Chat stopped following mid-stream** (issue #2, found by the owner on a phone). Two causes, both reproduced in iOS
   WebKit: `scrollIntoView` overshoots and corrects about 47px per call, and browsers deliver the scroll event a frame
   late, after the next chunk has grown the page, so "not at the bottom" was read as the reader scrolling up and
   `pinned` went false for good. Fix: `toBottom` scrolls to a computed position with `scrollTo`, and `nextPinned`
   (`lib/scroll.ts`) lets only an upward scrollY move unpin. Verified in the simulator: the gap above the composer stays
   constant over a 150-chunk stream, a finger swipe unpins, and "Jump to latest" re-pins.
