# core/retrospective

Shared Zod schemas for retrospective skill outputs. The three retro skills (`retrospective-light`, `retrospective-deep`, `retrospective-cross-run`) all conform to these shapes so downstream consumers (improvement-candidate filer, playbook builder) can treat their outputs uniformly.

## Exports

| Schema | Purpose |
|---|---|
| `SummarySchema` | `{ wentWell, didNotGoWell, architecturalTakeaway }` — three short paragraphs. |
| `ImprovementKindSchema` | Enum: `skill-prompt`, `skill-schema`, `skill-config`, `global-config`, `project-config`, `persona`, `workflow`, `governance-suggestion`. |
| `ImprovementCandidateSchema` | A flagged improvement with `kind`, `targetPath`, `suggestionText`, optional `proposedDiff`, `confidence`, optional `sourcePersonaId`. |
| `ConfidenceSchema` | `low` / `medium` / `high`. |
| `OutcomeSchema` | `success` / `failure` / `partial`. |
| `QualityScoreSchema` | Persona-level quality score (0–1). |

Re-exports `DecisionKindSchema` / `DecisionKind` from `core/agent-runtime/decision-types` so retro skills don't import directly from the agent runtime.

## Why these live here

The skills under `skills/retrospective-*/` each have their own `schema.ts` for their full output shape — these shared sub-schemas are imported and composed there. Keeping them in `core/` (not in skills) means:

1. The improvement-candidate filer in `core/learning/` reads `ImprovementCandidate` from this single source of truth.
2. Cross-run retros and playbooks can validate manifest entries without depending on any one skill's full schema.

## Consumers

- `skills/retrospective-light`, `skills/retrospective-deep`, `skills/retrospective-cross-run`
- `core/learning/` (improvement-candidate filer)
- `core/playbooks/` (manifest validator)
