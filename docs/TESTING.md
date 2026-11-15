# Testing

Three layers: **unit tests** (offline, run in CI), **live checks against n8n** (terminal or app), and the **manual
end-to-end script** (needs a person in the browser because the LLM key and OAuth login live there).

## 1. Unit tests: `bun test test/` (101 tests, about 1 s, no network)

| File | Covers |
|---|---|
| `test/gate.test.ts` | every node class of the safety gate, Code-network patterns, HTTP methods, sub-workflow recursion/cycles/missing targets, disabled nodes, refusal message |
| `test/agent.test.ts` | tool wrapper (prefix, error-workflow wiring, gate on create/publish, core/foreign workflows refused, action registration rules, input validation), agent loop (tool round trip, persistence order, invalid JSON, refusal stops tools), stored-history conversion, `repairHistory` |
| `test/llm.test.ts` | provider config builder (trim, preset label, key rules), Claude conversion (native blocks replayed in order, tool parts, fallback boundary rule), Claude streaming turn with headers/body (API version, browser header, betas, fallbacks, drop_block, effort, eager streaming, no temperature), OpenAI conversion and streamed tool-call accumulation, tool-input parsing |
| `test/core.test.ts` | the exact Code-node JavaScript n8n runs: SUMMARY (KPIs, currency exclusion, newest config, trend, top/slow, items, messages, placeholder rows), STOCK paging/search, NOTICE, PREPARE_RUN (only open registered run items), ANALYSIS_TARGET; VAPID signing verified with WebCrypto; endpoint dedupe; VAPID key recovery for upgrades; SDK serializer and api template contents |
| `test/mcp.test.ts` | MCP client 429 retry with Retry-After; non-JSON-RPC bodies become errors |
| `test/mcp-proxy.test.ts` | proxy host matching, target parsing, header allowlists both ways, method/target refusals |
| `test/sse.test.ts` | SSE parsing across chunk boundaries, CRLF, comments, trailing events |
| `test/voice.test.ts` | voice mode's pure parts: streamed sentence chunking (decimals/currency, abbreviations, long unpunctuated text, lists, code and tables skipped), markdown → speech, stop commands, PCM decode with odd-byte carry, float → 16-bit, LE base64, resampling, ElevenLabs transcription messages and error types, socket URL, HTTP error mapping, default speech model, speaker queue (one request at a time, one sentence ahead, stop, errors) with a fake sink, progress throttle, quick-answer prompt, voice hint hidden |
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
| `invenstory-analyze` direct variant (OpenRouter over HTTP): node configs and wiring validate | pass (validation only; one expected `HARDCODED_CREDENTIALS` warning) | 2026-11-15, n8n MCP `validate_workflow` with a placeholder key |
| Dashboard rendering, period switch, trend tooltip, stock search, action item tap/dismiss | pass | team lead in browser |
| Chat: onboarding interview, custom prompts, figures quoted from the snapshot | pass | team lead |
| Chat built "Create starter sheet", products sync, sales sync (gate passed, tested with pin data, run, published) | pass | inspected node by node in n8n |
| Chat cleanup workflow removed exactly the sample rows | pass | row check |
| Registered action "Update stock sheet" wrote the Sheet; hourly syncs imported sale + stock | pass | row check |
| 429 rate limit, unanswered tool calls, thinking-signature mismatch | found and fixed, see CHANGELOG incident log | |

## 4. Not verified yet (do these before calling it 1.0.0)
1. Chat after the `drop_block` fix (send any message in the existing session; expect no error).
2. `invenstory_run_action` from chat ("I sold 1 travel mug").
3. Analysis. With an OpenRouter login: open the app ⇒ Automations → Analysis shows "Setting up analysis…" and then
   "Analysis runs in n8n after data changes." without any step in n8n (a second device adopts the same workflow and
   creates nothing). With any other connection: add an LLM credential in n8n → Automations → Set up analysis. Then
   Run analysis now ⇒ new session with insight + action items; draft item opens the mail app; run item executes.
   Also check: an OpenRouter key without credits ⇒ a failure notification with the provider's message; asking the
   chat to "show me the invenstory-analyze workflow" ⇒ refused, and the key appears nowhere in the chat.
4. Push: Dashboard → "Turn on notifications" card (shown once) → run analysis with the app in the background ⇒ notification;
   with the app focused ⇒ silent refresh. Failure push: break a test workflow on purpose.
5. Second device / teammate: log in on another browser → Install reuses everything (same project) → same dashboard
   and chat.
6. OpenAI-compatible provider end to end (Gemini or OpenAI key).
7. Production: deploy to Cloudflare Pages (HTTPS), install the PWA on a phone, push with the app closed; confirm
   the CSP in `_headers` doesn't block anything.
8. Gate refusal live: ask chat "email my supplier when stock is low" ⇒ red refused row, alternative offered.
9. Voice mode end to end (section 6). Nothing of it has run against ElevenLabs with a real key or in a browser yet:
   only the pure parts are unit-tested, and only unauthenticated error shapes were observed (401 JSON on REST,
   `auth_error` message then close 1000 on the transcription socket).

## 5. Manual end-to-end script (person + browser)
1. `bun run dev`, open `http://localhost:5173`. Log in to n8n, add the LLM key (test reply shows), Install.
2. Overview: KPIs, trend (hover/arrow keys, "Show as table"), top sellers, stock search, activity list.
3. Chat: "My stock is in Google Sheets" → follow it (credential in n8n, sheet link) → workflows appear under
   Automations as "Invenstory · …" and in n8n.
