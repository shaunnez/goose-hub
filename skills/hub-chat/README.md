# hub-chat

The default assistant the user (Shaun) talks to inside the Goose Hub web UI. Interactive multi-turn skill, invoked once per round. Conversation history lives in the `chat_messages` table (M20). The orchestrator slice that drives the loop is `slices/chat-orchestrator/`.

Tool catalog: `core/chat-tools/registry.ts`. Read-only tools auto-run; mutating tools require human approval via the chat panel before execution.

Holdout discipline: this skill is **not** a holdout. It reads the event stream, prior decision summaries, and per-project context.
