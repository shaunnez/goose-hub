# ADR 0019 — Retrospective output schema (model emits, workflow injects provenance)

## Status

Accepted (M9 maintenance fix, post #466).

## Context

The retrospective skill schemas (`skills/retrospective-light/schema.ts`, `skills/retrospective-deep/schema.ts`, and the shared types in `core/retrospective/schemas.ts`) accumulated drift across three independent edits between M9 introduction and M9 deep-trigger work:

1. Schema fields the model cannot populate were left as required: `id`, `sourceRunIds`, `exampleRunIds`, `surfacedAt`, `computedAt`, `sourceRunId`, `sourceProject`, `sourceWorkItem`. These belong to a future DB layer or to the workflow caller, not to the agent's structured output.
2. Light and deep tiers diverged on the canonical shape:
   - Light emitted `summaryBullets: string[]`; deep emitted `summary: { wentWell, didNotGoWell, architecturalTakeaway }`.
   - Light emitted `improvementCandidate: { kind, targetPath, suggestionText, ... }`; deep emitted `improvementCandidate: { file, action, evidence, ... }` — and crucially never set `kind`, so deep candidates persisted with `suggestionType=undefined`.
3. The frontend (`RetrospectiveSection.tsx`) carried fallback handling for both shapes plus a third historical shape — masking the drift instead of forcing convergence.

Real model output (captured from runs `625dff85` deep and `ebb9e732` light) confirmed the divergence and added new drift the schema did not anticipate: `outcome`, `workItemNumber`, `triggerReasons`, free-form `improvementKind` strings outside the `ImprovementKindSchema` enum, and inconsistent `personaId` formats (`goose-hub-self/developer` vs `goose-hub-self/retrospector/2`).

## Decision

**Schemas drive everything.** One canonical shape across both tiers, enforced at validation time. Provenance moves from model output to workflow injection.

### Shape

```ts
const RetroOutputBaseSchema = z.object({
  outcome: z.enum(['success', 'failure', 'partial']),
  workItemNumber: z.number().int(),
  summary: z.object({
    wentWell: z.string().min(1),
    didNotGoWell: z.string().min(1),
    architecturalTakeaway: z.string().min(1),
  }),
  improvementCandidates: z.array(ImprovementCandidateSchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});
```

`LightRetroSchema = RetroOutputBaseSchema`. `DeepRetroSchema = RetroOutputBaseSchema.extend({ triggerReasons, personaQualityScores, learningEntries, decisionPatterns })`.

### Provenance moves to workflow

`ImprovementCandidate` no longer carries `sourceRunId`, `sourceProject`, `sourceWorkItem`. The workflow (`core/workflows/retrospective.ts`) already has `runId`, `projectId`, and `workItemId` in scope at `persistCandidates()`; it injects those values when writing the DB row or filing a GitHub issue. The model's job is to identify *what* should change and *why*; the orchestrator's job is to record *which run surfaced it*.

`LearningEntry` drops `id`, `sourceRunIds`, `personaName`, `role`. `QualityScore` drops `skillName`, `computedAt`. `DecisionPattern` drops `id`, `exampleRunIds`, `surfacedAt`; `frequency` is renamed `occurrences` to match what the model already emits.

### `ImprovementKind` stays strict

The `ImprovementKindSchema` enum (`skill-prompt | skill-schema | skill-config | global-config | project-config | persona | workflow | governance-suggestion`) is canonical per CONTEXT.md and drives dispatcher routing (`governance-suggestion` is filtered to the human-only queue per FACTORY_RULES rule 12). Free-form strings the model emitted in the wild (`scope-discipline`, `tooling-gap`, `issue-quality`, `api-design`) map to existing enum values:

| Model term | Enum value |
|---|---|
| scope-discipline | `workflow` |
| tooling-gap | `project-config` |
| issue-quality | `workflow` |
| api-design | `skill-prompt` |

The mapping is published in both `skill.md` files. Fallback is `workflow`.

### `personaId` is workflow-enumerated

`QualityScoreSchema.personaId` is a string. The format is `<projectId>/<role>/<slotIndex>`. To stop the model inventing IDs, the workflow enumerates active personas from the event store (any `personaId` referenced on this work item's events) and passes the list as `<active_personas>` in the retrospector's context. The skill prompt instructs the model to score *only* IDs in that list.

### Validation failure is loud

`safeParse` failures previously fell through silently — the retrospective.completed event was emitted with whatever the model produced, and only `improvementCandidates` / `decisionSummaries` persistence was skipped. Going forward, a parse failure emits `agent.run-failed` with the Zod error path and transitions the work item to `factory:needs-human`. Drift surfaces as an issue, not as silently truncated UI.

## Consequences

- Six test files are rewritten with new fixtures (3 schema slice tests + workflow slice test + retro-batch test + e2e spec).
- `RetrospectiveSection.tsx` and `TimelineEvents.tsx` `RetroCompletedEvent` drop legacy fallbacks; types mirror schemas exactly.
- Skill prompts (`retrospective-light/skill.md`, `retrospective-deep/skill.md`) are rewritten with explicit JSON examples pinning every field name. The mapping table for `ImprovementKind` is embedded.
- The `improvement_candidate` YAML block in CONTEXT.md is updated: the agent emits the human-facing fields; the workflow injects `source_run_id`, `source_project`, `source_work_item` when filing the GitHub issue body.
- Future schema changes follow this contract: if the model can compute it from input, it goes in the output schema; if the orchestrator already has it, the orchestrator injects it.

## Out of scope

- Migration of historical `retrospective.completed` events in SQLite. Readers can detect old shape by absence of `outcome` and skip; we accept the discontinuity.
- Auto-mapping free-form `improvementKind` strings to enum values at the runtime layer. The mapping is enforced via the prompt; if the model emits an unmapped value, validation fails loud and surfaces as `factory:needs-human`.
- UI rendering of `triggerReasons` (deferred to a follow-up frontend issue).
