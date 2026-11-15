# Design decisions and why

Each decision is one file in [docs/adr/](adr/): what was decided, why, and whether it follows or departs from
docs/PLAN.md. This list is the index, newest last. When you change a decision, add a new ADR instead of editing
history, so the reasoning stays traceable.

To add one: create `docs/adr/NNNN-short-slug.md` with the next number and the heading `# D<N>. <title>`, then add
the same title as a line below. `test/adr.test.ts` fails the release if the index and the files disagree.

- [D1. Same-origin MCP proxy instead of browser-direct MCP (departs from plan)](adr/0001-same-origin-mcp-proxy.md)
- [D2. OAuth stays browser-direct](adr/0002-browser-direct-oauth.md)
- [D3. No `@modelcontextprotocol/sdk` (departs from plan)](adr/0003-no-mcp-sdk.md)
- [D4. Raw `fetch` for both LLM adapters](adr/0004-raw-fetch-llm-adapters.md)
- [D5. Core workflows generated from typed specs, Code-node logic shared with tests](adr/0005-core-workflows-from-typed-specs.md)
- [D6. Append-only config and action registry](adr/0006-append-only-config-and-registry.md)
- [D7. Versioned in-place upgrades of core workflows](adr/0007-in-place-core-upgrades.md)
- [D8. Default-deny gate with node-class policy](adr/0008-default-deny-gate.md)
- [D9. Agent-built workflows are prefixed and the only ones the agent may change or run](adr/0009-prefixed-agent-workflows.md)
- [D10. Dashboard snapshot attached to each chat message](adr/0010-dashboard-snapshot-in-messages.md)
- [D11. Run registered actions through `item.run` (added after live testing)](adr/0011-run-actions-through-item-run.md)
- [D12. Back off on MCP rate limits; execution checks wait server-side (added after live testing)](adr/0012-mcp-rate-limit-backoff.md)
- [D13. Deterministic history repair (added after live testing)](adr/0013-deterministic-history-repair.md)
- [D14. `drop_block` thinking binding (added after live testing)](adr/0014-drop-block-thinking-binding.md)
- [D15. Terminal access via MCP access token (`scripts/n8n.ts`)](adr/0015-terminal-mcp-access-token.md)
- [D16. Release candidate, not 1.0.0](adr/0016-release-candidate.md)
- [D17. Login-first LLM onboarding (OpenRouter OAuth, local Ollama)](adr/0017-login-first-llm-onboarding.md)
- [D18. Dashboard locked behind guided setup](adr/0018-dashboard-locked-behind-setup.md)
- [D19. Confirmation chips via a text convention](adr/0019-confirmation-chips-text-convention.md)
- [D20. Switch AI provider from the Automations tab](adr/0020-switch-provider-in-automations.md)
- [D21. "New chat" is a client-side reset](adr/0021-new-chat-client-side-reset.md)
- [D22. Voice mode wraps the browser agent (ElevenLabs, key per device)](adr/0022-voice-wrapper-around-browser-agent.md)
- [D23. Analysis runs on the owner's OpenRouter login (key stored in the n8n workflow)](adr/0023-analysis-on-openrouter-login.md)
