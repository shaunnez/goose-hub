# interventions

Intervention queue UI for operators. Displays pending agent interventions across all projects, lets the operator review context, and submit decisions (accept, reject, or select from proposed options).

## Files

| File | Description |
|------|-------------|
| `OperatorQueuePage.tsx` | Full-page intervention queue. Fetches open interventions, their associated work items, and project configs. Renders each intervention with action buttons; submits decisions via `decideIntervention`. |
| `OperatorQueuePage.test.tsx` | Integration tests for `OperatorQueuePage` — covers empty state, rendering interventions, and submitting a decision. |
| `slice.test.ts` | Smoke test verifying the slice's public export contract. |

## Tests

```bash
pnpm --filter @goose-hub/web test -- interventions/
```
