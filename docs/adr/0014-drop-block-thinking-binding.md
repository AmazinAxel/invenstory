# D14. `drop_block` thinking binding (added after live testing)

- **Decision:** Requests to Claude models with conversation-bound thinking send
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`).
- **Why:** Changing the system prompt or tool list in an app update invalidated the signatures of stored thinking
  blocks, and Claude rejected the whole conversation. Dropping mismatched blocks is the API's documented behaviour for
  this. The owner keeps their conversation; Claude loses only its hidden notes from before the update.
