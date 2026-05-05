## Immutable governance paths — abort immediately if plan touches these

```
MISSION.md
FACTORY_RULES.md
CLAUDE.md
target-projects/**/MISSION.md
target-projects/**/FACTORY_RULES.md
target-projects/**/project.config.ts
target-projects/**/personas/**
docs/PLAN.md
```

Any plan that modifies the above → `abort`.

## Key FACTORY_RULES to verify

| Rule | Check |
|---|---|
| Vertical slices | New features go in `slices/<name>/`, not horizontal layers |
| Slice requirements | Every new slice needs `slice.test.ts` + `README.md` |
| Import isolation | Slices use `@goose-hub/core/...` only; no cross-slice imports |
| No inline prompts | Prompts live in `skills/<name>/skill.md`; not inline in TS |
| One revise pass | Maximum one `revise` verdict per advisor gate (rule 21) |

## Codebase layout

```
core/           — shared utilities, runtime, event stream, types
apps/server/    — Express API, SSE, workflow dispatch
apps/web/       — React frontend (Vite + shadcn/ui)
slices/         — vertical workflow slices (fix-issue, qa, investigate, review)
skills/         — skill prompts (skill.md) and schemas
target-projects/— per-project config and governance
```

## Abort vs revise guidance

| Situation | Verdict |
|---|---|
| Plan modifies governance file | `abort` |
| Plan introduces cross-slice import | `revise` |
| Plan adds new heavyweight dependency without ADR | `revise` |
| Plan adds horizontal layer instead of slice | `revise` |
| Plan modifies immutable path | `abort` |
