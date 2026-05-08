# ADR 0033: QualityScore formula and weights

**Date:** 2026-05-08
**Status:** Accepted
**Issue:** #565 (M19.08)

## Context

Issue #565 requires a 0-100 per-run QualityScore whose formula "matches Steve"
(`03-lifecycle-harness.md:159-177`) — weighted sum, P0 zeroes score, regressions
deduct, convergent review bumps.

Steve's training materials define the _components_ (verbatim) but leave the
weight values as design space. This ADR records the chosen weights and the
rationale for each.

## Components

`QualityComponents` (snake_case for PlaybookManifest portability):

| Component         | Type  | Source                           |
|-------------------|-------|----------------------------------|
| `p0_count`        | int   | QA / review blocker findings     |
| `p1_count`        | int   | QA / review critical findings    |
| `p2_count`        | int   | QA / review major findings       |
| `p3_count`        | int   | QA / review minor findings       |
| `regressions_open`| int   | Tier-3 regression failures       |
| `review_converged`| bool  | Reviewer emits `approved`        |
| `uat_passed`      | bool  | Tier-2 functional verification   |
| `static_passed`   | bool  | Tier-1 structural verification   |
| `harness_pass_rate`| 0-1  | Test-suite pass ratio            |

`audit_score` (from code-quality-audit, #564) is stored alongside the score row
but does NOT feed `computeQualityScore`. It is informational — the audit answers
_architectural_ questions that are separate from ship-readiness.

## Formula

```
if p0_count > 0: return 0

score = base
      + harness_pass_rate × harness_weight
      + (static_passed  ? static_weight  : 0)
      + (uat_passed     ? uat_weight     : 0)
      + (review_converged ? review_weight : 0)
      - p1_count       × p1_deduction
      - p2_count       × p2_deduction
      - p3_count       × p3_deduction
      - regressions_open × regression_deduction

return clamp(round(score), 0, 100)
```

## Chosen weights

| Parameter            | Value | Rationale                                          |
|----------------------|-------|----------------------------------------------------|
| `base`               | 20    | A run that completed contributes a floor signal    |
| `harness`            | 30    | Test suite is the primary quality signal (0-30)    |
| `staticPassed`       | 20    | Structural verification — "did the change land?"   |
| `uatPassed`          | 20    | Functional verification — "does it work?"          |
| `reviewConverged`    | 10    | Human/holdout approval signals confidence          |
| `p1Deduction`        | 8     | Critical findings are expensive; each costs 8 pts  |
| `p2Deduction`        | 4     | Major findings cost half a critical               |
| `p3Deduction`        | 1     | Minor findings are noise-level deductions          |
| `regressionDeduction`| 5     | Each open regression is a ship-blocker signal      |

**Score ceiling:** 100 (base + harness + static + uat + review = 20+30+20+20+10 = 100).

**Typical good run** (harness=0.95, all passing, review_converged, 0 P1, 1 P2):
`20 + 28.5 + 20 + 20 + 10 - 4 = 94.5 → 95`

**Typical target** (harness=0.80, all passing, review_converged, 1 P1, 1 P2):
`20 + 24 + 20 + 20 + 10 - 8 - 4 = 82`

These typical values match the convergence example in the issue spec
(scores 82 → 84 → 85).

## Convergence rule (Steve verbatim)

```
isConverged(scoreHistory, latestComponents):
  scoreHistory.length >= 3
  AND (max(last 3) - min(last 3)) < 5.0
  AND latestComponents.p0_count + latestComponents.p1_count === 0
```

No `regressions_open <= 3` clause — Steve does not require this
(regressions_open already feeds the score directly).

## Autonomous-mode gate

In **supervised mode** the score is informational only (displayed in the
Roster quality-trend tab).

In **autonomous mode** (M16) PR auto-merge requires:
```
score >= 80 AND isConverged(history)
```

This threshold is deliberate: 80 allows one or two minor findings while still
requiring healthy test pass rates and no critical findings.

## Alternatives considered

**Pure deduction model (start at 100):** Rejects because a run with zero test
data would score 100. The base+components model forces positive signal before
scoring high.

**Steve's exact weight values:** Steve's deck describes the _component structure_
but not specific numeric weights. We anchor to the component list verbatim
and document our weights here for future auditability.
