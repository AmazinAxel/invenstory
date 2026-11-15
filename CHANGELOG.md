# Changelog

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
