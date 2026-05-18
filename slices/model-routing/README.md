# slices/model-routing

M19.09 — provider-aware model routing with UI-configurable role and complexity overrides.

Superseded for normal dispatch by ADR 0042. Role model rows now exist only as
advanced/internal compatibility state; users configure model tier/provider per
skill through Skill runtime settings.

## What this slice covers

- `ProjectModelPanel` — Settings → Advanced roles compatibility UI.
- `project_model_settings` CRUD retained for historical/internal state.

## Resolution order

### Normal skill runtime selection

Normal dispatch uses `resolveSkillRuntimeForProject()` and ignores
`project_model_settings`. Precedence is caller model override, forced runtime
provider, DB per-skill tier/provider, config `skillBudgetOverrides`, then
`SKILL_BUDGETS`.

### Compatibility role state

`project_model_settings.primary_model` and `complexity_overrides_json` remain
available to the advanced role API/UI, but they are not normal skill runtime
inputs.

## Holdout gating

`qa` and `reviewer` are holdouts. Per-skill model overrides are ignored unless
`agentConfig.allowHoldoutOverride: true` is set, and fallback/advisor models are
not exposed for holdout skill runtime rows.

## Key files

| File | Purpose |
|---|---|
| `core/agent-runtime/skill-runtime-resolver.ts` | Normal per-skill runtime resolver |
| `core/agent-runtime/resolve-for-project.ts` | Global and per-skill budget wrappers |
| `core/agent-runtime/model-router.ts` | Legacy complexity selector |
| `core/db/repositories/project-model-settings.ts` | CRUD |
| `core/db/migrations/0010_project_model_settings.sql` | Schema |
| `apps/server/src/domains/project-settings/model-router.ts` | API routes |
| `apps/web/src/components/settings/components/ProjectModelPanel.tsx` | UI |

## ADR

`docs/adr/0034-provider-aware-model-routing.md` and
`docs/adr/0042-per-skill-runtime-settings.md`
