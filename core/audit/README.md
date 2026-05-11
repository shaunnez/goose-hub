# core/audit/

Orchestration glue for the `code-quality-audit` skill (M19.22, #698).

## Files

- `run-audit.ts` — single entry point `runCodeQualityAudit(input)`. Invokes the skill via `invokeSkill`, computes `audit_score`, persists it onto an existing `run_quality_scores` row by `pipelineRunId` (or creates a synthetic `nightly-<slug>-<isoDate>` row for project-level nightly audits), and emits up to three `ImprovementCandidates` from the top-3 recommendations. Returns an `autonomyGateFired` signal when `audit_score < 60` AND the project mode is `autonomous`.
- `nightly-scheduler.ts` — `startNightlyAuditScheduler(projects, opts)`. Starts one timer per project that fires `runCodeQualityAudit` against the project's local target repo. Idempotent across server restarts because the synthetic `pipelineRunId` is keyed on the calendar date.
- `run-audit.test.ts` — unit tests for `runCodeQualityAudit` and its helpers (top-3 selection, kind mapping, autonomy gate, failure path).
- `slice.test.ts` — slice-level contract for the nightly scheduler.

## Trigger sites

| Trigger              | Caller                                            | priority gate                                |
|----------------------|---------------------------------------------------|----------------------------------------------|
| `deep-retro`         | `core/workflows/retrospective.ts`                 | `triggers.priorityHigh === true`             |
| `convergent-review`  | `slices/review/workflow.ts` (parallel branch)     | `workItem.priority === 'high' \| 'critical'` |
| `nightly`            | `apps/server/src/index.ts` → `nightly-scheduler`  | all registered projects                      |

## Autonomy gate

`audit_score < 60` AND `project.mode === 'autonomous'` fires the gate. The
caller is responsible for the state transition — `runCodeQualityAudit` only
signals via `autonomyGateFired: true` on the result and emits an
`audit.autonomy-gate-fired` event.
