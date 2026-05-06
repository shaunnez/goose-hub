# ADR 0023: Relax per-project workflow lock to per-issue lock with `maxParallelAgents` cap

**Status:** Accepted
**Date:** 2026-05-06
**Milestone:** M11 — Dependency-aware Scheduling

## Context

FACTORY_RULES rule 14 stated: "One workflow at a time per project." This was enforced in
`apps/server/src/shared/dispatch.ts` via a per-slug `Set<string>` that held the single
in-flight issue key. The invariant was simple and safe: a project could never have more
than one agent running concurrently, regardless of how many eligible issues existed.

The problem surfaced during M11's dependency-aware scheduling work: a project with
`maxParallelAgents: 2` in its `ProjectConfig` can legitimately have two non-conflicting
issues ready to dispatch in the same tick. The original single-workflow lock forced them
to queue sequentially even when there was no resource conflict between them. For a sprint
with five independent issues, this effectively serialised the entire sprint, making
multi-issue parallel execution impossible.

The `maxParallelAgents` config key was introduced in M11.08 precisely to enable this
relaxation. Without a corresponding change to the lock semantics, the config key would
be silently ignored.

## Decision

Replace the single-workflow-per-project invariant with two co-existing invariants:

1. **Per-issue uniqueness (unchanged).** At most one concurrent workflow may run on a
   given issue at any time. Two workflows on the same issue are never allowed. This
   prevents duplicate fix/QA/review cycles and is enforced by checking the issue number
   against an in-flight `Set<number>`.

2. **Per-project cap (new).** The total number of concurrent workflows for a project is
   capped at `maxParallelAgents` (default `1`, preserving original behaviour for projects
   that do not opt in). A project with `maxParallelAgents: 2` may run up to two
   simultaneous workflows on two distinct issues.

### Implementation

A new `ProjectParallelLock` class in `core/projects/parallel-lock.ts` encapsulates both
invariants. It exposes three operations:

- `tryAcquire(slug, issueNumber, maxParallelAgents)` — atomic check-and-acquire; returns
  `false` if the issue is already in-flight or the project cap is reached.
- `release(slug, issueNumber)` — releases the slot held by this issue.
- `inFlightCount(slug)` — current occupied slot count (used for logging).

The singleton `parallelLock` replaces the previous `_issueInFlight: Set<string>` in
`dispatch.ts`. Every dispatch function now calls `parallelLock.tryAcquire(slug, issueNumber, maxParallel)` before launching an agent and `parallelLock.release(slug, issueNumber)` in its `finally` block.

The implementation shipped in PR #548 (closes issue #294, M11.08).

### Why `maxParallelAgents` defaults to `1`

A default of `1` means existing project configs that do not set `maxParallelAgents`
continue to exhibit single-workflow-per-project behaviour. The relaxation is opt-in,
not opt-out. No existing project is silently affected.

## Consequences

- Projects that set `maxParallelAgents: 2+` can now dispatch multiple workflows in the
  same tick, each on a distinct issue.
- The per-issue uniqueness guarantee is preserved; no issue can have two concurrent
  workflows regardless of `maxParallelAgents`.
- Budget enforcement (`perWorkflowMaxUsd`, `dailyTokens`) is checked before each
  individual dispatch, not once before the first. A project at its budget cap will not
  dispatch a second workflow even if `maxParallelAgents: 2`.
- Flood protection (`maxIssuesPerDayFromNonOwners`) is unchanged; it operates on the
  issue-creation rate, not the in-flight count.
- FACTORY_RULES rule 14 is amended: see the parenthetical note added in M11.
- The single-workflow guarantee for a project is no longer the default safety net; the
  per-issue lock + budget cap together form the new safety net.
