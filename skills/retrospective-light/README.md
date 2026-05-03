# retrospective-light

Thin retrospective skill. Runs by default after every successful merge.

## When it runs

Selected by the `retrospective` workflow when no deep trigger fires:
- No QA failures
- Zero retry attempts
- Not the first run in a milestone
- No persona quality score decline
- `retrospectivePolicy: 'always-light'` or `'auto'` (with no triggers)

## Output schema

Defined in `schema.ts`. Imports `ImprovementCandidateSchema` from `@goose-hub/core/retrospective/schemas.ts`.

| Field | Type | Description |
|---|---|---|
| `summary` | `string` | 3-bullet markdown: what went well, what did not, main takeaway |
| `improvementCandidates` | `ImprovementCandidate[]` | Obvious high-confidence candidates only |
| `decisionSummaries` | `DecisionSummary[]` | Required — ≥1 entry per FACTORY_RULES rule 6 |

## Improvement candidates

Only `confidence: "high"` candidates are included. Low/medium confidence observations are discarded in the light tier. Use deep retro to capture those.

## Prompt

`skill.md` — instructs the agent to summarise the run in 3 bullets and surface high-confidence candidates only.

## Config

`config.ts` — role: `retrospector`, model: `sonnet`, `freshContext: false`.
