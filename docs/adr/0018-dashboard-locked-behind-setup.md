# D18. Dashboard locked behind guided setup

- **Decision:** Until there is stock/sales data and one active `Invenstory · ` workflow, the app shows a setup page
  (connectors, AI ideas, inline chat) instead of the tabs. Completion is stored per device (`setup.done`).
- **Why:** An empty dashboard gave new users nothing to do. Data plus a running automation is the first point where
  the dashboard has meaning; the check costs two MCP calls, run only on open, tab return and after chat runs.
