# D19. Confirmation chips via a text convention

- **Decision:** The assistant offers one-tap answers by ending its message with `Options: A | B` (2–4 options, each
  ≤ 40 chars). The chat strips that line and renders chips on the latest assistant message only; a tap sends the
  option text as a normal user message. Before changing the owner's systems or data it stops and asks this way.
- **Why:** An `ask_owner` tool would give structured options but needs a pending tool call across reloads, new
  `repairHistory` cases and both LLM adapters. Plain text replays byte-identically and falls back to readable text
  when malformed. Revisit only if models ignore the convention. Every stored message keeps its `Options:` line, so
  switching later must still parse old ones.
