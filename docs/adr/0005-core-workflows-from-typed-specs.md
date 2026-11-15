# D5. Core workflows generated from typed specs, Code-node logic shared with tests

- **Decision:** `core/sdk.ts` serialises plain objects to n8n Workflow SDK code; Code-node JavaScript lives as
  `function run(input)` strings in `core/code.ts`.
- **Why:** The plan wanted deterministic templates (no LLM). Escaping n8n expressions inside hand-written SDK code is
  error-prone, while JSON-serialised specs are not. Keeping the Code JS as strings means `bun test` runs exactly what n8n
  runs (summary maths, run checks, VAPID signing).
