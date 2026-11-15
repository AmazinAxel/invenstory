# D21. "New chat" is a client-side reset

- **Decision:** The Chat view's "New chat" clears the on-screen conversation and drops the session id. The next send
  creates a fresh session through the existing lazy path. `shouldAdopt` (chat-history) keeps the dashboard summary's
  older session hidden until a session created after the reset exists (the new chat, or a new analysis).
- **Why:** The summary already returns only the newest session with messages and rows are append-only, so a reset
  needs no n8n change, schema change or `CORE_VERSION` bump, and writes no empty sessions. Cost: earlier chats stay in
  n8n but cannot be reopened, and reloading before sending shows the old chat again. A session list would need a
  summary change and is out of scope.
