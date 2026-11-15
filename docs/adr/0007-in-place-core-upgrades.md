# D7. Versioned in-place upgrades of core workflows

- **Decision:** `CORE_VERSION` + `upgradeCore()` patch installed workflows with `update_workflow`/`setNodeParameter`.
- **Why:** Recreating would change workflow ids (referenced by other workflows and config) and would lose the VAPID
  private key that lives only in the notify Code node, which would break every push subscription. First used for v2
  (push endpoint dedupe).
