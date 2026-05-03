# retrospective-deep

Full retrospective skill. Runs after a successful merge when any deep trigger fires.

## When it runs

The `retrospective` workflow selects this skill (over `retrospective-light`) when:
- First run in a milestone
- Any QA failure occurred during the run
- A persona's quality score is declining
- `≥2` retry attempts were made
- `priority:high` or `priority:critical` task
- `retrospectivePolicy: 'always-deep'` in project config
- Explicit human request

## Output schema

Defined in `schema.ts`. References shared data models from `@goose-hub/core/retrospective/schemas.ts`:

| Field | Type | Description |
|---|---|---|
| `summary` | `string` | 3-bullet markdown: what went well, what did not, why |
| `personaAnalysis` | `QualityScore[]` | Per-persona quality scores with trend |
| `learningEntries` | `LearningEntry[]` | Normalized observations derived from decision records |
| `decisionPatterns` | `DecisionPattern[]` | Recurring cross-run patterns |
| `improvementCandidates` | `ImprovementCandidate[]` | Surfaced suggestions for prompt/skill/config changes |
| `decisionSummaries` | `DecisionSummary[]` | Required — ≥1 entry per FACTORY_RULES rule 6 |

## Convergence threshold

`CONVERGENCE_THRESHOLD = 'high'` (from `core/retrospective/schemas.ts`).

A `DecisionPattern` is only eligible to surface as an `ImprovementCandidate` once its `confidence` reaches `'high'`. Patterns at `'low'` or `'medium'` confidence are recorded in `decisionPatterns` but filtered out of `improvementCandidates` by the workflow layer.

This prevents low-signal noise from polluting the Roster with unactionable suggestions. The threshold applies at the workflow level, not the skill level — the skill reports all detected patterns; the workflow filters by `CONVERGENCE_THRESHOLD` before persisting candidates.

## improvement_candidates table compatibility

The `improvement_candidates` DB table (added in M9.06 / #264) stores `LearningEntry`-derived rows. Column mapping:

| Table column | Derived from |
|---|---|
| `id` | `LearningEntry.id` |
| `persona_name` | `LearningEntry.personaName` |
| `source_task_id` | First of `LearningEntry.sourceRunIds` (the run that triggered the retro) |
| `suggestion_text` | `LearningEntry.observation` |
| `suggestion_type` | `LearningEntry.improvementKind` |
| `status` | Always `'pending'` on insert; updated to `'approved'` or `'rejected'` via Roster UI |
| `created_at` | Set at insert time |

The `ImprovementCandidate` in the skill output additionally carries `targetPath`, `sourceProject`, `sourceWorkItem`, `confidence`, and optional `proposedDiff` — these are stored in the `improvement_candidates` table in the M9.06 migration (see #264 for full column list).

## Prompt file

`prompt.md` — added in M9.01 (#259) which creates both retrospective skills.

## Skill config

`config.ts` — added in M9.01 (#259). Role: `retrospector`. Not a holdout.
