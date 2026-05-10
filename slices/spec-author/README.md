# spec-author slice

M19.17 — wires the `spec-author` skill into the Factory pipeline.

## What it does

Runs when a work item enters `factory:dev-ready` with `useM19Pipeline = true`.

1. Generates a `pipelineRunId` (UUID) shared across the entire PR lifecycle.
2. Creates a worktree of the target repo for the skill to read.
3. Loads existing scout reports from the `scout_reports` DB table (populated by the investigate swarm).
4. Invokes the `spec-author` skill, which outputs an `EngineeringSpec` JSON blob.
5. Runs `validateEngineeringSpec` for structural rules (file-ownership, AC coverage, constraint grounding).
6. On validation failure → transitions to `factory:needs-human`.
7. On success → persists to `engineering_specs` table, emits `spec.completed` event (carries `pipelineRunId`), transitions to `factory:spec-ready`.

## State transitions

```
factory:dev-ready → factory:spec-ready   (success)
factory:dev-ready → factory:needs-human  (validation failure or runtime error)
```

## Consumed by

- `parallel-implement` slice (M19.03) — reads the spec from `engineering_specs` keyed by `(projectId, workItemId)`
- `convergent-review` slice (M19.04) — same

## Key files

| File | Purpose |
|------|---------|
| `workflow.ts` | Orchestrator entry point |
| `slice.test.ts` | Unit tests (6 cases) |
| `core/engineering-specs/repository.ts` | DB persistence |
| `core/db/migrations/0018_worthless_kylun.sql` | Migration adding `engineering_specs` table |
| `skills/spec-author/` | Skill definition (prompt, schema, config, validate) |
