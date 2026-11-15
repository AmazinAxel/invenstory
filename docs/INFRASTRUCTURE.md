# Infrastructure, accounts and where things live

Snapshot as of 2026-11-15. **No secrets are in this repository.** Secrets live in the places named below.

## Services in use

| Service | Used for | Account / owner | Why this one | Secrets & where they live |
|---|---|---|---|---|
| **n8n Cloud** (`arshyi.app.n8n.cloud`, n8n 2.47.7, MCP server 1.2.0) | The whole backend: data tables, core workflows, agent-built workflows, analysis, push sending | Team lead's n8n Cloud account (paid plan), personal project `eIjkxF4cxDkfQGZs` | Plan decision: the user's own n8n is the backend; Cloud for dev/test because instance-level MCP + OAuth works without hosting anything | OAuth tokens: browser IndexedDB per device. VAPID private key: inside the `Sign Push` Code node of `invenstory-notify`. Webhook secret path: the `invenstory-api` webhook nodes. Credentials (Google, LLM): n8n's credential store |
| **Anthropic Claude API** | The in-app chat agent (browser → `api.anthropic.com`) | Team lead's Anthropic API key | Default provider; model `claude-opus-5-5`, effort `high` | API key in browser IndexedDB (`llm`) on the device that entered it. Never sent to n8n or our proxy |
| **Google Sheets** (via n8n credential "Google Sheets account", type `googleSheetsOAuth2Api`, id `bRkF84kUPp4scq2N`) | Source of truth for stock/sales in the current test setup | Team lead's Google account, authorised inside n8n | The first connector the owner chose in onboarding | OAuth tokens inside n8n only |
| **Web Push services** (FCM for Chrome/Edge/Android; Apple's service for installed iOS PWAs; Mozilla autopush) | Delivering "something changed" signals | None (browser-provided) | Standard Web Push; payload-less | VAPID keys generated in the browser at install; public key in `inv_config`, private key in notify |
| **Cloudflare Pages** (planned, not deployed) | Hosting `dist/` + the `/mcp` proxy function | Not created yet | Static host with functions on the same origin, fits "static + one stateless function" | Optional env `N8N_ALLOWED_HOSTS` only |
| **GitHub Actions** (`.github/workflows/ci.yml`) | `bun run release` on push/PR | Repo owner, once a remote exists | Keeps check/test/build green for both teammates | none |

### n8n instance settings that matter
- Settings → **Instance-level MCP: enabled**, "Allowed callback URLs: All" (dynamic client registration accepts
  `http://localhost:5173/` and the future production origin).
- `/mcp-server/http` has **no CORS** and no setting for it ⇒ the `/mcp` proxy exists. Login endpoints do have CORS.
- MCP is **rate-limited** (HTTP 429 `{"message":"Too many requests"}`); the client retries with backoff.
- Execution budget: each dashboard refresh is one `invenstory-api` execution; the two hourly Sheets syncs are about 1,440
  executions/month. Check the plan's quota.

### Registered OAuth clients in n8n (dynamic registration)
- `Invenstory spike` (redirect `http://localhost:8787/`): Phase 0 only, can be revoked.
- `Invenstory` (redirect `http://localhost:5173/`): the dev app. Each new app origin (production, teammate's port)
  registers its own client on first login.

## Live n8n object inventory

### Data tables (project `eIjkxF4cxDkfQGZs`)
| Table | id |
|---|---|
| inv_products | `yQseEcDsOL2XV8TJ` |
| inv_sales | `Il4e93KDm4DKb8A3` |
| inv_sessions | `VKfUiSlBAKTlpxzf` |
| inv_messages | `roV2yCu6dNdnvWut` |
| inv_action_items | `BOMI89W7iSqFLGzC` |
| inv_actions | `FMwilZKCAvQBnbpj` |
| inv_push_subscriptions | `A8mcJbN6UptcOAev` |
| inv_events | `7pzDcHGXCmB6uYLJ` |
| inv_config | `lJ52vGDPkH4SU7VQ` (core version 2, base currency USD) |
| spike_push | `h6rhAdL9UWqTBlEm`: Phase 0 leftover, **delete in the n8n UI** |

### Core workflows (managed by the app; do not edit by hand, see DEVELOPMENT.md)
| Workflow | id | State |
|---|---|---|
| invenstory-api | `vTMTKFtVi8WYqPzi` | active; allowed origin `http://localhost:5173` |
| invenstory-notify | `dyxKYigRmmdoG1pY` | active, core v2 |
| invenstory-error | `pEytbdBqf24n5o5G` | active |
| invenstory-analyze | not installed | installs itself on the next app start when the app is connected through OpenRouter; otherwise needs an LLM credential in n8n, then Automations → Set up analysis |

### Agent-built workflows (created through chat)
| Workflow | id | State |
|---|---|---|
| Invenstory · Sheets products sync | `CgATjU6sOdusvjNK` | active, hourly at :05, upserts `inv_products` by sku |
| Invenstory · Sheets sales sync | `uG1yGhrEGfrHrqVz` | active, hourly at :10, inserts new sale_ids into `inv_sales` |
| Invenstory · Update stock sheet | `K292V8pbTerd5ytC` | active, registered action (writes the Sheet) |
| Invenstory · Create starter sheet | `Y769XLyr5aiFDxCu` | draft, one-off, can be archived |
| Invenstory · Remove sample data | `OA19FIF994k11kpD` | draft, one-off, can be archived |
| Invenstory · Stock sheet update runner | (search "runner") | draft, **redundant** since `invenstory_run_action`; archive it |
| spike-api, spike-sub | `nEybNX5Hl7imaQ8I`, `L9WroM7RHDgBvd1J` | archived (Phase 0) |

Google Sheet "Invenstory stock" (created by the agent): id `1Q8trJEIyQRvxYzDjmJhDevDeZlcu2zID2ILU2LwmJ-I`, tabs Products
and Sales. Share it with a teammate in Google Drive if they need to edit it.

### Data state
- `inv_products`: MUG-02 (from the Sheet). Sample data was removed by the cleanup workflow.
- `inv_sales`: `S1` (example row typed by hand; confirm whether it was real) and `S-20261114-212527` (recorded by
  chat). Both MUG-02 × 2, $30.
- `inv_messages`: 2 rows with `session_id = size-test` (storage-size test, harmless; filtered by session).

## Local development machine (team lead)
- Windows + **WSL2** (Linux 6.18), repo at `~/LOOP`; the Windows browser reaches WSL's `localhost`.
- bun 1.4.4 at `~/.bun/bin` (installed from the official release zip because `unzip` was missing).
- No Linux `node`; Windows `node.exe` exists but is not used by the build. Python 3.14 only for the Phase 0 spike.
- `spike/` (gitignored, local only): Phase 0 page + Python relay (`spike/server.py` on :8787) that let the terminal run
  MCP calls through the logged-in browser. Superseded by `scripts/n8n.ts` with an MCP access token.

## Teammate onboarding (sharing one n8n)
1. Get a login to the same n8n Cloud instance (n8n user invite) or use your own instance (the installer creates
   everything fresh there).
2. `bun install && bun run dev`, open `http://localhost:5173`, log in with **your** n8n user, add **your** LLM key, Install.
   On a shared instance the installer finds the existing install and reuses it; it only adds your origin if it differs.
   Note: data tables are per project. A teammate whose personal project differs gets their own tables unless the install
   lives in a shared team project (current install is in the team lead's personal project).
3. For terminal checks: create an MCP access token in n8n (Settings → Instance-level MCP), export `N8N_BASE` and
   `N8N_MCP_TOKEN`, run `bun run n8n state`.

## Accepted risks (from the plan)
- Anyone holding the secret webhook URL can read business data and chat history and trigger registered runs.
- Secrets sit unencrypted in browser storage.
- With an OpenRouter login, the owner's OpenRouter key is also stored in plain text inside the `Analyst` node of
  `invenstory-analyze` in their n8n (so analysis runs while the app is closed). Anyone who can open that workflow, its
  history or an archived copy can read it, and it passes once through the `/mcp` proxy at setup. Owner's decision, to
  be stated in the terms. Rotate by revoking the key at OpenRouter, logging in again and using "Set up again".
- The MCP bearer token transits the `/mcp` proxy (whoever operates the deployment could read it).
- Gate node lists need upkeep; unlisted connectors are refused until added.
- n8n workflow building via MCP is preview-grade; iPhone push requires the PWA installed to the Home Screen.
- n8n data tables have a size cap; large sales histories will need pruning or aggregation later.
