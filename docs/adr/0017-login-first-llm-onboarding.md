# D17. Login-first LLM onboarding (OpenRouter OAuth, local Ollama)

- **Decision:** The default LLM step is "Log in with OpenRouter" or "Use Ollama on this computer"; API keys for
  Claude/OpenAI-compatible providers stay available behind a link.
- **Why:** Anthropic and OpenAI offer no third-party OAuth for API access, so a key was the only path and the slowest
  onboarding step. OpenRouter's PKCE flow hands the browser a key the user owns and can revoke; Ollama needs none.
  "Log in with n8n account" without an instance name is not possible: each n8n instance is its own OAuth server and
  there is no central account directory, so the field accepts a bare Cloud name instead.
