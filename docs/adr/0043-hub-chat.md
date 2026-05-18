# ADR 0043 — Hub Chat assistant + chat-tool gating model

**Status:** Accepted
**Date:** 2026-05-18

## Context

Goose Hub's UI surfaces work-item state (kanban, detail), inbox capture, roster, costs, and settings. What it had no answer for was "I have a question / I want a thing done now" — operating the orchestrator from outside the work-item lifecycle. The existing `grill-me` skill is multi-turn but tightly bound to a single work item's PRD intake; it is not a general assistant.

We needed an agent the user can talk to from anywhere in the web UI: open-ended Q&A grounded in the event stream and project state, plus a way to take actions (invoke skills, transition issues, post comments, tick the orchestrator) without leaving the conversation.

## Decision

**Hub Chat** is a new interactive skill (`skills/hub-chat`) driven by a new orchestrator slice (`slices/chat-orchestrator`) and exposed through a new server domain (`apps/server/src/domains/chat`) and web feature (`apps/web/src/components/chat`).

Key resolutions:

### 1. Conversation persistence is operational, not GitHub-canonical

Chat conversations live in three new SQLite tables (`chat_conversations`, `chat_messages`, `chat_tool_invocations`). They do **not** participate in the work-item lifecycle and never become GitHub issues unless the agent explicitly proposes `create_inbox_note`.

Why: chat is ephemeral by nature; pushing every "what should I look at?" exchange to the source of truth would pollute it. The repository for work-item state stays GitHub Issues per FACTORY_RULES rule 14.

### 2. Tool calls are a separate stream from messages

Messages (user / agent text) live in `chat_messages`. Tool invocations live in `chat_tool_invocations`. Both are linked by `conversationId`; tool invocations optionally point at the agent message that proposed them via `messageId`.

Live tool-call lifecycle flows through the existing event stream as `chat.tool-proposed` / `-approved` / `-rejected` / `-running` / `-completed` / `-failed`, carrying `payload.conversationId` for client-side filtering. This reuses the SSE chokepoint (`core/event-stream/store.ts:appendEvent`) — no parallel notification path.

### 3. Two-tier tool approval

Each tool in `core/chat-tools/registry.ts` declares `mutating: boolean`:

- **Read-only tools** (`list_projects`, `get_issue`, `recent_events`, `what_needs_human_help`, …) auto-run on proposal. The dispatcher inserts the invocation in `running`, executes, and writes the result back. The agent sees results on the next turn via `toolResults` in its context.
- **Mutating tools** (`transition_issue`, `comment_on_issue`, `invoke_skill`, `tick_project`, `create_inbox_note`, `open_url`) insert as `proposed` and wait for explicit human approve/reject before execution.

This matches Mission rule 1 ("orchestrator decides; agents recommend; humans approve gates"). It also matches the spirit of `gate.awaiting-human` events even though chat doesn't go through the work-item state machine.

### 4. Idempotent approval via CAS

`transitionToolInvocationStatus({fromStatus, toStatus})` in `core/conversations/repository.ts` performs an atomic update guarded by the previous status. Two concurrent approve clicks cannot both pass the guard: whichever wins the CAS executes, the loser returns 409. Same mechanism prevents double-reject races.

### 5. Tool ownership check

`resolveProposal(conversationId, invocationId, decision)` verifies that the invocation belongs to the route's `conversationId` before any mutation. An invocation id leaked across conversations cannot be acted on from a different scope.

### 6. Runtime selection per conversation

The conversation row stores `runtime: 'claude' | 'codex'`. The orchestrator translates that into a `modelOverride` (`defaultModelForTierAndProvider('sonnet', provider)`) passed to `invokeSkill`. This bypasses the project-level `rolesModels` override that would otherwise pin the chosen role to its declared tier (e.g. `auditor` at opus). The auditor role is reused for chat because no existing role is a perfect fit; the model override keeps chat cheap at sonnet regardless of project config.

### 7. Tool registry is the contract

`core/chat-tools/registry.ts` is the single manifest the agent sees. The skill's structured output accepts arbitrary tool-name strings for forward-compat, but the orchestrator's `manifestHas` filter drops any proposal not in the registry before the dispatcher runs. Adding a new tool requires both a registry entry (`core/chat-tools/registry.ts`) and an implementation (`apps/server/src/domains/chat/tools.ts`).

### 8. Scope inferred from route, not stored on the user

Chat scope (`global` / `project` / `item`) is derived from the active URL by `resolveScopeFromPath` (`apps/web/src/components/chat/lib/scope.ts`) and threaded into the conversation row at creation. The agent's context includes `scope.kind`, `scope.projectSlug`, and `scope.workItemId` so it knows what "this project" or "this issue" refers to without the user repeating themselves.

### 9. No invoke_skill execution yet

`invoke_skill` is registered and approvable but the dispatcher returns a no-op. Spawning real skill runs from chat needs the agent-runtime composer (`invokeSkill`) to be threaded through the chat domain with proper budget, persona, and workspace handling — distinct from the orchestrator-driven workflow path. Filed as a follow-up.

## Consequences

**Positive:**
- Single new skill + slice + domain; reuses agent-runtime, event stream, SSE, drizzle, and the existing UI scaffolding.
- The tool registry doubles as the agent's discovery surface — the agent learns what's possible by reading the manifest in its context, not from prompt-engineered tool descriptions.
- Tool gating is a property of the tool, not the agent. Adding a mutating tool automatically gets the approval path.
- Chat conversations are not first-class artefacts in the work-item lifecycle, so retrospectives and persona stats stay focused on actual implementation runs.

**Negative:**
- The `auditor` role now has two callers (`code-quality-audit` and `hub-chat`). Retrospective analyses that group by role will mix them. Mitigated today by grouping by `skill` instead; revisit if it bites.
- Chat tool invocations write to the event stream, adding noise to the per-project event count. Filterable client-side, but raw replay queries will need to skip `chat.*` to compare apples to apples.
- The two-tier approval flow is implemented at the service layer, not as a generic policy engine. If we ever add a third tier (e.g. "always allow during business hours"), this becomes a refactor.

**Open questions:**
- Should chat runs count towards `agent_run_costs` and persona stats? Today they don't (the cost recorder is wired to `core/cost`, which the chat orchestrator bypasses). Probably yes once we decide on a persona model for the assistant role.
- Should there be a dedicated `assistant` role separate from `auditor`? Today no, because that requires touching `core/types.ts` + governance-locked `CLAUDE.md`. Revisit if role-mixing becomes a retro problem.

## Status

Accepted; lands in PR #837. Follow-up issues for `invoke_skill` execution, persona/cost integration, conversation-list UI, richer `find_pr` (GitHub API), and monitoring tools (`subscribe_to_run`, `subscribe_to_issue`).
