# chat

M20 — Hub Chat. A right-side slide-out drawer mounted at the AppShell level so the user (Shaun) can talk to a default agent from anywhere in the web UI.

## Structure

- `components/ChatDock.tsx` — top-level mount. Hosts the launcher button + panel.
- `components/ChatPanel.tsx` — the slide-out drawer with header, thread, and input.
- `components/ChatThread.tsx` — message + tool-invocation timeline.
- `components/MessageBubble.tsx` — user/agent message bubble.
- `components/ToolProposalCard.tsx` — approve/reject card for mutating tool proposals.
- `components/ChatInput.tsx` — textarea + send button.
- `components/ChatLauncher.tsx` — floating button bottom-right.
- `lib/scope.ts` — derives chat scope (`global` / `project` / `item`) from the current URL.
- `lib/useChatEvents.ts` — SSE subscription filtered to `chat.*` events for the active conversation.

## Conventions

- Right-side panel; opens via launcher button or persisted `hub-chat-open` localStorage flag.
- Scope is derived from the current route — global on `/settings`, project on `/projects/:slug`, item on `/projects/:slug/items/:id*`.
- Mutating tools (`invoke_skill`, `transition_issue`, `tick_project`, etc.) show an Approve / Reject card.
- Read-only tools (`list_projects`, `get_issue`, `recent_events`, etc.) auto-run; their results render inline as collapsible JSON.
- The user can switch runtime (claude / codex) per conversation.

## Server contract

`/chat/manifest`, `/chat/conversations`, `/chat/conversations/:id`, `/chat/conversations/:id/messages`, `/chat/conversations/:id/invocations/:invocationId` — see `apps/server/src/domains/chat/router.ts`.

Live tool-call progression streams through the standard SSE endpoint (`/events`) on chat.* event kinds.
