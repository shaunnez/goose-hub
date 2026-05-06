# slices/holdout-boundary-test/

Verification slice for M8 exit criteria: deliberate context injection attempts on holdout roles (QA, Reviewer) must fail at the runtime layer.

## What this tests

- Disallowed keys are absent from the rendered XML context passed to Claude
- `tool.violation` events are emitted for each disallowed key on a holdout role
- Non-holdout roles do NOT emit violations (silent filter only)
- System keys (`projectId`, `workItemId`) are exempted from violation detection
- `runId` is correctly attributed in violation events

## Why this exists

FACTORY_RULES rule 1: QA and Review never see implementation reasoning. The holdout boundary
test is the formal proof that this property holds at the runtime layer, not just by convention.
Referenced directly in the M8 exit criteria (PLAN.md §28 M8).

## Running

```bash
pnpm test --reporter=json slices/holdout-boundary-test/slice.test.ts
```

No live Claude API required — tests the context assembly layer only.
