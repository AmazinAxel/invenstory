# D6. Append-only config and action registry

- **Decision:** `inv_config` and `inv_actions` never update rows; the newest row per key/workflow wins.
- **Why:** n8n MCP offers add and read but no update or delete for rows. Deletes that matter (unsubscribe, unregister)
  go through `invenstory-api`, which has Data table nodes.
