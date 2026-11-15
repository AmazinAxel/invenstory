# Design decisions and why

Each entry: what was decided, why, and whether it follows or departs from docs/PLAN.md. Newest last. When you change
one of these, add an entry instead of editing history, so the reasoning stays traceable.

### D1. Same-origin MCP proxy instead of browser-direct MCP (departs from plan)
- **Decision:** The browser sends MCP calls to `/mcp` on its own origin; a stateless Pages Function (`functions/mcp.ts`)
  forwards them to `<instance>/mcp-server/http`.
- **Why:** Phase 0 check 2 failed. n8n Cloud 2.47.7 sends no CORS headers on the MCP endpoint, and there is no
  setting for it. The plan's "CORS allowances from 2.36" assumption was wrong for Cloud. The team lead chose this
  option over routing MCP through an n8n webhook relay. A relay would have dropped the OAuth login and given anyone with
  the secret URL full control of n8n, bypassing the gate.
- **Cost:** "static files only" became "static files + one stateless function"; the bearer token transits our function.

### D2. OAuth stays browser-direct
- **Why:** Phase 0 check 1 passed: discovery, dynamic client registration, PKCE and token exchange all have
  `Access-Control-Allow-Origin: *`. Keeping login direct means the proxy only ever sees MCP calls.

### D3. No `@modelcontextprotocol/sdk` (departs from plan)
- **Decision:** Hand-written OAuth + streamable-HTTP MCP client (`src/lib/n8n/oauth.ts`, `mcp.ts`).
- **Why:** The SDK's OAuth flow validates the protected resource against the server URL. Behind `/mcp` those differ,
  so it would need overrides. The hand-written version was already proven in Phase 0, and it keeps runtime
  dependencies at `svelte` only, which the plan wanted anyway.

### D4. Raw `fetch` for both LLM adapters
- **Why:** The plan fixed "plain fetch, no LLM SDKs" and two protocols (Claude native + OpenAI-compatible). Claude
  requests follow current API guidance: version `2026-10-21` (no sampling parameters), `claude-opus-5-5` default,
  explicit effort (Opus 5.5 defaults to medium), `eager_input_streaming` on tools with strict JSON parsing,
  server-side `fallbacks: "default"` for refusals, and thinking blocks replayed unchanged.

### D5. Core workflows generated from typed specs, Code-node logic shared with tests
- **Decision:** `core/sdk.ts` serialises plain objects to n8n Workflow SDK code; Code-node JavaScript lives as
  `function run(input)` strings in `core/code.ts`.
- **Why:** The plan wanted deterministic templates (no LLM). Escaping n8n expressions inside hand-written SDK code is
  error-prone, while JSON-serialised specs are not. Keeping the Code JS as strings means `bun test` runs exactly what n8n
  runs (summary maths, run checks, VAPID signing).

### D6. Append-only config and action registry
- **Decision:** `inv_config` and `inv_actions` never update rows; the newest row per key/workflow wins.
- **Why:** n8n MCP offers add and read but no update or delete for rows. Deletes that matter (unsubscribe, unregister)
  go through `invenstory-api`, which has Data table nodes.

### D7. Versioned in-place upgrades of core workflows
- **Decision:** `CORE_VERSION` + `upgradeCore()` patch installed workflows with `update_workflow`/`setNodeParameter`.
- **Why:** Recreating would change workflow ids (referenced by other workflows and config) and would lose the VAPID
  private key that lives only in the notify Code node, which would break every push subscription. First used for v2
  (push endpoint dedupe).

### D8. Default-deny gate with node-class policy
- **Why:** The plan's hard rule: workflows never send messages. An allowlist with explicit classes (core, business
  write-OK-but-no-send, messaging read-only, GET-only HTTP, network-free Code, gated sub-workflows) fails safe when n8n
  adds nodes. The cost, an upkeep burden for new connectors, is an accepted risk.

### D9. Agent-built workflows are prefixed and the only ones the agent may change or run
- **Why:** It separates the owner's own n8n workflows and the core workflows from what the agent created, so the
  agent can't modify or trigger anything it didn't build. It also lets Automations list "your automations" by name.

### D10. Dashboard snapshot attached to each chat message
- **Why:** The agent must quote real figures without extra tool calls. Putting the snapshot in the user message,
  not the system prompt, keeps the system prompt stable for prompt caching. It's hidden in the UI and marked as data.

### D11. Run registered actions through `item.run` (added after live testing)
- **Decision:** New tool `invenstory_run_action` writes a one-off action item and calls `POST item.run`.
- **Why:** MCP's `execute_workflow` can't pass inputs to an Execute Workflow Trigger. The agent had improvised a
  "runner" workflow to work around it. Reusing `item.run` means the same registry check and logging as a tap on an
  action item, and no new core surface.

### D12. Back off on MCP rate limits; execution checks wait server-side (added after live testing)
- **Why:** n8n Cloud returned 429 "Too many requests" while the agent polled executions. Retrying with backoff in
  the client, and making `n8n_get_execution` wait for completion inside one tool call, cut call volume and turn a
  confusing empty result into a clear message.

### D13. Deterministic history repair (added after live testing)
- **Decision:** `repairHistory()` gives unanswered tool calls a fixed "interrupted" result on load and before send.
- **Why:** A reload or lost save mid-run left `tool_use` without `tool_result`, and every later Claude call in that
  session failed. Rewriting stored rows would break append-only storage and byte-identical replay; a deterministic
  in-memory repair keeps both.

### D14. `drop_block` thinking binding (added after live testing)
- **Decision:** Requests to Claude models with conversation-bound thinking send
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`).
- **Why:** Changing the system prompt or tool list in an app update invalidated the signatures of stored thinking
  blocks, and Claude rejected the whole conversation. Dropping mismatched blocks is the API's documented behaviour for
  this. The owner keeps their conversation; Claude loses only its hidden notes from before the update.

### D15. Terminal access via MCP access token (`scripts/n8n.ts`)
- **Why:** The Phase 0 relay (gitignored `spike/`) only works through the team lead's logged-in browser. Teammates
  and their Claude sessions need a reproducible way to inspect and validate against n8n; n8n's MCP accepts bearer
  access tokens, and outside the browser there is no CORS problem.

### D16. Release candidate, not 1.0.0
- **Why:** Analysis, push, second-device, OpenAI-compatible and production-deploy paths are implemented and unit
  tested, but not yet exercised live (docs/TESTING.md §4). The tag tracks evidence, not effort.

### D17. Login-first LLM onboarding (OpenRouter OAuth, local Ollama)
- **Decision:** The default LLM step is "Log in with OpenRouter" or "Use Ollama on this computer"; API keys for
  Claude/OpenAI-compatible providers stay available behind a link.
- **Why:** Anthropic and OpenAI offer no third-party OAuth for API access, so a key was the only path and the slowest
  onboarding step. OpenRouter's PKCE flow hands the browser a key the user owns and can revoke; Ollama needs none.
  "Log in with n8n account" without an instance name is not possible: each n8n instance is its own OAuth server and
  there is no central account directory, so the field accepts a bare Cloud name instead.

### D18. Dashboard locked behind guided setup
- **Decision:** Until there is stock/sales data and one active `Invenstory · ` workflow, the app shows a setup page
  (connectors, AI ideas, inline chat) instead of the tabs. Completion is stored per device (`setup.done`).
- **Why:** An empty dashboard gave new users nothing to do. Data plus a running automation is the first point where
  the dashboard has meaning; the check costs two MCP calls, run only on open, tab return and after chat runs.
