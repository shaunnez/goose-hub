# ADR 0032 — Regression Policy for Tier-3 Verification Failures

**Status:** Accepted  
**Date:** 2026-05-08  
**Issue:** #562 (M19.05 — 3-tier verification)

---

## Context

M19.05 introduces a 3-tier verification cascade. Tier 3 runs the full regression
test suite and checks carry-forward WP failures. When Tier 3 detects a regression
(test suite exits non-zero) the orchestrator must decide what to do.

Three options exist:

1. **Escalate** — block the workflow, transition to `factory:needs-human`. Safe default.
2. **Revert** — automatically undo the WP commits that likely introduced the regression,
   then retry. Requires the caller to perform the revert *before* the transition;
   the policy alone does not trigger git operations.
3. **Ignore** — treat Tier-3 findings as warnings only; the workflow continues as passed.
   Only safe for known-flaky suites or provisional builds.

## Decision

Add `regressionPolicy?: 'revert' | 'escalate' | 'ignore'` to `ProjectConfig` in
`core/types.ts`. Default is `'escalate'` when the field is absent.

The three-tier verify workflow reads this field and:

- **`escalate` / `revert`** → `stateSource.transitionState('factory:needs-qa', 'factory:needs-human')`.  
  For `revert`, the caller is expected to revert the offending WP commits via
  `revertWpChanges()` (ADR 0031) *before* calling the workflow; the transition
  ensures a human confirms the revert completed correctly before re-running.
- **`ignore`** → findings are emitted at `severity: 'warning'`; `TierResult.passed`
  is `true` despite the warning. The `qa.regression-failed` event is NOT emitted;
  `qa.regression-passed` is emitted instead (the workflow continued). A `qa.regression-warning`
  note is included in the event payload for observability.

## Why not auto-revert?

Automatic git reverts on regression are dangerous:
- Factory doesn't know *which* WP caused the regression — all previously-ok WPs are
  equally suspect.
- Reverting commits that other WPs may depend on breaks the parallel-build invariants
  (ADR 0031).
- The human must verify the revert didn't introduce new problems.

The `'revert'` option exists as a policy signal for the caller to implement targeted
revert logic; it still escalates to `factory:needs-human` as the termination state.

## Consequences

- `ProjectConfig.regressionPolicy` is optional. Any existing project config that omits
  it gets `'escalate'` semantics — no migration needed.
- `target-projects/goose-hub-self/project.config.ts` does not set `regressionPolicy`
  (defaults to `'escalate'`).
- The QA workflow (existing `slices/qa/`) is unaffected — it does not use the
  3-tier verify engine. That engine is for the parallel-implement post-build gate.
- Autonomous mode (M16) will surface `regressionPolicy: 'revert'` as a candidate
  for auto-revert wiring once the parallel-implement feedback loop matures.
