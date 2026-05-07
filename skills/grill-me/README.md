# skills/grill-me

Runs a structured discovery session on a vague work item. Asks ONE focused question per round (Mat Pocock interrogation pattern) until the intent is precise enough to hand off to a PRD writer.

## Inputs

`contextSchema` (`GrillMeContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Work item title |
| `workItem.body` | `string` | Work item body / description |
| `workItem.number` | `number` (int) | Work item issue number |
| `priorReplies` | `Array<{ role: 'user' \| 'agent', content: string }>` | Conversation so far; empty for round 1 |
| `roundNumber` | `number` (int, min 1) | Current round index (1-based) |

## Outputs

`GrillMeOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `questions` | `string[]` | Zero or one focused question for the next round; empty when `readyForPRD` is `true` |
| `refinedIntent` | `string` | One-sentence summary of the clarified work item intent |
| `readyForPRD` | `boolean` | `true` when intent is precise enough for a PRD, or when `roundNumber >= 7` |
| `decisionSummaries` | `DecisionSummary[]` | Per-decision audit trail (min 1) |

## Decision-summary kinds

The `kind` field on each `decisionSummaries` entry is constrained to the shared `DecisionKindSchema` enum in `core/agent-runtime/decision-types.ts` (see ADR 0018). Grill-me most commonly emits:

| Kind | Trigger |
|------|---------|
| `PLAN` | The question selection step — which unknown was chosen to ask about and why |
| `UNCERTAINTY` | A gap or ambiguity that remains after the current round |
| `QUERY_PIVOT` | When the agent changes the line of questioning based on a prior answer |
| `VERDICT` | When the agent decides intent is sufficiently precise and sets `readyForPRD: true` |
