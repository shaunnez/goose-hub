# ADR 0017: Placement of Cross-Slice Workflows in `core/workflows/`

**Status:** Accepted  
**Date:** 2026-05-05  
**Milestone:** M9 — Retrospective and Learning Loop

## Context

Goose Hub has two locations where workflow logic can live:

- **`slices/<name>/workflow.ts`** — the canonical location for a self-contained orchestration workflow that owns a specific pipeline stage and can be shipped or removed as a unit.
- **`core/`** — shared abstractions consumed by multiple slices or apps; never deleted by removing a single feature.

M9 introduced `runRetrospectiveWorkflow()`. This function is called from two places:

1. `apps/server/src/domains/workflows/retro-batch.ts` (label-webhook dispatch path)
2. `apps/server/src/domains/issues/transitions.ts` (fire-and-forget from `approveIssue`)

A workflow called from two independent server code paths is not isolatable as a single slice — removing it would require coordinated changes across both callers. It also composes across the entire post-merge pipeline rather than owning a single state transition.

The question was whether to put it in `slices/retrospective/` (following the existing slice pattern) or `core/workflows/` (a new subdirectory).

## Decision

Workflows that are **called from more than one server code path** and cannot be cleanly removed as a single slice unit live in `core/workflows/`.

The first inhabitant is `core/workflows/retrospective.ts`, which exports `runRetrospectiveWorkflow()`.

The rule for future workflows: start in a slice; promote to `core/workflows/` only when a second caller appears that is not the slice's own batch runner.

### What `core/workflows/` is not

- It is not a catch-all for "complex" workflows. Single-caller workflows belong in slices regardless of complexity.
- It is not `core/orchestrator/workflows/`. PLAN.md §6 explicitly states workflow modules live in `slices/<name>/workflow.ts`, not under `core/orchestrator/`. The `core/workflows/` directory is a narrow exception for cross-caller modules, not the general orchestrator workflow location.

## Consequences

**Positive:**
- The two callers of `runRetrospectiveWorkflow()` import from a stable core path rather than one caller importing from the other's slice (which would be a slice-to-slice import violation).
- The naming makes the exception explicit: `core/workflows/` signals "multi-caller workflow logic" whereas `slices/*/workflow.ts` signals "single-pipeline-stage logic."

**Trade-offs:**
- `core/workflows/` is a new pattern that could attract workflows that belong in slices. The "promote only on second caller" rule is the guard against this drift.
- PLAN.md §6 diagram must be kept current as this directory grows; it was not updated at the time of the original M9 PR (corrected in the M9 exit audit).

## Alternatives Considered

**Alternative A: Put the workflow in `slices/retrospective/`** — place `runRetrospectiveWorkflow` in `slices/retrospective/workflow.ts` and have `transitions.ts` import from it. Rejected: slice-to-slice imports are forbidden (FACTORY_RULES rule 24). `transitions.ts` lives in `apps/server/`, not in a slice, but having a server domain module import from a slice is an architectural inversion — the server dispatches to slices, not the reverse.

**Alternative B: Inline the workflow at each call site** — duplicate the tier-selection and skill-dispatch logic in both `retro-batch.ts` and `transitions.ts`. Rejected: duplication would immediately diverge; the tier-selection logic needs a single source of truth.

**Alternative C: Promote the workflow to the server shared layer** — put the logic in `apps/server/src/shared/`. Rejected: `core/` is the correct home for logic consumed across the app boundary (server today; CLI or future consumers tomorrow). `apps/server/src/shared/` is server-internal only.
