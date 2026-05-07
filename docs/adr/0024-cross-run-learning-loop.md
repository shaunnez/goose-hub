# ADR 0024: Cross-run learning loop (lifecycle archive → pattern miner → cross-run retrospective)

**Status:** Accepted
**Date:** 2026-05-07
**Milestone:** M11 — Dependency-aware Scheduling (M11.11, M11.12)

## Context

By the end of M9 the per-issue retrospective tier (`retrospective-light` and `retrospective-deep`) was
producing rich post-merge findings on each individual run, written to `improvement_candidates` and
surfaced in the Roster UI. What it could not produce was *cross-run* signal: "this persona keeps making
the same kind of decision in this phase," "this gate keeps failing for the same reason," "the cost of
QA on bug-type issues has drifted up 30 % over the last ten lifecycles." Each retro saw only its own
run, so recurring patterns were invisible.

Steve's autonomous-development training corpus
(`docs/steves-training-materials/Markdown Files/Autonomous Decelopment/08-learning-convergence-loop.md`)
calls this the convergence loop: archive every closed lifecycle, mine for repeating decision patterns,
detect when a pattern is "convergent" (high consistency over enough samples), and feed the convergent
patterns into a cross-run retrospective skill that can recommend changes the per-run retro never could.

We needed three coordinated mechanisms — archive, miner, cross-run retro — to land together, sharing a
data model and a clear separation between the deterministic SQL parts (archive + miner + thresholds)
and the LLM parts (cross-run retro skill).

## Decision

Ship a four-stage pipeline in `core/learning/` + `core/workflows/`:

1. **Archive (`core/learning/archive.ts`)** — `archiveLifecycle({ projectId, workItemId })` replays the
   event store for one closed lifecycle and writes a single row into `archived_lifecycles` containing:
   the per-issue cost roll-up, the full ordered list of `agent.decision-summary` events (with role and
   personaId), the QA/Review/Retro outcomes, and the lifecycle close timestamp. This is the
   denormalised, query-friendly substrate the miner reads. Triggered by the per-issue retro workflow
   immediately before the issue transitions to `factory:done`.

2. **Mine patterns (`core/learning/mine.ts`)** — `minePatterns({ projectId, since? })` groups
   archived decision summaries by `(decisionKind, role)` and records aggregate rows in
   `decision_patterns` (occurrence count, work-item IDs that exhibited the pattern, action and reason
   summaries). Pure SQL/aggregation; no LLM.

3. **Convergence detector (`core/learning/convergence.ts`)** — `computeTrend()` reports a coarse
   `improving | stable | declining` verdict over the last `windowSize` lifecycles for a given
   `(projectId, role[, skill])` triple, plus a numeric delta. Used by the UI roster trend arrow and by
   the cross-run retro to decide whether the picture warrants a write-up.

4. **Cross-run retro skill + workflow (`core/workflows/cross-run-retro.ts`,
   `skills/retrospective-cross-run/`)** — given a window (`windowSize` or `dateRange`), assemble:
   mined `topPatterns` with consistency scores, computed gate thresholds (mean / min / max / stdDev /
   sampleCount per gate via `playbook-stats.ts`), and per-phase cost baselines. Hand this evidence to
   the cross-run retro skill (sonnet) and persist its output (`improvement_candidates`,
   `playbooks` rows) for later coaching dispatch.

### Why split deterministic vs LLM stages

The miner and the threshold/baseline computation in `playbook-stats.ts` are deterministic by design.
They run on every closed lifecycle, are cheap, and produce an auditable evidence package. The LLM
(cross-run retro) is invoked only after the deterministic evidence is ready, and only when there are
enough lifecycles in the window to be worth the spend. This keeps the LLM bill bounded and makes the
inputs to the LLM reproducible.

### Why `archived_lifecycles` is its own table

Replaying the event store for every miner run would not scale (event volume per lifecycle is high and
the miner runs across many lifecycles). The archive row is the cached projection: written once at
close, read many times by miner / cross-run retro / portability export.

## Consequences

- A single closed lifecycle now produces three persistent artefacts: the per-issue retro
  (`improvement_candidates` + retro tab), the archived row (`archived_lifecycles`), and zero-or-more
  pattern updates (`decision_patterns` upsert).
- The cross-run retro is opt-in per project via `agentConfig.coachPolicy.enabled` (default `false`).
  When disabled the deterministic stages still run — the data is collected even when the LLM is not.
- Gate thresholds and cost baselines are computed from real archived runs, not hand-tuned. M9's
  static budgets feed in as a floor; the computed baselines tighten over time.
- Schema versioning lives on the playbook export side (see ADR 0027); `archived_lifecycles` is an
  internal table not subject to portability constraints.
- The decision summary feed that powers all of this is the `agent.decision-summary` event stream
  (ADR 0018). Convergence measurement is only as good as decision summary discipline.
