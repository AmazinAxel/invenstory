# D9. Agent-built workflows are prefixed and the only ones the agent may change or run

- **Why:** It separates the owner's own n8n workflows and the core workflows from what the agent created, so the
  agent can't modify or trigger anything it didn't build. It also lets Automations list "your automations" by name.
