# slices/merge-decision

Per-cycle merge-decision gate (M19.21 #697). Deterministic gate that runs
INSIDE the approve action handler (`apps/server/src/domains/issues/transitions.ts`),
post-human-click and pre-`mergePR`. Preserves human-in-loop in supervised
mode — the human still clicks Approve, the gate runs synchronously, the
mergePR call only happens if the gate passes.

## When it runs

Wire location: `approveIssue()` reads the latest `pr.opened` event for the
work item; if `pipelineRunId` is present on the payload AND
`useMultiAgentPipeline` is enabled for the project, `runMergeDecision()`
fires before `mergePR()`.

## Gate logic

1. Assemble `RunArtifacts` via `buildRunArtifacts(pipelineRunId)` — reads
   `qa.completed` + `review.completed` events for the pipeline, counts
   P0..P3 findings, derives `harness_pass_rate` and the boolean component
   flags.
2. `computeQualityScore(artifacts)` → score `[0, 100]`.
3. Persist via `persistRunQualityScore({ pipelineRunId, ... })`.
4. Read prior scores for the project (excluding this pipeline).
5. Apply the warmup-aware gate:
   - `prior.length < 3` → score-only (`score >= 80`).
   - `prior.length >= 3` → score AND `isConverged([...prior.slice(-2), score], components)`.

## Outcomes

| Result | Caller action |
|---|---|
| `passed: true` | proceed with `mergePR` → state `factory:approved` → `factory:retrospecting` (existing path) |
| `passed: false` | skip `mergePR`, transition `factory:approved` → `factory:needs-human`, comment includes `reason` + `detail` |

## Why not an agent

This is pure deterministic computation over the event stream — no LLM.
Lives in a slice for the same reason `slices/quality-score/` does: a
removable workflow unit with its own test surface. The agent runs that
*produce* the inputs (QA, Review) are dispatched elsewhere; merge-decision
only consumes.

## References

- `core/quality-score/build-artifacts.ts` — RunArtifacts assembly
- `core/quality-score/score.ts` — `computeQualityScore`, `isConverged`
- `core/quality-score/repository.ts` — persistence + pipeline-keyed lookup
- `docs/adr/0033-quality-score-weights.md` — score formula rationale
