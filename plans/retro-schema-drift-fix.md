# Retrospective schema drift fix

## Context

Real model output captured from runs `625dff85` (deep) and `ebb9e732` (light) shows three concrete drifts:

1. **Light & deep emit different shapes** for `summary` and `improvementCandidate`.
2. **Deep `improvementCandidate` has no `kind` field** — silently inserts DB rows with `suggestionType=undefined`.
3. **Schema fields the model can't populate** (id, sourceRunIds, exampleRunIds, surfacedAt, computedAt, sourceRunId/Project/WorkItem) are required, so live runs fail `safeParse` silently.

Fix approach: schemas drive everything. Force one canonical shape via prompt rewrites; validate strictly; fail loud on drift.

## Decisions locked

- **Summary**: object form `{ wentWell, didNotGoWell, architecturalTakeaway }` for both tiers.
- **ImprovementCandidate**: `{ kind, targetPath, suggestionText, evidence?, confidence, proposedDiff? }` for both. Deep stops emitting `file/action`.
- **ImprovementKind**: keep strict enum from CONTEXT.md. Embed mapping table in prompts (scope-discipline → workflow, tooling-gap → project-config, issue-quality → workflow, api-design → skill-prompt). Fallback `workflow`.
- **PersonaId**: workflow enumerates active personas from event store, passes `<active_personas>` to model. Model picks only from list.
- **Schema validation**: on `safeParse` failure, emit `agent.run-failed`, transition `factory:needs-human`. No silent swallow.
- **Provenance**: stripped from model output. Workflow injects (it has `runId`/`projectId`/`workItemId`). ADR records the move.

## Canonical schema shape

```ts
// shared
const SummarySchema = z.object({
  wentWell: z.string().min(1),
  didNotGoWell: z.string().min(1),
  architecturalTakeaway: z.string().min(1),
});

const ImprovementCandidateSchema = z.object({
  kind: ImprovementKindSchema,
  targetPath: z.string(),
  suggestionText: z.string(),
  evidence: z.string().optional(),
  confidence: ConfidenceSchema,
  proposedDiff: z.string().optional(),
});

const QualityScoreSchema = z.object({
  personaId: z.string(),
  score: z.number().min(0).max(1),
  trend: z.enum(['improving', 'stable', 'declining']),
  sampleCount: z.number().int().min(1),
});

const LearningEntrySchema = z.object({
  observation: z.string().min(1),
  rationale: z.string().min(1),
  improvementKind: ImprovementKindSchema,
  targetPath: z.string().optional(),
  confidence: ConfidenceSchema,
});

const DecisionPatternSchema = z.object({
  pattern: z.string().min(1),
  occurrences: z.number().int().min(1),
  confidence: ConfidenceSchema,
  note: z.string().optional(),
});

const RetroOutputBaseSchema = z.object({
  outcome: z.enum(['success', 'failure', 'partial']),
  workItemNumber: z.number().int(),
  summary: SummarySchema,
  improvementCandidates: z.array(ImprovementCandidateSchema),
  decisionSummaries: z.array(DecisionSummarySchema).min(1),
});

export const LightRetroSchema = RetroOutputBaseSchema;

export const DeepRetroSchema = RetroOutputBaseSchema.extend({
  triggerReasons: z.array(z.string()),
  personaQualityScores: z.array(QualityScoreSchema),
  learningEntries: z.array(LearningEntrySchema),
  decisionPatterns: z.array(DecisionPatternSchema),
});
```

## Work breakdown

Five tracks. Within a track tasks are sequential. Tracks A and D have a single dependency on each other; the rest are parallelizable.

### Track A — Schemas (foundation)

**Sequential. Blocks B, C, E, F.**

- A1. Rewrite `core/retrospective/schemas.ts` to canonical shape above.
- A2. Rewrite `skills/retrospective-light/schema.ts` — extend base, no extras.
- A3. Rewrite `skills/retrospective-deep/schema.ts` — extend base + deep-only fields.
- A4. Update tests `core/retrospective/slice.test.ts`, `skills/retrospective-light/slice.test.ts`, `skills/retrospective-deep/slice.test.ts` to use new fixtures.

### Track B — Prompts

**Sequential within track. Depends on A1 (enum import).**

