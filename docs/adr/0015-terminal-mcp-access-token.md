# D15. Terminal access via MCP access token (`scripts/n8n.ts`)

- **Why:** The Phase 0 relay (gitignored `spike/`) only works through the team lead's logged-in browser. Teammates
  and their Claude sessions need a reproducible way to inspect and validate against n8n; n8n's MCP accepts bearer
  access tokens, and outside the browser there is no CORS problem.
