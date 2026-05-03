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
| `workflow.ts` | Main workflow function `runReviewWorkflow` |
| `slice.test.ts` | Vitest tests covering all verdicts and error path |
| `README.md` | This file |

## Usage

Called by `apps/server/src/domains/workflows/review-batch.ts` via the `/run-review` endpoint.

```typescript
import { runReviewWorkflow } from 'slices/review/workflow.js';

await runReviewWorkflow(workItem, stateSource, projectId, targetRepo);
```

## Related

- `skills/review/` — skill prompt and schema
- `slices/qa/` — upstream QA holdout (same pattern)
- `apps/server/src/domains/workflows/review-batch.ts` — batch runner
