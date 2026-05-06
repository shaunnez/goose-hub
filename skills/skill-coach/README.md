# skill-coach

Agent skill that proposes unified diffs against a target skill's source files based on cross-run convergent patterns.

## Role

`retrospector`

## Input context

| Field | Description |
|---|---|
| `projectId` | Project slug |
| `targetSkillName` | Skill to analyse |
| `skillSourceFiles.skillMd` | Target skill's `prompt.md` contents |
| `skillSourceFiles.schemaTsExcerpt` | Target skill's `schema.ts` contents |
| `evidencePatterns` | Convergent decision patterns (from `decision_patterns` table) |
| `evidenceLifecycles` | Archived lifecycles providing evidence (may be empty) |

## Output schema

`SkillCoachOutputSchema` — see `schema.ts`.

| Field | Description |
|---|---|
| `skillName` | Echoed from input |
| `diagnosis` | One-sentence gap description |
| `proposedPatch` | Unified diff (empty string if no change warranted) |
| `rationale` | Why the patch addresses the gap |
| `evidencePatternIds` | Pattern IDs cited |
| `confidence` | `low | medium | high` |
| `decisionSummaries` | At least one VERDICT |

## Forbidden targets

The following skills cannot be coached (enforced in `core/workflows/skill-coaching.ts`):

- `qa`
- `review`
- `retrospective-light`
- `retrospective-deep`
- `retrospective-cross-run`
- `skill-coach`

## Manual trigger

`POST /projects/:slug/coach` with body `{ targetSkillName, patternIds[], lifecycleIds? }`.

Output is persisted as an `improvement_candidates` row with `proposedDiff` populated. The human reviews and applies via PR — never auto-applied.
