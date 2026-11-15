# Status and hand-off (v1.0.0-rc.1, 2026-11-15)

## Where we are
All eight phases of docs/PLAN.md are implemented on branch `invenstory`. `bun run release` is green (63 tests).
Core install, data-plane API, dashboard, chat (incl. building and running real Google Sheets workflows) and the
safety gate have been exercised against the team's n8n Cloud instance. See docs/TESTING.md §3 for evidence.

**Release candidate, not final:** the items in TESTING.md §4 (analysis run, push, second device, OpenAI-compatible
provider, production deploy, live gate refusal, last two fixes) still need a live pass. Tag `v1.0.0` after they pass.

## Known issues and limitations
| # | Issue | Impact | Suggested fix |
|---|---|---|---|
| 1 | Install lives in the logged-in user's **personal** project | A teammate with a different n8n user gets separate tables | Let the installer pick a project (`search_projects` → team project), store `projectId` choice |
| 2 | Hourly syncs run even without changes; the dashboard costs one execution per refresh | Execution quota on n8n Cloud | Longer schedule, app triggers (Sheets trigger), or MCP row reads for the dashboard |
| 3 | Sheets sync maps a blank reorder point to 0 | No low-stock flag until 0 | Ask chat to map blanks to empty (null) |
| 4 | Ingest does not call analysis yet (the sync automations were built before analysis existed; it now installs itself with an OpenRouter login) | No automatic insights | After analysis setup, ask chat to call `invenstory-analyze` **only when rows changed** |
| 5 | `inv_sales` is insert-only | Deleting a sale in the Sheet doesn't remove it in Invenstory | Cleanup workflow (chat can build one) or a reconcile step |
| 6 | Chat persistence is fire-and-forget; a failed save shows an error but the row is lost | `repairHistory` covers tool calls; a lost text message is just missing | Retry queue in `chat.persist` |
| 7 | `scripts/n8n.ts` not yet run with a real MCP access token | Terminal tool unproven past auth | First teammate run: `bun run n8n state` |
| 8 | MCP proxy host allowlist defaults to `*.app.n8n.cloud` | Self-hosted n8n needs config | Set `N8N_ALLOWED_HOSTS`; later a UI switch for direct mode |
| 9 | Long chat sessions resend the full history (SDK reference about 110 KB) | Cost/latency, mitigated by prompt caching | Start new sessions; later compaction or message threads |
| 10 | Leftovers in n8n: `spike_push` table, redundant "Stock sheet update runner" draft, two one-off drafts, 2 `size-test` message rows | Clutter only | Delete/archive in the n8n UI |

## Next steps (suggested order)
1. Finish TESTING.md §4 (team lead: analysis + push; teammate: second-device + OpenAI-compatible provider).
2. Fix issue 1 (shared team project) so both teammates see the same data.
3. Deploy to Cloudflare Pages, install the PWA on a phone, test push with the app closed.
4. Quick-entry box on Overview ("sold 2 mugs") that runs the registered action without a full chat turn.
5. Deferred features from the plan: ElevenLabs realtime voice (STT + streaming TTS around the same agent loop,
   so the gate stays in charge; verify browser CORS for ElevenLabs first), and the PCA / dimensionality-reduction
   exploration view.

## Hand-off notes for the next person (and their Claude)
- Read `CLAUDE.md` first; it lists the hard rules (gate, secrets, core versioning, byte-identical history).
- The live instance is shared: be careful with anything that writes or deletes in n8n, and keep MCP calls few.
- Ask the team lead for an n8n user on the instance, then create your own MCP access token for `scripts/n8n.ts`.
- When something breaks in the app, the red error text is the best bug report; three real bugs were found that way
  (CHANGELOG incident log).
- Deleting chats (with a yes/no confirmation) is wanted but not built; "New chat" only resets the screen. What it
  needs is written up in [notes/clear-chat-history.md](notes/clear-chat-history.md).
