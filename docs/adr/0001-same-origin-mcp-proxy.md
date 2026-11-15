# D1. Same-origin MCP proxy instead of browser-direct MCP (departs from plan)

- **Decision:** The browser sends MCP calls to `/mcp` on its own origin; a stateless Pages Function (`functions/mcp.ts`)
  forwards them to `<instance>/mcp-server/http`.
- **Why:** Phase 0 check 2 failed. n8n Cloud 2.47.7 sends no CORS headers on the MCP endpoint, and there is no
  setting for it. The plan's "CORS allowances from 2.36" assumption was wrong for Cloud. The team lead chose this
  option over routing MCP through an n8n webhook relay. A relay would have dropped the OAuth login and given anyone with
  the secret URL full control of n8n, bypassing the gate.
- **Cost:** "static files only" became "static files + one stateless function"; the bearer token transits our function.
