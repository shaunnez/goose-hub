# retrospective-cross-run

Cross-run retrospective skill (M11.12). Produces a `PlaybookManifest` over a window of archived lifecycles.

This is the **analytical path** counterpart to the per-merge `retrospective-deep` skill, not a replacement. The per-merge retro keeps emitting per-run output (the fast path); the cross-run retro consumes many of those.

## When it runs

Triggered on demand by `POST /api/projects/:slug/playbooks` with one of:

- `windowSize` (integer, number of most recent lifecycles to consider), or
- `dateRange` (`{ startAt, endAt }`, ISO8601 inclusive bounds)

The workflow (`core/workflows/cross-run-retro.ts`) fetches archived lifecycles + mined patterns + computed gate thresholds and cost baselines, dispatches the skill, then persists the validated output as a new `playbooks` row.

## Output schema

Defined in `schema.ts`. Extends `RetroOutputBaseSchema` from `core/retrospective/schemas.ts` with:

| Field | Type | Description |
|---|---|---|
| `windowStartAt` | `string` (ISO8601) | Window lower bound |
| `windowEndAt` | `string` (ISO8601) | Window upper bound |
| `lifecycleCount` | `integer` | Number of archived lifecycles in the window |
| `aggregatedLearnings` | `LearningEntry[]` | Cross-run learnings (recurring observations) |
| `topPatterns` | `CrossRunPattern[]` | Highest-signal mined patterns (`consistencyScore` + `occurrenceCount`) |
| `gateThresholds` | `GateThreshold[]` | Per-gate `mean / min / max / stdDev` for `qa` and `review` |
| `costBaselines` | `CostBaseline[]` | Per `(role, skill)` `mean / p50 / p95` cost in USD |
| `improvementCandidates` | `ImprovementCandidate[]` | Reuses the existing schema; `evidence` **must** cite a `patternId` when `kind ∈ {skill-prompt, skill-schema, skill-config}` |

## Storage

Validated output is persisted to the `playbooks` table:

- `id` — autoincrement
- `projectId`
- `windowStartAt`, `windowEndAt`
- `lifecycleCount`
- `manifest` — JSON-encoded `CrossRunRetroOutput`
- `createdAt`

## Skill config

`skill.config.ts` — Role: `retrospector`. Not a holdout. Pinned to `sonnet` (structured analysis, not coding).

## Prompt file

`prompt.md` — appended to system prompt via `readPromptWithContext()`. Inline prompts in code fail review.
