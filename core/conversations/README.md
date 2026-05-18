# conversations

M20 — persistence layer for Hub Chat conversations. Three tables in the operational SQLite DB:

- `chat_conversations` — one row per chat thread. Carries scope (`global` / `project` / `item`), optional `projectId` / `workItemId`, the user-pickable `runtime` (claude or codex), and a derived `title`.
- `chat_messages` — append-only message log for the conversation. `role` is `user` or `agent`. Tool calls are NOT stored here — they flow through the `events` table tagged with `payload.conversationId` so SSE consumers can interleave them live.
- `chat_tool_invocations` — one row per proposed tool call. Read-only tools land directly in `running`/`completed`/`failed`; mutating tools start as `proposed` and wait for the human's approve/reject decision in the chat panel.

The repository is the only file in `core/` that writes to these tables. Callers in `apps/server/src/domains/chat/` re-export through `repository.ts` to keep the documented router → service → repository layering.
