# skills/qa

QA holdout skill. Runs independent three-tier verification of a PR against the original issue acceptance criteria, then produces a structured quality verdict.

## Holdout discipline

The QA agent is a **holdout** role. This means:

1. `freshContext: true` — the agent starts with no memory of prior sessions
2. `contextAllowlist` restricts what it can see — it never receives developer decision summaries or investigator findings
3. It must independently verify the PR without knowledge of why the developer made the choices they did

The contextAllowlist contains: `workItem`, `prDiff`, `projectCommands`, `sliceTests`.
It explicitly excludes: `devDecisionSummaries`, `investigationFindings`.

This is enforced at the orchestrator level. Any attempt to pass developer reasoning to the QA agent constitutes a violation of the holdout rule.

## Role

`qa` — sonnet-tier model. Verification is structured and repeatable; it does not require opus-level reasoning.

## Three-tier verification framework

The QA agent runs three tiers in sequence. Each tier has a defined purpose and produces a `TierResult`.

| Tier | Purpose | Commands |
|------|---------|----------|
| Structural | Lint, type-check, schema regressions | `lintCommand` (if provided) |
| Functional | Unit + integration tests, acceptance criteria | `testCommand` |
| Regression | E2E, UX regressions | `e2eCommand` (if provided) |

A tier failure records all findings but does not stop execution. All three tiers always run (unless the environment is broken).

## 8-category quality scoring

The QA agent scores code quality across 8 categories from Steve's training materials:

| Category | Max pts | What it measures |
|----------|---------|-----------------|
| openClosed | 20 | Open/Closed Principle adherence |
| conceptCount | 15 | Number of distinct concepts introduced |
| timeToCapability | 15 | How quickly a developer can use the code |
| complecting | 15 | Mixing of unrelated concerns |
| loc | 10 | Conciseness (fewer lines = better, when clear) |
| coupling | 10 | Dependency strength between modules |
| gallsLaw | 10 | Incremental evolution vs big-bang complexity |
| cyclomaticComplexity | 5 | Branching count in functions |
| **Total** | **100** | |

Pass threshold: **aggregate >= 70/100**

The `computeOverallScore` helper in `schema.ts` sums all category values.

## Verdict rules

| Verdict | Conditions |
|---------|-----------|
| `pass` | No error findings; all criteria met; score >= 70; tiers 1 and 2 passed |
| `fail` | Any error finding; or any criterion not met; or score < 70; or tier 1 failed |
| `partial` | Tier 1 passed but tier 2 failed; or warnings present with score >= 70; or e2e skipped with UI changes |

## Inputs

`contextSchema` (`QaContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Issue title |
| `workItem.body` | `string` | Issue body with acceptance criteria |
| `workItem.number` | `number` | Issue number |
| `prDiff` | `string` | Complete git diff of the PR |
| `projectCommands.testCommand` | `string` | Command to run tests |
| `projectCommands.lintCommand` | `string?` | Command to run lint (optional) |
| `projectCommands.e2eCommand` | `string?` | Command to run e2e tests (optional) |
| `sliceTests` | `string[]?` | Paths to slice test files (optional) |

## Outputs

`QaOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `verdict` | `"pass" \| "fail" \| "partial"` | Overall QA verdict |
| `overallScore` | `integer 0–100` | Sum of all quality scores |
| `threshold` | `integer` | Pass threshold (default: 70) |
| `tierResults` | `object` | Per-tier results (structural, functional, regression) |
| `qualityScores` | `QualityScores` | All 8 category scores |
| `findings` | `Finding[]` | Consolidated findings across all tiers |
| `decisionSummaries` | `DecisionSummary[]` | Per-step audit trail |
| `testRun` | `TestRun?` | Structured test results — populated by the workflow, not the agent |

`Finding`:

| Field | Type | Description |
|-------|------|-------------|
| `tier` | `"structural" \| "functional" \| "regression"` | Which tier found this |
| `severity` | `"error" \| "warning" \| "info"` | How serious |
| `file` | `string?` | Relevant file path |
| `line` | `integer?` | Relevant line number |
| `description` | `string` | What was found |
| `suggestion` | `string?` | Suggested fix |

## On-failure behavior

When the QA verdict is `fail`:
1. The orchestrator picks up the `QaOutput` from the agent result
2. All `error`-severity findings are surfaced in the PR review comment
3. The issue transitions back to `factory:in-progress` for the developer to address
4. The developer does NOT see `decisionSummaries` from the QA run (holdout preserved on retry)

When the QA verdict is `partial`:
1. The orchestrator surfaces `warning`-severity findings as review comments
2. The PR may proceed to the Reviewer agent if the criteria and score conditions are met
3. The Reviewer can choose to accept or require further changes

## Decision-summary pattern

The QA agent emits `[decision] <one sentence>` lines during verification. These are stored as `agent.decision-summary` events and are NOT forwarded to the Reviewer agent (maintaining the reviewer holdout).

Standard steps: `issue-read`, `diff-read`, `structural-check`, `functional-check`, `regression-check`, `criteria-check`, `quality-score`, `verdict`.
