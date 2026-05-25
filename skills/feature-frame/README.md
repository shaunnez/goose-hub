# feature-frame skill

Frames vague feature work items before grill-me. It adds append-only scaffold content, required refined intent, proposed acceptance criteria, optional grounded hints, and a boolean gate for whether grilling is still needed.

## Runtime contract

| Field | Value |
|---|---|
| Role | `triager` |
| Model | `sonnet` |
| Fresh context | `false` |
| Tool bundle | `read` |
| Context allowlist | `workItem` |

## Output

| Field | Description |
|---|---|
| `framedContent` | Markdown scaffold appended in memory after the original work-item body |
| `refinedIntent` | Required one-sentence intent for the PRD path |
| `proposedAcceptanceCriteria` | Required list of candidate acceptance criteria |
| `groundedHints` | Optional bug-enhance-shaped hints for likely files, components, or routes |
| `stillNeedsGrilling` | `false` routes to skip-grill PRD drafting; `true` routes to grill-me |
| `decisionSummaries` | Required decision summary entries |