- B1. Rewrite `skills/retrospective-light/skill.md` — explicit JSON example, field names pinned, ImprovementKind mapping table.
- B2. Rewrite `skills/retrospective-deep/skill.md` — same plus deep-only fields, `<active_personas>` enforcement, `<trigger_reasons>` echo instruction.

### Track C — Workflow

**Sequential within track. Depends on A.**

- C1. `core/workflows/retrospective.ts` — enumerate active personas from event store, add to context as `activePersonas`.
- C2. Replace silent `safeParse` with fail-loud: on parse error emit `agent.run-failed` + transition `factory:needs-human`.
- C3. Workflow injects provenance into improvement candidates before persisting (currently `persistCandidates` already ignores model-provided provenance — wire workflow values).
- C4. Update tests `core/workflows/slice.test.ts`, `apps/server/src/domains/workflows/retro-batch.test.ts` (drop `kind: 'persona-tweak'` invalid fixture; use new shape).

### Track D — ADR + CONTEXT

**Independent. No code dependency.**

- D1. Write `docs/adr/0019-retrospective-output-schema.md` — schemas drive output; provenance moves from model to workflow.
- D2. Update `CONTEXT.md` "Improvement Candidates" section to remove `source_run_id/project/work_item` from model-output YAML; note workflow injects on persist.

### Track E — Frontend

**Sequential within track. Depends on A.**

- E1. Rewrite `apps/web/src/components/detail/components/RetrospectiveSection.tsx` — types mirror schemas exactly; drop SummaryShape union, drop `file/action` legacy fields, drop summary-as-string fallback. Use `usePersonaMap` + `getPersonaLabel` for QualityScore display. Add learningEntries, decisionPatterns, decisionSummaries, outcome badge, trigger reasons sections. Match `ReviewSection.tsx` styling.
- E2. Update `apps/web/src/components/detail/components/TimelineEvents.tsx` lines 755–833 (`RetroCompletedEvent`) — read `output.summary` as object, render `wentWell/didNotGoWell/architecturalTakeaway`; rename `decisionSummary` (singular) → `decisionSummaries[]`.
- E3. Update `apps/web/e2e/m9-retrospective-tab.spec.ts` — mock `retroEvent` payload uses canonical shape.

### Track F — Verification

**Sequential. Runs last.**

- F1. `pnpm biome check --write`
- F2. `pnpm tsc --noEmit` in both `apps/server` and `apps/web`
- F3. `pnpm test` — full suite both apps
- F4. Trigger one real light + one real deep retro on a fresh issue. Verify `safeParse` passes against new schema. Capture payloads for regression baseline.

## Parallelization plan

```
       ┌─ B (prompts)            ─┐
A ─────┤                          ├─ F (verify)
       ├─ C (workflow + tests)   ─┤
       │                          │
       ├─ E (frontend + tests)   ─┤
       └────────────────────────  │
D (ADR + CONTEXT) ────────────────┘
```

- **Wave 1 (parallel)**: A, D
- **Wave 2 (parallel after A)**: B, C, E
- **Wave 3 (sequential after B+C+E)**: F

## Agent / model assignments

| Track | Recommended agent | Model | Reason |
|---|---|---|---|
| A — Schemas | `cavecrew-builder` | sonnet 4.6 | Mechanical Zod rewrites + matching test fixtures. Bounded 3 files of code + 3 test files; predictable. |
| B — Prompts | main thread | opus 4.7 (current) | Prompt design is judgment-heavy. Field-name pinning, mapping tables, JSON examples need precise wording. Don't delegate. |
| C — Workflow | `cavecrew-builder` | sonnet 4.6 | Bounded edit to `retrospective.ts` + 2 test files. Logic adds (persona enumeration, fail-loud, provenance injection) are mechanical once shape decided. |
| D — ADR + CONTEXT | main thread | opus 4.7 | Architectural writeup — needs reasoning about why provenance moves, not just typing. |
| E — Frontend | `cavecrew-builder` | sonnet 4.6 | UI mirror of schemas. Reference: `ReviewSection.tsx`. Mostly mechanical once schemas exist. |
| F — Verification | main thread + Bash | sonnet 4.6 | Run commands, read output, fix any survivor drift. |

## Constraints

- No PR (maintenance fix per user direction; not active milestone issue).
- No governance file edits (CLAUDE.md, FACTORY_RULES.md, MISSION.md).
- Biome + tsc + tests all green before declaring done.
- Capture real retro payloads after F4 — store under `plans/retro-schema-fixtures/` for future regression.
