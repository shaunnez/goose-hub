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

## Decision-type taxonomy

| Step | Trigger |
|------|---------|
| `MODEL_SELECTION` | When the agent chooses between ambiguous type classifications |
| `SCOPE_CHANGE` | When the work item body reveals broader scope than the title suggests, changing the classification |
| `ESCALATE` | When the work item contains signals (urgency keywords, blocking dependencies) that elevate the priority above initial assessment |
