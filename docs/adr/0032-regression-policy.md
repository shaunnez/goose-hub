# ADR 0032 — Regression Policy for Tier-3 Verification Failures

**Status:** Accepted (amended 2026-05-11 in M19.19 — `'revert'` policy removed)
**Date:** 2026-05-08
**Issue:** #562 (M19.05 — 3-tier verification); amended in #695 (M19.19)

---

## Context

M19.05 introduces a 3-tier verification cascade. Tier 3 runs the full regression
test suite and checks carry-forward WP failures. When Tier 3 detects a regression
(test suite exits non-zero) the orchestrator must decide what to do.

Originally three options existed: `'revert'`, `'escalate'`, `'ignore'`. The
`'revert'` policy was decorative — it never triggered an actual revert; the
caller was expected to revert WP commits *before* invoking the workflow, and the
policy itself behaved identically to `'escalate'` (transition to needs-human).
With orchestrator-owned git worktrees per WP (ADR 0031), failed WPs simply do
not commit, so an explicit auto-revert is redundant. M19.27 tracks the deferred
investigation into whether a properly-designed auto-revert would add value
beyond worktree isolation; until then the policy union is narrowed to the two
options that carry real behaviour.

## Decision

`ProjectConfig.regressionPolicy?: 'escalate' | 'ignore'` (`core/types.ts`).
Default `'escalate'` when the field is absent.

The QA workflow (M19.19) runs deterministic tier verification before the QA
agent. On Tier-3 failure:

- **`escalate`** (default) → short-circuit. The workflow emits a synthetic
  `qa.completed` event with `verdict: 'fail'`, ground-truth `tierResults`, and
  routes to `factory:qa-failed` via the existing retry-counter logic (which
  escalates to `factory:needs-human` once `DEFAULT_MAX_RETRIES` is exhausted).
  The QA agent is **not** invoked.
- **`ignore`** → findings are emitted at `severity: 'warning'`; `TierResult.passed`
  is `true` despite the warning. The workflow continues to the QA agent as
  though Tier 3 had passed.

`'revert'` is no longer a legal value. Existing project configs that set it
will fail TypeScript compilation; this is intentional — `'revert'` never did
anything load-bearing and the schema bump makes the dead path impossible.

## Why not auto-revert?

Automatic git reverts on regression are dangerous:

- Factory doesn't know *which* WP caused the regression — all previously-ok WPs
  are equally suspect.
- Reverting commits that other WPs may depend on breaks the parallel-build
  invariants (ADR 0031).
- A human must verify the revert didn't introduce new problems.

The deferred investigation lives in M19.27. If a future design adds genuine
auto-revert (atomic rollback, blame attribution, retry semantics), the policy
union can be reopened then.

## Consequences

- `ProjectConfig.regressionPolicy` is optional. Any project config that omits
  it gets `'escalate'` semantics — no migration needed for the default case.
- Any project config that explicitly set `regressionPolicy: 'revert'` must be
  changed to `'escalate'` (behaviour is identical to the prior `'revert'`).
- `target-projects/goose-hub-self/project.config.ts` does not set
  `regressionPolicy` (defaults to `'escalate'`).
- The QA workflow (M19.19) is now the sole consumer of `regressionPolicy`. The
  standalone `slices/three-tier-verify/` slice was removed in M19.19 — its
  tier-running logic moved into `slices/qa/workflow.ts`; the pure tier-engine
  tests moved into `core/verify/tiers.test.ts`.
- Autonomous mode (M16) will no longer surface `regressionPolicy: 'revert'` as
  an auto-revert candidate — see M19.27.
