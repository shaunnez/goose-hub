# slices/model-routing

M19.09 — provider-aware model routing with UI-configurable role and complexity overrides.

## What this slice covers

- `selectModelForRole()` — wires the previously-orphaned `rolesModels` in project config.
- `selectModel()` extension — DB complexity overrides as highest-priority layer.
- `ProjectModelPanel` — Settings → Models tab for live UI editing.

## Resolution order

### Static role assignment (`selectModelForRole`)

1. DB `project_model_settings.primary_model` (UI-editable)
2. `agentConfig.rolesModels[role]` (project config)
3. `skill.config.ts` `modelPin`
4. `ROLE_DEFAULTS[role].modelTier`

### Complexity-based tier selection (`selectModel`)

1. DB `project_model_settings.complexity_overrides_json` (UI-editable)
2. `agentConfig.modelRouter.overrides` (project config)
3. Decision pattern history (`decision_patterns` with `consistencyScore > 0.7`)
4. Static policy (priority → type → AC count)

## Holdout gating

`qa` and `reviewer` overrides are silently dropped unless
`agentConfig.allowHoldoutOverride: true` is set on the project config. The
Settings UI renders holdout rows as read-only when the flag is absent.

## Key files

| File | Purpose |
|---|---|
| `core/agent-runtime/select-model-for-role.ts` | Pure resolver |
| `core/agent-runtime/resolve-for-project.ts` | DB-reading wrappers |
| `core/agent-runtime/model-router.ts` | Extended with `dbComplexityOverrides` |
| `core/db/repositories/project-model-settings.ts` | CRUD |
| `core/db/migrations/0010_project_model_settings.sql` | Schema |
| `apps/server/src/domains/project-settings/model-router.ts` | API routes |
| `apps/web/src/components/settings/components/ProjectModelPanel.tsx` | UI |

## ADR

`docs/adr/0034-provider-aware-model-routing.md`
