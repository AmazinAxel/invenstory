# D11. Run registered actions through `item.run` (added after live testing)

- **Decision:** New tool `invenstory_run_action` writes a one-off action item and calls `POST item.run`.
- **Why:** MCP's `execute_workflow` can't pass inputs to an Execute Workflow Trigger. The agent had improvised a
  "runner" workflow to work around it. Reusing `item.run` means the same registry check and logging as a tap on an
  action item, and no new core surface.
