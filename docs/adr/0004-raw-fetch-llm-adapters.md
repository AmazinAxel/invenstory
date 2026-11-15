# D4. Raw `fetch` for both LLM adapters

- **Why:** The plan fixed "plain fetch, no LLM SDKs" and two protocols (Claude native + OpenAI-compatible). Claude
  requests follow current API guidance: version `2026-10-21` (no sampling parameters), `claude-opus-5-5` default,
  explicit effort (Opus 5.5 defaults to medium), `eager_input_streaming` on tools with strict JSON parsing,
  server-side `fallbacks: "default"` for refusals, and thinking blocks replayed unchanged.
