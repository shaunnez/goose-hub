# slices/review

Run-review workflow: transitions work items from `factory:needs-review` to `factory:approved`, `factory:needs-fix`, or `factory:needs-human`.

## What this slice does

Invokes the Review holdout agent (`skills/review/`) after QA has passed. The Reviewer independently checks acceptance criteria against the PR diff and QA verdict, then issues a verdict.

## State machine

```
factory:needs-review
  → factory:approved   (verdict: approved)
  → factory:needs-fix  (verdict: needs-fix)
  → factory:needs-human (verdict: needs-human OR runtime error)
```

## Holdout discipline

The Reviewer is a holdout (FACTORY_RULES 1, 20, 23):

- `freshContext: true` — no memory of developer decisions
- `contextAllowlist: ['workItem', 'prDiff', 'qaVerdict']` — no `devDecisionSummaries`
- Forms an independent judgement; QA verdict is context only, not directive

## Files

| File | Purpose |
|------|---------|
| `workflow.ts` | `runReviewWorkflow` (single-reviewer) + `runConvergentReviewWorkflow` + `dispatchReviewWave` (M19.04) |
| `slice.test.ts` | Vitest tests covering all verdicts, error path, and convergent review (M19.04) |
| `README.md` | This file |

## Convergent review (M19.04)

`runConvergentReviewWorkflow` replaces single-reviewer with adversarial 2-reviewer rounds:

- Round 1 spawns 2 reviewers concurrently via `dispatchReviewWave`.
- Rounds continue until 2 consecutive rounds have 0 new CRITICAL findings (convergence).
- Auth/session/crypto topics (`core/review/topic-classifier.ts`) force `minRounds = 3`.
- At cap (`maxReviewRounds`, default 3 or `project.maxReviewRounds`) with unresolved CRITICAL → `factory:needs-human`.
- Per-reviewer parse failure → immediate `factory:needs-human` (no fallback, rule 23).
- Reviewer B in each round runs unconstrained (`extraEventPayload.unconstrained = true`).

## Usage

```typescript
import { runReviewWorkflow } from 'slices/review/workflow.js';
import { runConvergentReviewWorkflow } from 'slices/review/workflow.js';

// Single-reviewer (legacy):
await runReviewWorkflow(workItem, stateSource, projectId, targetRepo);

// Convergent adversarial review (M19.04):
await runConvergentReviewWorkflow(workItem, stateSource, projectId, targetRepo);
```

## Related

- `skills/review/` — skill prompt and schema
- `slices/qa/` — upstream QA holdout (same pattern)
- `apps/server/src/domains/workflows/review-batch.ts` — batch runner
