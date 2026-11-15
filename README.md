# Invenstory

Stock and sales tracking for small businesses, built **inside the owner's own n8n**.
A mobile-first PWA where an LLM builds n8n workflows for you (e.g. "my stock is in Google Sheets"),
n8n ingests and analyses the data, and a fixed dashboard shows KPIs, insights and one-tap action items.

- **No backend of ours, no accounts.** Static files plus one stateless proxy function (`functions/mcp.ts`).
- **n8n data tables are the only store.** The browser keeps only secrets and config.
- **Safety gate:** workflows the LLM builds can never send messages or emails; that is enforced in code, not by prompt.

Status: **v1.0.0-rc.1** (release candidate). See [docs/STATUS.md](docs/STATUS.md) for what is verified and what is not.

## What's done and what still needs work

**Done (v1.0.0-rc.1):** every phase of the plan is implemented, and these were exercised against a real n8n Cloud
instance:
- install of the 9 tables and core workflows, plus in-place upgrades
- the dashboard and its API
- chat: onboarding, building, testing and publishing Google Sheets sync workflows, running a registered action
- the safety gate on everything the agent builds

63 unit tests run in CI.

**Still to verify or improve:**
1. Live runs of analysis, push notifications (incl. a phone with the PWA installed), a second device or teammate,
   an OpenAI-compatible provider, and a production deploy on Cloudflare Pages.
2. Shared data for teammates: the install lives in one user's personal n8n project; it should be able to use a
   team project.
3. n8n execution budget: hourly syncs and dashboard reads count against the plan's quota.
4. A quick-entry box ("sold 2 mugs") so stock changes don't need a full chat turn.
5. Chat saves have no retry queue; very long sessions get expensive.
6. Planned later: ElevenLabs voice, PCA views.

Full list with impact and suggested fixes: [docs/STATUS.md](docs/STATUS.md).
The original plan is kept verbatim in [`ultrathink-we-re-trying-to-recursive-hoare.md`](ultrathink-we-re-trying-to-recursive-hoare.md);
[docs/PLAN.md](docs/PLAN.md) is the living copy with the Phase 0 results and re-plan notes.

## Quick start (development)

Requirements: [bun](https://bun.sh) 1.4.4, a Chromium-based or Firefox browser, an n8n instance (n8n Cloud 2.36+ with
instance-level MCP enabled) and an LLM API key (Claude or any OpenAI-compatible provider).

```bash
bun install
bun run dev            # http://localhost:5173 (the /mcp proxy runs inside the dev server)
```

In the app: **1** log in to n8n, **2** add the LLM key (tested with a short call), **3** Install. The installer creates
9 data tables and 4 core workflows in n8n, or reuses an existing install (second device, other teammate).

## Commands

| Command | What it does |
|---|---|
| `bun run dev` | Vite dev server with the `/mcp` proxy |
| `bun run check` | svelte-check + tsc (app, node/test/scripts, Pages functions) |
| `bun test test/` (`bun run test`) | 63 unit tests (gate, adapters, SSE, core Code-node JS, VAPID, drafts, markdown, agent loop) |
| `bun run build` | production build to `dist/` |
| `bun run release` | check + test + build (what CI runs) |
| `bun run n8n <cmd>` | terminal access to n8n via an MCP access token (see `scripts/n8n.ts`) |

## Documentation

| Doc | For |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works: channels, tables, core workflows, API contract, gate, agent, chat persistence, push |
| [docs/INFRASTRUCTURE.md](docs/INFRASTRUCTURE.md) | Every external service and account in use, why, where the secrets live, the live n8n object inventory |
| [docs/TESTING.md](docs/TESTING.md) | Unit tests, what was verified live and how, the manual end-to-end script |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Working on the code: conventions, how to change core workflows, gate policy, adapters; deploy |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why things are built the way they are (and where that departs from the plan) |
| [docs/STATUS.md](docs/STATUS.md) | Verified vs. unverified, known issues, next steps, hand-off notes |
| [docs/PLAN.md](docs/PLAN.md) | The original implementation plan and its re-plan notes |
| [CHANGELOG.md](CHANGELOG.md) | Releases and the incident log (bugs found in live testing and their root causes) |
| [CLAUDE.md](CLAUDE.md) | Orientation for Claude Code sessions working in this repo |
