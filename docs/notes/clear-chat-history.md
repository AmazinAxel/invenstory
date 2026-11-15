# Notes: deleting chats and chat history

Written 2026-11-15 for whoever picks this up. Nothing here is implemented; it records what the owner asked for, what
already exists, and what was found out about n8n while scoping it.

## What the owner asked for
- Chats stay by default: they are useful context for the assistant.
- An option (a button) to delete chats the owner no longer wants.
- Before anything is deleted, a second "are you sure?" step with **Yes** and **No** buttons. Only **Yes** deletes.

## What exists today: "New chat" (D21, in `main`)
`chat.newChat()` clears the screen and drops the session id; the next message starts a new session. It is a
client-side reset:
- Nothing is removed from n8n. Old sessions and messages stay in `inv_sessions` / `inv_messages`.
- There is no confirmation step (nothing is lost, so none is needed).
- Reloading before sending a message shows the old chat again.

So "New chat" covers "start over", not "delete". The gap is real deletion plus the confirmation.

## What deleting needs
1. **n8n's MCP server cannot delete rows.** It can add and read rows and manage tables and columns, nothing else
   (checked against the tool list of the live instance). A delete has to run inside a workflow, in a Data table node.
2. **Where that workflow can live:**
   - *A new operation on `invenstory-api`* (for example `chat.clear`). It is a core template change: `CORE_VERSION`
     goes up and `upgradeCore()` needs an in-place step that adds nodes and rewires the `Route Write` switch (the
     fallback output moves by one). The larger problem is access: that webhook is protected only by its secret path,
     so anyone holding the URL could wipe the history.
   - *A small helper workflow run over MCP* (Manual Trigger → Data table delete on `inv_messages` → delete on
     `inv_sessions`), created by the app the first time it is needed and started with `execute_workflow` in manual
     mode. It sits behind the owner's n8n login, needs no core version bump and no webhook. Creating a workflow over
     MCP, running it in manual mode, reading the execution and archiving it all work on the live instance (done on
     2026-11-15 for an unrelated check). This is the option to prefer.
3. **Naming.** Do not give the helper the `Invenstory · ` prefix: the chat agent may change and run only workflows
   with that prefix (`owned()` in `tools.ts`). If it is added to `WORKFLOWS`, the agent is also barred from reading it
   (`refuseCore`), and the system prompt's list of core workflows changes (allowed, see DEVELOPMENT.md).
4. **What to delete.** The chat has no session list, so deleting only the newest session would bring the previous one
   back on screen. Delete all rows of `inv_sessions` and `inv_messages`. Consequences to state in the confirmation:
   - Analysis insights are sessions too (`origin = analysis`); they disappear until the next analysis.
   - Open action items stay (`inv_action_items`). Their `session_id` then points at nothing; running one still appends
     an `action_result` message for that id, which is harmless.
   - It applies to every device, because the data lives in n8n.
5. **The delete-everything filter is not verified.** The Data table delete operation takes conditions; which condition
   n8n accepts as "all rows" still has to be read from `get_node_types` for `n8n-nodes-base.dataTable` and tried.
   Try it on a scratch table (the leftover `spike_push` table is expendable), never on the real tables.
6. **After the delete.** Reset the screen the same way `newChat()` does (reuse it, including `resetAt`), then
   `dashboard.refresh()`. Nothing is rewritten, so the "replay byte-identically" rule is not affected.
7. **Not removed by this:** n8n's own execution logs (they can contain message text until n8n prunes them) and
   whatever the model provider keeps.

## The confirmation
- Two buttons in the page, as asked ("Delete all chats?" → **Yes, delete** / **No**). Not `window.confirm`.
- Disabled while a reply is running (`chat.running`), like "New chat".
- Say what goes and that it cannot be undone. Announce the result for screen readers (`chat.notice` exists for this).

## If voice mode is merged
Voice listens to the chat through `chat.listen()`. A delete should also stop the audio and remove the quick answer
(`voice.off()` / `voice.dismissQuick()`), the same as "New chat" should.

## Tests to add
- The helper template (ids embedded, no credentials), in `test/core.test.ts`.
- The flow with a fake MCP: find or create the helper, run it, wait, reset the chat; and that a failed run leaves the
  chat untouched and shows the error.
- The agent cannot read, change or run the helper (`test/agent.test.ts`).
