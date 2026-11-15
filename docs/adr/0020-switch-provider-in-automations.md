# D20. Switch AI provider from the Automations tab

- **Decision:** The Automations tab has an "AI provider" card showing the current provider and model, with a
  "Switch provider" form (Claude key, or an OpenAI-compatible key + base URL + model, presets include Groq). It is the
  same form as onboarding, tests the connection first and keeps the old provider if the test fails.
- **Why:** #14/#19 removed "Change language model" from daily use, which left a bad or expired key unrecoverable short
  of clearing site data. Groq offers no OAuth for third-party apps, so an API key is the only way in; one form serves
  every key-based provider. Reverses that part of #14/#19 (notifications and "Disconnect n8n" stay out).
