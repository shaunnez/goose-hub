# skills/write-prd

Authors a Product Requirements Document for a single work item. Produces structured output conforming to `PRDOutputSchema`. Runs in **fresh context** (no prior chat history, no implementation reasoning) — the `refinedIntent` is the source of truth.

## Inputs

`contextSchema` (`WritePRDContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Work item title |
| `workItem.body` | `string` | Work item body / description |
| `workItem.number` | `number` (int) | Work item issue number |
| `refinedIntent` | `string` | One-sentence clarified intent (typically from `grill-me`) |
| `priority` | `"low" \| "medium" \| "high" \| "critical"` | Triaged priority |

## Outputs

`PRDOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Concise PRD title |
| `problem` | `string` | The problem being solved |
| `proposedSolution` | `string` | High-level approach |
| `outOfScope` | `string[]` | Explicit non-goals |
| `successCriteria` | `string[]` | Free-form success summary lines |
| `acceptanceCriteria` | `AcceptanceCriterion[]` | Testable contract; each entry must reference a journey OR be `crossCutting: true` |
| `journeys` | `Journey[]` (min 1) | User journeys (narrative behaviour) |
| `functionalSpec` | `FunctionalSpec` | Behaviours, state model, invalid transitions, data constraints |
| `engineeringSpecRef` | `string?` | Optional pointer to an external engineering spec |
| `verticalSlices` | `SliceOutline[]` (min 1) | Slice breakdown with `journeyRefs` linking back to journeys |
| `estimatedComplexity` | `"low" \| "medium" \| "high"` | Overall complexity rating |
| `decisionSummaries` | `DecisionSummary[]` (min 1) | Per-decision audit trail |

## The three-layer doctrine

A PRD stacks three nested layers, each more concrete:

1. **User Journeys** — outside-in narrative. `persona`, `trigger`, ordered `steps` (each capturing `userAction` / `systemResponse` / `dataShown` / `stateChange`), `successState`, `errorStates`, `edgeCases`.
2. **FunctionalSpec** — inside-out contract. `behaviors` (when/given/then), `stateModel`, `invalidTransitions`, `dataConstraints`.
3. **Engineering Spec** — referenced by `engineeringSpecRef` (optional). Lives outside the PRD; the PRD only points to it.

`verticalSlices[]` is the bridge from this stack to actionable issues — each slice has `journeyRefs` linking it back to the journey IDs it implements.

## Acceptance-criterion cross-reference rule

Every `AcceptanceCriterion` must satisfy one of:

- **Journey-anchored**: `journeyId` (and optionally `stepIdx`) names the journey it tests.
- **Cross-cutting**: `crossCutting: true` and no `journeyId`.

Schema rejects ACs that satisfy neither (`.superRefine` enforcement). Note: the schema does not check that `journeyId` resolves to an entry in `journeys[]` — that stronger refinement is intentionally deferred.

## Decision-summary kinds

The `kind` field on each `decisionSummaries` entry is constrained to `DecisionKindSchema` in `core/agent-runtime/decision-types.ts` (see ADR 0018). Write-prd most commonly emits:

| Kind | Trigger |
|------|---------|
| `IMPLEMENTATION_PLAN` | Slice decomposition decision — how the feature was split into vertical slices |
| `SCOPE_CHANGE` | When the refined intent adds or drops a journey vs the original work item body |
| `UNCERTAINTY` | When a journey or constraint is best-effort because the refined intent left a gap |
| `VERDICT` | Final summary of the PRD shape and complexity rating |
