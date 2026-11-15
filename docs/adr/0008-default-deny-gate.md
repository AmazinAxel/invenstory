# D8. Default-deny gate with node-class policy

- **Why:** The plan's hard rule: workflows never send messages. An allowlist with explicit classes (core, business
  write-OK-but-no-send, messaging read-only, GET-only HTTP, network-free Code, gated sub-workflows) fails safe when n8n
  adds nodes. The cost, an upkeep burden for new connectors, is an accepted risk.
