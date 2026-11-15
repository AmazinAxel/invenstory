# D13. Deterministic history repair (added after live testing)

- **Decision:** `repairHistory()` gives unanswered tool calls a fixed "interrupted" result on load and before send.
- **Why:** A reload or lost save mid-run left `tool_use` without `tool_result`, and every later Claude call in that
  session failed. Rewriting stored rows would break append-only storage and byte-identical replay; a deterministic
  in-memory repair keeps both.
