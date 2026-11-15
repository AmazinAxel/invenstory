# D12. Back off on MCP rate limits; execution checks wait server-side (added after live testing)

- **Why:** n8n Cloud returned 429 "Too many requests" while the agent polled executions. Retrying with backoff in
  the client, and making `n8n_get_execution` wait for completion inside one tool call, cut call volume and turn a
  confusing empty result into a clear message.
