# D3. No `@modelcontextprotocol/sdk` (departs from plan)

- **Decision:** Hand-written OAuth + streamable-HTTP MCP client (`src/lib/n8n/oauth.ts`, `mcp.ts`).
- **Why:** The SDK's OAuth flow validates the protected resource against the server URL. Behind `/mcp` those differ,
  so it would need overrides. The hand-written version was already proven in Phase 0, and it keeps runtime
  dependencies at `svelte` only, which the plan wanted anyway.
