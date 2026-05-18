# slices/fix-issue

The M7 supervised dev workflow. Picks up a `factory:dev-ready` issue, creates a worktree, optionally runs the advisor (high/critical priority), runs the implement skill (TDD), opens a PR, posts evidence, and transitions the issue to `factory:approved`.

Current cross-workflow maps are catalog-backed in
`core/workflows/workflow-catalog.ts` and rendered in Settings. The diagram below
is a historical slice note for the legacy single-issue implementation path.

## State machine

```
factory:dev-ready
   │   createWorktree
   ▼
factory:in-progress
   │
   │  ── if priority:high|critical ──▶ implement (pass 0) ─▶ adviseOnPlan
   │                                                              │
   │                                              ┌───────────────┼───────────────┐
   │                                              │               │               │
   │                                          proceed          revise           abort
   │                                              │               │               │
   │                                              │   re-spawn implement(pass 1)  │
   │                                              ▼               ▼               ▼
   │                                              ┌───────────────┘   factory:needs-human
   │                                              │
   │  ── otherwise ──▶ implement (pass 0) ────────┘
   ▼
openPR (#184)
   ▼
runEvidencePost (#234, best-effort)
   ▼
factory:approved   ◀── M7 path; M8 will insert factory:needs-qa → factory:needs-review
```

On any failure other than `evidence-post`, the workflow posts a comment, emits `agent.run-failed`, and transitions to `factory:needs-human`. The worktree is cleaned up in a `finally`.

## Sequence

1. `createWorktree(targetRepo, runId)` (#193 / `core/workspaces`)
2. `transitionState(externalId, factory:dev-ready, factory:in-progress)`
3. **(advisor-gated only)** Run `implement` (pass 0) → `adviseOnPlan(plan)` → `proceed | revise | abort`
4. Run `implement` skill (#180) — TDD-first, sandboxed `dev-tools` bundle
5. Emit `agent.decision-summary` events for each implement summary + `agent.implement-complete` event
6. Open PR via `openPR` connector (#184). Body contains `Closes #N` and intentionally NO implementation reasoning (FACTORY_RULES rule 1)
7. **(non-blocking)** `runEvidencePost` (#234) — runs `evidence-post` skill if `evidenceSpecPath` was declared. On failure emits `evidence.post-failed` and continues. If no spec was declared, emits `evidence.no-spec-declared`.
8. `transitionState(externalId, factory:in-progress, factory:approved)` — M7 only; M8 will route to `factory:needs-qa` first.

## Dependency injection (for tests)

The workflow accepts a `deps` parameter that overrides:
- `runtime` (default `ClaudeCliRuntime`)
- `openPRImpl` (default the real connector)
- `adviseOnPlanImpl` (default `adviseOnPlan`)
- `createWorktreeImpl` / `cleanupWorktreeImpl` (default the real worktree helpers)

This lets `slice.test.ts` exercise the full state machine without spawning agents or calling GitHub.

## Reference

- `core/agent-runtime/advisor.ts` — `adviseOnPlan` wrapper (#182)
- `core/connectors/github/open-pr.ts` — `openPR` (#184)
- `core/workspaces/worktree.ts` — `createWorktree`, `cleanupWorktree`
- `skills/implement/` (#180) — developer skill
- `skills/advise-on-plan/` (#181) — advisor skill (CONTEXT.md "Advisor Flow")
- `skills/evidence-post/` (#233) — post-implementation evidence
- `core/event-stream/store.ts` — event kinds: `pr.opened`, `agent.implement-complete`, `evidence.posted`, `evidence.post-failed`, `evidence.no-spec-declared`
