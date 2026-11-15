# Testing

Three layers: **unit tests** (offline, run in CI), **live checks against n8n** (terminal or app), and the **manual
end-to-end script** (needs a person in the browser because the LLM key and OAuth login live there).

## 1. Unit tests: `bun test test/` (63 tests, about 1 s, no network)

| File | Covers |
|---|---|
| `test/gate.test.ts` | every node class of the safety gate, Code-network patterns, HTTP methods, sub-workflow recursion/cycles/missing targets, disabled nodes, refusal message |
| `test/agent.test.ts` | tool wrapper (prefix, error-workflow wiring, gate on create/publish, core/foreign workflows refused, action registration rules, input validation), agent loop (tool round trip, persistence order, invalid JSON, refusal stops tools), stored-history conversion, `repairHistory` |
| `test/llm.test.ts` | Claude conversion (native blocks replayed in order, tool parts, fallback boundary rule), Claude streaming turn with headers/body (API version, browser header, betas, fallbacks, drop_block, effort, eager streaming, no temperature), OpenAI conversion and streamed tool-call accumulation, tool-input parsing |
| `test/core.test.ts` | the exact Code-node JavaScript n8n runs: SUMMARY (KPIs, currency exclusion, newest config, trend, top/slow, items, messages, placeholder rows), STOCK paging/search, NOTICE, PREPARE_RUN (only open registered run items), ANALYSIS_TARGET; VAPID signing verified with WebCrypto; endpoint dedupe; VAPID key recovery for upgrades; SDK serializer and api template contents |
| `test/mcp.test.ts` | MCP client 429 retry with Retry-After; non-JSON-RPC bodies become errors |
| `test/mcp-proxy.test.ts` | proxy host matching, target parsing, header allowlists both ways, method/target refusals |
| `test/sse.test.ts` | SSE parsing across chunk boundaries, CRLF, comments, trailing events |
| `test/draft-md.test.ts` | mail/WhatsApp/SMS draft links, safe markdown (no HTML, safe links only), suggestion parsing |

`bun run check` adds svelte-check (a11y + types) and tsc for node/test/scripts and the Pages function.
`bun run release` = check + test + build; CI runs it.

When you change: the gate → extend `gate.test.ts`; a Code-node source → `core.test.ts`; an adapter → `llm.test.ts`
with a mocked `fetch`; the tool wrapper → `agent.test.ts` with the `fakeMcp` helper.

## 2. Live checks against n8n

**From the terminal** (`scripts/n8n.ts`, needs `N8N_BASE` + `N8N_MCP_TOKEN`):
```bash
bun run n8n state                    # install completeness, config, row counts, agent-built workflows
bun run n8n summary 30d              # the dashboard's summary call
bun run n8n call get_workflow_details '{"workflowId":"<id>"}'
bun run n8n install http://localhost:5173 USD   # idempotent; also applies core upgrades
```
Validating a core template after changing it (saves nothing in n8n):
```bash
bun run n8n validate api      # or notify | error | analyze
```
Keep live calls few: n8n Cloud rate-limits MCP (429). Never poll in a loop.

**Data-plane smoke test** (no MCP needed, uses the secret URL, so don't paste it anywhere public):
`curl "$API?view=summary&period=7d"`, `curl -X POST "$API" -H 'content-type: application/json' -d '{"op":"bogus"}'` → 400.

## 3. What has been verified live (n8n Cloud 2.47.7, Chrome on Windows)

| Area | Result | When / how |
|---|---|---|
| Phase 0 checks 1–7 | pass, except credential binding (no credential then) | 2026-11-14, spike page + relay (see docs/PLAN.md) |
| Browser OAuth from the app origin (DCR, PKCE, refresh) | pass | app login on :5173 |
| MCP via `/mcp` proxy (dev server) | pass | app + curl |
| Install: 9 tables, notify/error/api validated, created, published, error workflow wired | pass | `install()` through the relay |
| Re-run install is idempotent; in-place core upgrade v1 → v2 keeps ids and VAPID keys | pass | relay |
| API reads summary/stock/notice and every POST op incl. refusals | pass, numbers hand-checked | curl |
| `invenstory-analyze` SDK code validates for Anthropic/OpenAI/Gemini credentials | pass (validation only) | relay |
| Dashboard rendering, period switch, trend tooltip, stock search, action item tap/dismiss | pass | team lead in browser |
| Chat: onboarding interview, custom prompts, figures quoted from the snapshot | pass | team lead |
| Chat built "Create starter sheet", products sync, sales sync (gate passed, tested with pin data, run, published) | pass | inspected node by node in n8n |
| Chat cleanup workflow removed exactly the sample rows | pass | row check |
| Registered action "Update stock sheet" wrote the Sheet; hourly syncs imported sale + stock | pass | row check |
| 429 rate limit, unanswered tool calls, thinking-signature mismatch | found and fixed, see CHANGELOG incident log | |

## 4. Not verified yet (do these before calling it 1.0.0)
1. Chat after the `drop_block` fix (send any message in the existing session; expect no error).
2. `invenstory_run_action` from chat ("I sold 1 travel mug").
3. Analysis: add an LLM credential in n8n → Automations → Set up analysis → Run analysis now ⇒ new session with
   insight + action items; draft item opens the mail app; run item executes.
4. Push: Dashboard → "Turn on notifications" card (shown once) → run analysis with the app in the background ⇒ notification;
   with the app focused ⇒ silent refresh. Failure push: break a test workflow on purpose.
5. Second device / teammate: log in on another browser → Install reuses everything (same project) → same dashboard
   and chat.
6. OpenAI-compatible provider end to end (Gemini or OpenAI key).
7. Production: deploy to Cloudflare Pages (HTTPS), install the PWA on a phone, push with the app closed; confirm
   the CSP in `_headers` doesn't block anything.
8. Gate refusal live: ask chat "email my supplier when stock is low" ⇒ red refused row, alternative offered.

## 5. Manual end-to-end script (person + browser)
1. `bun run dev`, open `http://localhost:5173`. Log in to n8n, add the LLM key (test reply shows), Install.
2. Overview: KPIs, trend (hover/arrow keys, "Show as table"), top sellers, stock search, activity list.
3. Chat: "My stock is in Google Sheets" → follow it (credential in n8n, sheet link) → workflows appear under
   Automations as "Invenstory · …" and in n8n.
4. Edit the Sheet, say "run both syncs now" → Overview updates after refresh/focus.
5. Ask for an emailing workflow → refused with reasons.
6. Automations → analysis setup → run → insight + items → tap a draft (mail app opens, item disappears).
7. Notifications on, background the tab, run analysis → notification arrives.
8. Reload mid-chat → conversation reloads; sending again works (history repair).
9. On a phone, send a long prompt and watch the reply stream without touching the screen: it must keep following and
   "Jump to latest" must NOT appear. Then scroll up mid-stream: following stops and the button appears; tap it to resume.
   (Real frames matter: a hidden browser pane fires no scroll events, so check on a phone or the iOS Simulator.)
Report any red error text verbatim; most bugs so far were found exactly that way.