4. Edit the Sheet, say "run both syncs now" → Overview updates after refresh/focus.
5. Ask for an emailing workflow → refused with reasons.
6. Automations → analysis setup → run → insight + items → tap a draft (mail app opens, item disappears).
7. Notifications on, background the tab, run analysis → notification arrives.
8. Tap "New chat", send a message ⇒ answer ignores old context; refocus the app ⇒ old chat does not return.
   Reload mid-chat → conversation reloads; sending again works (history repair).
9. On a phone, send a long prompt and watch the reply stream without touching the screen: it must keep following and
   "Jump to latest" must NOT appear. Then scroll up mid-stream: following stops and the button appears; tap it to resume.
   (Real frames matter: a hidden browser pane fires no scroll events, so check on a phone or the iOS Simulator.)
10. Automations → AI provider → Switch provider: enter a wrong key ⇒ red error and the old provider still shown; enter a
    Groq key (preset Groq) ⇒ "Saved", card shows "Groq · model"; next chat message uses it. Switch back to Claude.
Report any red error text verbatim; most bugs so far were found exactly that way.

## 6. Voice mode manual test (person + browser + ElevenLabs key)
Needs a real ElevenLabs API key with text-to-speech and speech-to-text access. Desktop: `bun run dev` on
`http://localhost:5173` (localhost counts as a secure context; the dev server does not apply `_headers`). Phone:
a deployed HTTPS preview (`bunx wrangler@4 pages deploy dist …`), which also checks the production headers. Keep
DevTools open (Console + Network/WS) and note anything red verbatim.

**Setup**
1. Without a key: Chat shows no mic button and no voice bar, and there is no Voice card anywhere (ordinary users are
   never asked for an ElevenLabs key). Open the app once with `?voice` in the address (`http://localhost:5173/?voice`)
   ⇒ a collapsed "Voice (optional)" card appears at the bottom of the Automations tab on this device (and under
   Settings while guided setup is open), and stays after a reload.
2. Automations → Voice → paste a wrong key → Connect ⇒ "ElevenLabs did not accept the voice key…". Nothing is saved.
3. Paste the real key → Connect ⇒ voice and speech-model selects fill, Flash v2.5 preselected if offered, credits
   "N of M used". Reload: still configured (IndexedDB `voice`). Check the key is not printed in the Console.
4. Test voice ⇒ the sample sentence plays once, without clicks or gaps. Change the voice ⇒ Test voice uses it.

**1. Push-to-talk**
5. Chat ⇒ mic button left of Send; voice bar "Hold the mic to talk…". First press ⇒ browser asks for the
   microphone; allow.
6. Hold, say "How many products are low on stock?", release ⇒ partial text appears while speaking; on release the
   user bubble shows exactly the transcript (no "[Voice mode…" text); the reply streams and is spoken, the first
   sentence starting before the text finishes. Ask a question whose answer has a price ⇒ amounts read correctly.
7. Reload ⇒ the spoken message replays normally; the hint stays hidden. In n8n `inv_messages`, that user row has
   the voice hint part between the snapshot part and the transcript; a typed message has none.
8. Tap (short press) the mic, speak, tap again ⇒ sent (click-to-start / click-to-stop). Keyboard: Tab to the mic,
   Enter to start, Enter to send.
9. While it speaks: tap Stop in the voice bar ⇒ silent at once, text keeps streaming, nothing more is spoken for
   that reply. Repeat with a tap on the mic. Press the composer's ✕ during a spoken run ⇒ run and audio stop.
10. Hold and release without speaking ⇒ nothing is sent. Start a hold then scroll the page (pointer cancel) ⇒
    nothing is sent.

**2. Hands-free**
11. Voice bar → Hands-free ⇒ "Listening. Just talk." Ask a question and pause ⇒ sent by itself after about a second
    of silence; reply spoken; the partial transcript stays empty while it speaks (it must never transcribe itself,
    test on speakers, not headphones); about half a second after the audio ends, listening resumes.
12. Tap the mic while it speaks or works ⇒ audio stops and the run stops (composer shows it stopped); listening
    continues. Tap the mic while just listening ⇒ hands-free off.
13. Leave hands-free on and silent for several minutes ⇒ it keeps working or reconnects by itself; if it gives up,
    the voice bar says why in plain words. Switch to another tab/app ⇒ the mic indicator goes off.

**3. Talk while it works**
14. Ask by voice for something with several tool calls ("Set up a sync for my Google Sheet") ⇒ short progress lines
    such as "Checking connected accounts." at most about every 6 s, never cutting a sentence off.
15. During that run say "How much revenue did I make this week?" ⇒ a "Quick answer … not saved" block appears under
    the chat and is spoken; after reload it is gone and n8n has no row for it.
16. During a run say "stop" ⇒ the run stops and audio goes quiet; nothing is sent as a message.

**Failures (typed chat must keep working in every case)**
17. Block the microphone in site settings ⇒ "Microphone access is blocked…". Turn Wi-Fi off and press the mic ⇒
    "Could not reach ElevenLabs…". Use a key without credits (or with speech-to-text disabled) ⇒ a plain message.
18. Remove (Automations → Voice) ⇒ mic button and voice bar disappear.
19. iPhone (installed PWA and Safari): repeat 5, 6, 9 and 11. Watch for: no sound until the first tap, quiet
    earpiece playback while hands-free keeps the mic open, the ring/silent switch muting WebAudio.

