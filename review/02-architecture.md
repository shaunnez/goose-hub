# Architecture

## Layer map

```
┌──────────────────────────── apps/ ────────────────────────────┐
│                                                               │
│   apps/web (React 19, Vite, Tailwind 4, React Router 6)       │
│      ├── components/board     Kanban (SSE → live patches)     │
│      ├── components/detail    Issue detail, tabs              │
│      ├── components/roster    Persona stats, playbooks        │
│      ├── components/settings  Project budgets, model router   │
│      └── lib/api/             Fetch wrappers (typed)          │
│                                                               │
│   apps/server (Hono, @hono/node-server)                       │
│      ├── domains/<slice>/     Routers, services, repositories │
│      └── shared/dispatch-*    Webhook label → workflow router │
│                                                               │
│   apps/cli (tsx-runnable)                                     │
│      └── commands/            goose status / sweep / run-agent│
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────── core/ ────────────────────────────┐
│                                                               │
│   agent-runtime/   invokeSkill() entry, claude-cli / codex-cli│
│                    runtimes, persona selection, budget math   │
│   event-stream/    Single-writer EventStore (SQLite + emitter)│
│   db/              Drizzle schema + better-sqlite3 connection │
│   orchestrator/    Smoke gate (6-check preflight)             │
│   projects/        Loader, per-project tick scheduler, locks  │
│   state-machine/   28-state graph, legal-targets table        │
│   state-source/    GitHub Issues adapter (labels ↔ WorkItem)  │
│   connectors/      GitHub PR ops, retry, timeout              │
│   tool-layer/      Sandbox, deny list, PreToolUse/Stop hooks  │
│   workflows/       Cross-cutting: bootstrap, grill+prd,       │
│                    decompose-prd, retro, cross-run-retro      │
│   cost/, persona/, retry/, findings/, retrospective/, etc.    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────── slices/ (vertical features, one folder each) ────────────┐
│                                                                      │
│   fix-issue, qa, review, retro, investigate, grill-and-prd,          │
│   decompose-prd, bootstrap-project, parallel-implement, ...          │
│                                                                      │
│   Each slice: workflow.ts + slice.test.ts + README.md (+ ui.tsx if   │
│   it ships UI). Slices may not import from other slices.             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────── skills/ (versioned agent capabilities) ────────────┐
│                                                                │
│   triage, investigate, implement, qa, review, retrospective-*, │
│   grill-me, write-prd, decompose-issues, scout-*, wave2-*, ... │
│                                                                │
│   Each skill: prompt.md + schema.ts + skill.config.ts          │
│              + slice.test.ts (+ README.md, eval/eval.json)     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Boundaries (the rules that actually matter)

1. **Slices import core through public interfaces only.** No reaching
   into another slice. Enforced by review, not lint.
2. **Skills are invoked only through `invokeSkill()`.** That function is
   the gate where context validation, persona selection, budget
   resolution, model selection, and output validation happen. See
   `core/agent-runtime/invoke-skill.ts:81`.
3. **One writer for `events` table.** Anything that wants to record
   something calls `eventStore.appendEvent()`. CI lints for direct
   `events` inserts.
4. **State labels live on issues, not PRs.** PR labels exist; they're
   decorative. Anything reading PR labels is wrong.
5. **Governance files are immutable from agent PRs.** `MISSION.md`,
   `FACTORY_RULES.md`, `CLAUDE.md`, project configs, personas. Only
   bootstrap-tagged PRs may create them.

## How a webhook becomes a merge

A `factory:dev-ready` label flip is the canonical entry. The chain:

```
GitHub Issues
   │  webhook (label changed)
   ▼
apps/server  webhooks/handler.ts
   │  verify signature, route by event type
   ▼
apps/server/shared/dispatch-routing.ts
   │  label → dispatchFn (factory:dev-ready → dispatchFixIssue)
   ▼
slices/fix-issue/workflow.ts
   │  acquire parallel lock → smoke gate → workspace prep
   ├──→ skills/investigate (if not already done)
   ├──→ (priority:high|critical) skills/advise-on-plan
   ├──→ skills/implement   (TDD-first, opens PR via connectors/github)
   ├──→ skills/evidence-post   (best-effort screenshots)
   └──→ source.transitionState(issue, factory:needs-qa)
   ▼
GitHub label flips to factory:needs-qa → webhook fires again →
   dispatchQa → slices/qa/workflow.ts → skills/qa (HOLDOUT)
   │  three-tier verification (lint, tests, e2e)
   ▼
factory:needs-review → dispatchReview → skills/review (HOLDOUT)
   │  diff vs issue ACs, per-criterion verdict
   ▼
factory:approved → human clicks Approve in web UI
   │
   ▼
apps/server merges PR via connectors/github → factory:retrospecting →
   slices/retro → factory:done.
```

Every step emits events to the event stream. The UI tails it over SSE
and patches React Query caches in place — no polling on the board.

## What lives where (quick lookup)

| Need to … | Open … |
|---|---|
| Add a new factory state | `core/state-machine/states.ts` + transitions.ts |
| Wire a new label → workflow | `apps/server/src/shared/dispatch-routing.ts` |
| Add a new skill | `skills/<name>/{prompt.md, schema.ts, skill.config.ts}` |
| Add a DB table | `core/db/schema.ts` + `pnpm db:generate` |
| Add an SSE event kind | `core/event-stream/store.ts` (EventKind union) |
| Change a budget default | `core/agent-runtime/budgets.ts` (SKILL_BUDGETS) |
| Add a new role | `core/types.ts` (Role union) + audit-docs check |
| Add a hook the agent runs | `hooks/<name>.sh` (NOT `.claude/hooks/` — see CLAUDE.md) |

## Process model

- **Single Node process** per orchestrator run. Per-project ticks are
  independent `setInterval` loops in that same process. No worker
  threads; no clustering.
- **Child processes** for agents: `claude` or `codex` CLI spawned per
  skill invocation. `shell: false`, minimal env, 30 s timeout (rule 32).
- **SQLite, WAL mode.** All operational state. `busy_timeout = 5000`
  for the vitest case.
- **Workspaces are git worktrees** under `~/.factory/workspaces/<runId>/`.
  Sandboxed via `.claude/settings.local.json` written by
  `core/tool-layer/sandbox.ts`.

## Cross-cutting concerns

- **Event audit trail.** Every meaningful action is an event. Replay is
  cheap; SSE consumers use Last-Event-ID for resumption.
- **Cost accounting.** Every agent run writes one row to `agent_run_costs`,
  with `costLabel ∈ { 'estimated', 'exact' }` so the UI can be honest
  about which figures are real.
- **Holdout enforcement.** `contextAllowlist` declared on each skill;
  runtime drops disallowed keys at spawn time. Regression tested in
  `slices/holdout-boundary-test/`.
- **Secret redaction.** All event payloads go through `redactSecrets()`
  before serialisation (`core/event-stream/store.ts:170`).
