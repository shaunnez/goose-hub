# chat-orchestrator

M20 — drives one turn of a conversation between the user and the `hub-chat` assistant skill.

## Contract

`runChatOrchestratorTurn({ conversation, history, runId })` →
`{ reply: HubChatOutput | null }`

- Reads the conversation history from `chat_messages` (passed in).
- Reads a slice of the event stream scoped to the conversation.
- Loads `CLAUDE.md` / `MISSION.md` / `CONTEXT.md` heads as `governanceDigest`.
- Builds the `availableTools` manifest from `core/chat-tools/registry.ts`.
- Invokes the `hub-chat` skill once via `invokeSkill`.
- Validates the structured output and drops proposals whose `toolName` is not registered.
- Returns the reply for the chat domain to persist.

## Non-goals

- This slice does NOT persist messages or tool invocations — that lives in the chat domain (`apps/server/src/domains/chat/service.ts`).
- It does NOT run tools. The chat service decides whether to auto-run (read-only) or park for approval (mutating).
- It is stateless across calls — the next user message triggers a fresh invocation.

## Files

- `workflow.ts` — entry point.
- `slice.test.ts` — round-trip with `invokeSkill` mocked.
- `README.md` — this file.
