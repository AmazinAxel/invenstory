# Development guide

## Setup
```bash
curl -fsSL https://bun.sh/install | bash -s bun-v1.4.4    # or unpack the release zip into ~/.bun/bin
bun install
bun run dev                                              # http://localhost:5173
```
Use a fixed port: the n8n OAuth client is registered per origin, and `invenstory-api` only answers allowed origins
(the installer adds a new origin automatically when you press Install from it).

## Conventions
- **Svelte 5 runes** everywhere (`$state`, `$derived`, `$effect`, `$props`); stores are classes in `src/state/*.svelte.ts`.
  Pure logic that tests need goes in plain `.ts` files (e.g. `chat-history.ts`), because bun tests can't run runes.
- **Runtime dependencies: `svelte` only.** No UI, chart, PWA, MCP or LLM SDKs. Charts are hand-written SVG.
- TypeScript strict with `noUncheckedIndexedAccess`; import paths carry `.ts`.
- Untrusted text (LLM output, n8n data) is rendered through `Md.svelte` / text nodes only; never `{@html}`.
- Colours are CSS tokens in `src/app.css` (light + dark). Chart series colours were checked with the dataviz
  validator: `#0d9488` light, `#11a394` dark.
- Commits: one topic each, `bun run release` green, message explains why. Work on branches; `main` holds releases.

## How to …

### Change a core workflow (api / notify / error / analyze)
1. Edit the template in `src/lib/n8n/core/` (node specs are plain objects, serialised by `sdk.ts`; Code-node JS is
   in `code.ts` as `function run(input)` strings).
2. Add or adjust tests in `test/core.test.ts`.
3. Validate the generated code against a real n8n (`validate_workflow`, see TESTING.md). Validation warnings about
   `$json.x` usually mean a node's `output` sample is missing fields: fill it in.
4. Bump `CORE_VERSION` in `core/schema.ts` and add an **in-place** step to `upgradeCore()` in `install.ts`
   (`update_workflow` + `setNodeParameter`, then `publish_workflow`). Do not recreate workflows: ids are referenced
   elsewhere and notify holds the VAPID private key (`extractVapid` recovers it).
5. Run the installer against a test instance twice (fresh install + upgrade path).

### Change the safety gate
Edit `policy.ts` lists/regexes or `gate.ts` logic, extend `test/gate.test.ts`. Default-deny stays. New business
connector: add its type name (and `…Trigger`) to `BUSINESS_NODES`; check its send-like operations hit `SEND_VERB`.

### Add or change an agent tool
`src/lib/agent/tools.ts`: add `{ def, label, run }`. Anything that creates/changes/runs a workflow must go through
`owned()` and `gate()`/`gateOrThrow()`. Prefix n8n data with `UNTRUSTED`. Add a test with `fakeMcp` in
`test/agent.test.ts`. Mention the tool in `prompt.ts` if the model needs guidance. Changing tools or the prompt is
safe for existing sessions (old thinking blocks are dropped via `drop_block`).

### Add an LLM provider
OpenAI-compatible: add a preset to `OPENAI_PRESETS` in `openai.ts`. Anything else: a new adapter implementing `Llm`
(`turn(req, onEvent) → { parts, stop }`) plus conversion to/from neutral `Message`s, and tests with mocked fetch.

### Add an analysis credential type
`MODEL_CHOICES` in `core/analyze.ts` (credential type → chat-model node, version, parameter builder). Validate the
generated workflow against n8n with a dummy credential id.

### Change how analysis reaches the model
`core/analyze.ts` has two variants built from the same node lists (`sources`, `sinks`): `analyzeWorkflow` (n8n
credential) and `analyzeDirectWorkflow` (HTTP Request to OpenRouter with the owner's key, set up by
`src/state/analysis.svelte.ts`). Keep the credential variant's output byte-identical unless you also bump
`CORE_VERSION`. Validate the direct one with `bun run n8n validate analyze-direct` (placeholder key). Never put a real
key in a test, a fixture, a log or `inv_config`; `test/analysis.test.ts` checks the key appears once, in the header.

## Deploy (not done yet)
```bash
bun run release
bunx wrangler@4 pages deploy dist --project-name invenstory
```
- Cloudflare Pages serves `dist/` and runs `functions/mcp.ts` at `/mcp`. `_headers` sets the CSP.
- After the first deploy, open the production URL, log in (registers a new OAuth client) and press Install once:
  it adds the production origin to `invenstory-api`'s allowed origins.
- Self-hosted n8n: add its host to `N8N_ALLOWED_HOSTS` (Pages env var), or put CORS on its reverse proxy and use the
  direct mode of `Mcp` (not exposed in the UI yet).
- Other static hosts need an equivalent `/mcp` route (the handler is a plain `Request → Response` function).

## Gotchas learned the hard way
- n8n Cloud rate-limits MCP: batch reads, don't poll; the client retries 429 with backoff.
- MCP `get_data_table_rows` caps `limit` at 100 (use `readRows` to page).
- Webhook `allowedOrigins` controls CORS; two webhooks on the same path with different methods publish fine.
- Data table "get"/"update" nodes emit 0 items when nothing matches, and the chain stops. Use `alwaysOutputData`
  and filter placeholders (`real()`).
- n8n's Code sandbox allows `require('crypto')` but has no network; sending must be an HTTP Request node.
- Claude Opus 5.5 rejects disabled thinking (the n8n Anthropic node defaults to disabled: set `thinkingMode: adaptive`).
- Claude preserved thinking: history must replay unchanged; prompt/tool changes need `drop_block` (in place).
- `execute_workflow` (MCP) can't pass inputs to an Execute Workflow Trigger, so actions run via `item.run` on the API.
