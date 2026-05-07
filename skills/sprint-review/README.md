# skills/sprint-review

Milestone-rollup retrospective skill. Synthesises closed issues and per-issue retro outputs into a structured sprint review for a completed milestone.

## When it runs

Fired by the milestone-completion hook when all `schedule:current` issues for a milestone have reached `factory:done`. The workflow trigger is out of scope for this slice; this skill provides the agent logic only.

## Inputs

`contextSchema` (`SprintReviewContextSchema`) requires:

| Field | Type | Description |
|---|---|---|
| `milestone.title` | `string` | Milestone title (e.g. "M13: Subagents") |
| `milestone.number` | `number` | Milestone number |
| `closedIssues` | `Array<{ number, title, labels }>` | Issues closed in this milestone |
| `retroOutputs` | `Array<{ workItemNumber, summary, learningEntries? }>` | Per-issue light retro summaries |
| `improvementCandidates` | `Array<{ kind, suggestionText, confidence }>` | Improvement candidates surfaced during the milestone |

## Outputs

`SprintReviewOutputSchema`:

| Field | Type | Description |
|---|---|---|
| `milestoneTitle` | `string` (min 1) | Title of the milestone being reviewed |
| `shipped` | `string[]` | One-line summary per closed issue (may be empty) |
| `deferred` | `string[]` | Items inferred as deferred (may be empty) |
| `retroThemes` | `string[]` | Cross-cutting themes from retro outputs (may be empty) |
| `nextSprintSuggestions` | `string[]` | Forward-looking suggestions for the next sprint (may be empty) |
| `decisionSummaries` | `DecisionSummary[]` | Required — min 1 entry per FACTORY_RULES rule 6 |

## Decision-summary kinds

The `kind` field on each `decisionSummaries` entry is constrained to `DecisionKindSchema` in `core/agent-runtime/decision-types.ts`. Sprint review most commonly emits:

| Kind | Trigger |
|---|---|
| `READ` | Milestone and issue data ingested |
| `PLAN` | Approach chosen for synthesising retro themes |
| `DEFERRED` | Items identified as deferred from retro signals |
| `INSIGHT` | Cross-cutting theme identified across multiple retro outputs |
| `VERDICT` | Final milestone outcome summary |

## Config

`skill.config.ts` — role: `retrospector`, model: `sonnet`, `freshContext: false`, `toolBundles: ['core']`.
