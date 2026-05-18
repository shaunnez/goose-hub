# chat-tools

M20 — registry of tools the Hub Chat assistant (`skills/hub-chat`) may propose. Read-only tools auto-run; mutating tools require explicit human approval in the chat panel before the dispatcher executes them.

The registry here is *manifest-only*: name, description, mutating flag, Zod input schema. Implementations live next to the dispatcher in `apps/server/src/domains/chat/tools.ts` so they can talk to `StateSource`, the event store, and the inbox repository.

Adding a new tool:
1. Define an input Zod schema in `registry.ts` and append an entry to `CHAT_TOOL_REGISTRY`.
2. Add the implementation in `apps/server/src/domains/chat/tools.ts` and register it in `CHAT_TOOL_IMPLEMENTATIONS`.
3. The skill's structured output will start accepting proposals for the new tool automatically (the registry drives `ChatToolNameSchema`).
