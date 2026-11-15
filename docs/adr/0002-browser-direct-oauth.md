# D2. OAuth stays browser-direct

- **Why:** Phase 0 check 1 passed: discovery, dynamic client registration, PKCE and token exchange all have
  `Access-Control-Allow-Origin: *`. Keeping login direct means the proxy only ever sees MCP calls.
