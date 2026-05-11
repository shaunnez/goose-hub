# core/verify

Three-tier deterministic verification engine that runs **before** the QA holdout. The point is to catch obvious failures cheaply — without spending a QA agent budget on diffs that don't even compile.

## Tiers

| Tier | What it checks |
|---|---|
| 1 — Structural | Lint, typecheck, formatter. Failure here means the diff is broken before runtime is touched. |
| 2 — Functional | Targeted tests for the changed surface (per `EngineeringSpec.testCommand`). Failure means the change doesn't do what it claims. |
| 3 — Regression | Full test suite. Failure means the change broke unrelated tests. `regressionPolicy: 'escalate'` (default) hard-fails; `'ignore'` records the finding but allows progression. |

Each tier returns a `TierResult` with `passed`, `evidence` (CLI output excerpts), and structured `VerifyFinding[]`. Findings carry `severity` (error/warning/info), optional `file`/`line`, and a one-sentence `message`.

## Exports

| Symbol | Purpose |
|---|---|
| `runTiers(artifacts): Promise<TierResult[]>` | Run all three tiers against a worktree. Persists per-iteration progress to `wpIterations` so retries don't redo passed tiers. |
| `RunArtifacts` | Input: `{ runId, projectId, workItemId, worktreePath, diff?, testCommand?, regressionPolicy?, iteration? }`. |
| `VerifyFinding`, `TierResult` | Output shapes consumed by `slices/qa` and the parallel-implement orchestrator. |

## Why this exists

QA is a holdout — it never sees implementation reasoning, and it's expensive (Opus). Running deterministic tiers first means:

1. QA only sees diffs that already compile and pass the suite.
2. Structural/functional failures get caught with no model cost.
3. Iteration loops (parallel-implement → verify → re-implement) converge faster.

## Consumers

- `slices/parallel-implement` — runs `runTiers` between WP builders and the QA holdout.
- `slices/qa` — consumes tier-3 evidence as part of the QA context bundle.
- `skills/dev-review` — references tier output when generating adversarial review notes.
