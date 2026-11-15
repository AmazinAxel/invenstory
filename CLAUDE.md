# CLAUDE.md: working on Invenstory

Read this first, then the doc that matches the task (README lists them). Keep this file short and true;
update it when a rule here changes.

## What this is
A static Svelte 5 PWA + one stateless Cloudflare Pages Function (`functions/mcp.ts`). The user's n8n instance is the
only backend and the only store. The browser talks to: n8n MCP (control plane, via the same-origin `/mcp` proxy),
the secret-path `invenstory-api` webhook (data plane), and the LLM provider (chat agent). Details: docs/ARCHITECTURE.md.

## Commands
- `export PATH=$HOME/.bun/bin:$PATH` (bun 1.4.4 lives in ~/.bun on the original dev machine; there is no Linux `node`,
  so package scripts run tools with `bun --bun`).
- `bun run release` = check + test + build. Run it before every commit.
- `bun test test/<file>` for one suite. Tests never touch the network.
- `bun run n8n state` inspects the live n8n (needs `N8N_BASE` + `N8N_MCP_TOKEN`, see scripts/n8n.ts). Be frugal:
  n8n Cloud rate-limits MCP (HTTP 429). Never loop or poll against it.

## Hard rules
- **Safety gate is a product guarantee.** Workflows built by the LLM must never send messages/emails. Any change to
  `src/lib/n8n/policy.ts` or `gate.ts` needs tests in `test/gate.test.ts`, default-deny stays.
- **Never put secrets in the repo**: no API keys, MCP tokens, the webhook secret path (`inv-<hex>`), VAPID private keys.
  The secret path is readable from the installed `invenstory-api` workflow when needed (`apiDetails()`).
- **Core workflows are generated from code** (`src/lib/n8n/core/`). Changing a template means: bump `CORE_VERSION`
  in `core/schema.ts` and add an in-place step to `upgradeCore()` in `install.ts` (keep workflow ids and VAPID keys).
  Validate generated SDK code against n8n before shipping (see docs/DEVELOPMENT.md).
- **Code-node JavaScript** lives as strings in `core/code.ts` defining `function run(input)` with no outside references,
  so `test/core.test.ts` runs the exact source n8n runs. Keep it ES5-ish and self-contained.
- **Chat history must replay byte-identically** (Claude preserved thinking). Data is append-only in n8n; do not
  rewrite stored messages. Repairs must be deterministic (`repairHistory`). Requests send
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` so prompt/tool changes don't break old sessions.
- **LLM calls are plain `fetch`** (two adapters, `src/lib/llm/`). No SDKs: the plan forbids runtime deps beyond svelte.
  Claude defaults: `claude-opus-5-5`, API version `2026-10-21`, no temperature, `fallbacks: "default"`.
- n8n MCP has no row update/delete tools: `inv_config` and `inv_actions` are append-only (newest row wins).
  Row deletes need an n8n workflow with a Data table node.

## Recording changes
Every change gets a why: commit message body explains the reason; user-visible or architectural changes get a
CHANGELOG entry (with the reason) and, when a design choice is made or reversed, a new ADR: a file
`docs/adr/NNNN-slug.md` (next number, heading `# D<N>. <title>`) plus the same title as an index line in
docs/DECISIONS.md. `test/adr.test.ts` fails the release when the two disagree.
Bugs found in live testing go into the CHANGELOG incident log.

## Where things are
- `src/lib/n8n/` OAuth, MCP client, installer, data-plane API client, gate + policy, `core/` templates
- `src/lib/agent/` tool subset (all n8n access for the LLM), system prompt, loop
- `src/lib/llm/` adapters; `src/lib/sse.ts` shared SSE parser
- `src/state/` runes stores (app, dashboard, chat) + pure `chat-history.ts`
- `src/views/`, `src/ui/` Svelte components; `public/sw.js` service worker
- `scripts/n8n.ts` terminal access to n8n; `spike/` (gitignored) was Phase 0's throwaway browser relay

## Testing against live systems
Live n8n checks need either the app (browser login) or `scripts/n8n.ts` with an MCP access token. The LLM key lives
only in the user's browser, so Claude cannot call the LLM from the terminal: ask the user to run chat scenarios and
paste errors. docs/TESTING.md has the manual end-to-end script and what is already verified.

## Agent skills

### Issue tracker

GitHub Issues on AmazinAxel/invenstory via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` (created lazily) + `docs/adr/`, indexed by docs/DECISIONS.md. See `docs/agents/domain.md`.
