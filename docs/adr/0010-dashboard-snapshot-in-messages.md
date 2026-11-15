# D10. Dashboard snapshot attached to each chat message

- **Why:** The agent must quote real figures without extra tool calls. Putting the snapshot in the user message,
  not the system prompt, keeps the system prompt stable for prompt caching. It's hidden in the UI and marked as data.
