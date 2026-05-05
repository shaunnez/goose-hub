# skills/triage

Classifies a work item by type and priority. Produces structured output conforming to `TriageOutputSchema`.

## Inputs

`contextSchema` (`TriageContextSchema`) requires:

| Field | Type | Description |
|-------|------|-------------|
| `workItem.title` | `string` | Work item title |
| `workItem.body` | `string` | Work item body / description |

## Outputs

`TriageOutputSchema`:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"feature" \| "bug" \| "chore" \| "research"` | Work item classification |
| `priority` | `"p0" \| "p1" \| "p2" \| "p3"` | Priority level |
| `labels` | `string[]` | Additional descriptive labels |
| `reasoning` | `string` | 1–3 sentence explanation of classification |
| `decisionSummaries` | `DecisionSummary[]` | Per-decision audit trail (min 1) |

## Decision-summary kinds

The `kind` field on each `decisionSummaries` entry is constrained to the shared `DecisionKindSchema` enum in `core/agent-runtime/decision-types.ts` (see ADR 0018). Triage most commonly emits:

| Kind | Trigger |
|------|---------|
| `PLAN` | The default classification step — type/priority chosen from issue body |
| `MODEL_SELECTION` | When the agent chooses between ambiguous type classifications |
| `SCOPE_CHANGE` | When the work item body reveals broader scope than the title suggests, changing the classification |
| `ESCALATE` | When the work item contains urgency keywords or blocking dependencies that elevate priority above initial assessment |
| `UNCERTAINTY` | When the issue is too thin to classify confidently |
