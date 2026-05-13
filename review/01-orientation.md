# Orientation — read this first

## What Goose Hub is

A personal command centre for AI-assisted software delivery. One operator
(Shaun) runs it on his laptop. It picks up GitHub issues on registered
target repos, sends them through a multi-agent SDLC pipeline, opens PRs,
gates them with QA + Review holdouts, and merges on human approval.

"Factory" is the engine **inside** Goose Hub — orchestrator, workflows,
agent runtime, tool layer, workspaces. Don't confuse it with the
unrelated SaaS product.

## Mental model: the five-word elevator pitch

> Webhook flips label → workflow runs → PR opens → holdouts approve → human merges.

Everything else (skills, scouts, retros, the coach, parallel WP builders)
is a refinement on that loop.

## Core vocabulary cheat-sheet

| Term | One-line meaning |
|---|---|
| **Target project** | A project Factory drives. Lives at `target-projects/<slug>/project.config.ts`. |
| **Source of truth** | Where work-item state lives. v0: GitHub Issues (labels). |
| **State** | The factory:* label currently on the issue. 28 of them; see `core/state-machine/states.ts`. |
| **Work item** | A GitHub issue with factory labels (state, type, priority, schedule). |
| **Workflow** | A TS module in `slices/<name>/` or `core/workflows/` that drives an issue from one state to another. |
| **Skill** | A versioned `skills/<name>/` bundle: `prompt.md` + `schema.ts` + `skill.config.ts`. Atomic agent invocation unit. |
| **Persona** | Named round-robin instance of a role. Stats accumulate per project+role. |
| **Holdout** | An agent (QA, Reviewer) that runs in fresh context with no access to the developer's reasoning. Enforced by `contextAllowlist`. |
| **Smoke gate** | Six non-skippable preflight checks (gh auth, git fsck, claude binary, sqlite, API key, budget) before any dispatch. |
| **Advisor** | A higher-tier model that wraps a primary agent for high-priority work; verdict: proceed/revise/abort. |
| **Decision summary** | One-sentence event an agent emits at decision points. Two streams: schema field (canonical) + `[decision] KIND: …` markers (live). |

## What runs where

```
┌─────────────────────────────────────────────────────────────┐
│  apps/web        Vite + React 19 + Tailwind. Kanban UI.     │
│       │           Talks to apps/server over HTTP + SSE.     │
│       ▼                                                     │
│  apps/server     Hono. Receives GitHub webhooks. Runs per-  │
│       │           project tick scheduler. Hosts SSE.        │
│       ▼                                                     │
│  core/*          Library code: state machine, event store,  │
│       │           agent runtime, workflows, connectors.     │
│       ▼                                                     │
│  slices/*        Vertical features. One per workflow piece. │
│       │           Each owns its own slice.test.ts.          │
│       ▼                                                     │
│  skills/*        Versioned prompts + Zod schemas. Spawned   │
│                   as claude / codex CLI children.           │
└─────────────────────────────────────────────────────────────┘
```

State lives in two places, on purpose:

- **GitHub** (source of truth): work-item state via labels. Survives an
  orchestrator crash.
- **SQLite** (`~/.factory/data/factory.db`, operational only): event
  stream, persona stats, audit, governance, cost rows, archived
  lifecycles. Never the authority for work-item state.

## Things that surprise newcomers

1. **Labels carry state, not PR titles.** `factory:needs-qa` is gospel.
   PR labels are decorative.
2. **The orchestrator is stateless across ticks.** Each per-project
   `setInterval` re-derives everything from GitHub + SQLite.
3. **Skills cannot import other skills.** They're invoked through
   `invokeSkill()` in `core/agent-runtime/invoke-skill.ts`. That function
   is the only entry point.
4. **Holdouts have a runtime-enforced context allowlist.** Try to inject
   the developer's plan into a QA prompt and you get a `tool.violation`
   event, not a sneaky pass.
5. **better-sqlite3 is synchronous.** Inside a single Node process the
   event log is effectively single-threaded — that's why the
   "single-writer chokepoint" claim holds. Across processes (e.g. CLI vs
   server on the same DB) it doesn't.
6. **`pnpm test` writes per-worker DB files.** See
   `scripts/run-vitest-with-db.ts`. Don't try to share a DB across vitest
   workers, the migration race will bite.

## Where to read next

- New to the dispatch path → [`03-flows.md`](./03-flows.md).
- Need to add a table or query → [`04-data-model.md`](./04-data-model.md).
- Hunting a bug → [`05-findings.md`](./05-findings.md).
- Need a 2-hour win → [`07-quick-wins.md`](./07-quick-wins.md).

## Files every newcomer should open once

1. `CLAUDE.md` — agent-facing orientation; still useful for humans.
2. `CONTEXT.md` — resolved decisions, "how is this wired?" answers.
3. `FACTORY_RULES.md` — non-negotiables (numbered 1–33).
4. `docs/inventory.md` — auto-generated map; run `pnpm manifest` after
   touching the catalogue.
5. `core/types.ts` — canonical role union, role-model shape, project config.
6. `core/event-stream/store.ts` — the spinal cord.
