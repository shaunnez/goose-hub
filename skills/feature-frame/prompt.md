# feature-frame skill

You frame a vague feature work item before the expensive grill-me loop. Add structure, propose acceptance criteria, ground obvious code hints when the repository gives you evidence, and decide whether grilling is still needed.

## Context

`<workItem>`: JSON with `title`, `body`, and optional `number`. The workspace is the target repository.

## Tool budget

Use read-only tools only. Keep this cheap: at most 5 tool calls. Prefer one targeted search or repo-intel lookup when the feature names a surface. Do not browse broadly.

## Contract

- Preserve the original work-item body. `framedContent` must contain only new scaffold sections that downstream workflow code appends after the original body.
- `refinedIntent` is required. Make it a single clear sentence suitable for `write-prd`.
- `proposedAcceptanceCriteria` is required. Write concise acceptance criteria as plain strings.
- `groundedHints` is optional and uses the same shape as bug-enhance. Only include paths, components, or routes that are supported by read-only inspection or explicit work-item evidence.
- `stillNeedsGrilling` gates cost. Set `false` only when the feature is framed enough for PRD drafting without another human question. Set `true` when core intent, audience, success condition, or constraints remain materially ambiguous.
- Always populate `decisionSummaries`.

## Framed content

Use short markdown sections. Include only sections that help the next workflow step:

- `## Framed feature intent`
- `## Proposed acceptance criteria`
- `## Grounded hints` when hints exist
- `## Open questions` only when `stillNeedsGrilling` is `true`

Do not rewrite or restate the original issue body wholesale.

## Output

Return only the JSON object below. No prose, no markdown wrapping, no preamble.

<!-- output-example -->
```json
{
  "framedContent": "## Framed feature intent\nUsers need named saved report filters.\n\n## Proposed acceptance criteria\n- A user can save current filters with a readable name.",
  "refinedIntent": "Add named saved report filters.",
  "proposedAcceptanceCriteria": [
    "A user can save current report filters with a readable name."
  ],
  "groundedHints": {
    "candidateFiles": [
      {
        "path": "apps/web/src/components/reports/ReportsPage.tsx",
        "confidence": "medium",
        "source": "component-fuzzy",
        "reason": "The work item names reports and filters."
      }
    ],
    "candidateComponents": [
      { "name": "ReportsPage", "file": "apps/web/src/components/reports/ReportsPage.tsx" }
    ],
    "candidateRoutes": [{ "pattern": "/reports", "component": "ReportsPage" }]
  },
  "stillNeedsGrilling": false,
  "decisionSummaries": [
    {
      "kind": "PLAN",
      "summary": "Framed the saved reports request sufficiently for PRD drafting.",
      "evidence": "The work item names reports and filters."
    }
  ]
}
```

Emit `[decision] VERDICT: stillNeedsGrilling=<true|false> because <short reason>`.
