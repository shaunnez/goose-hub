# core/engineering-specs

Per-work-item storage for `EngineeringSpec` JSON blobs produced by the `spec-author` skill. One row per `(projectId, workItemId)`; the latest pipeline run wins.

## Files

| File | Exports |
|---|---|
| `types.ts` | `EngineeringSpecRecord` — the row shape returned by reads. |
| `repository.ts` | `persistEngineeringSpec(projectId, workItemId, pipelineRunId, spec)`, `getEngineeringSpec(projectId, workItemId)`, `deleteEngineeringSpec(projectId, workItemId)`. Drizzle-backed; upsert keyed on `(projectId, workItemId)`. |

## Behaviour

- `persistEngineeringSpec` is upsert: re-running `spec-author` for the same work item overwrites the prior spec and bumps `updatedAt`. `pipelineRunId` is recorded for traceability back to the dispatching workflow run.
- `getEngineeringSpec` returns `null` when no spec exists yet — callers (e.g. `parallel-implement`) treat that as "spec missing, do not start parallel WP execution."
- `deleteEngineeringSpec` removes the per-work-item row. The mock pipeline seed path uses it when issue numbers are reused so stale specs do not leak into fresh fixture issues.

## Consumers

- `slices/spec-author` writes specs after schema validation.
- `slices/parallel-implement` reads the spec to dispatch one work-package builder per WP.
- `skills/implement-wp` receives the spec as agent context for the specific WP it's implementing.
